import type {AnchorStatus, Applicability} from '../../shared/api.js';
import type {Store} from '../db/store.js';
import {kyivDate} from './calendar.js';
import {hasIssuedCertificate} from './documents.js';
import {RULE, isoTime, newId} from './model.js';
import {asEnemyAction, careControl, certificateClock} from './rules.js';
import {hasOpenTask, openTask, resolveTasks} from './tasks.js';

interface DeadlineState {
  caseId: string;
  rule: string;
  anchorEventId: string;
  anchorDate: string | null;
  dueDate: string | null;
  followUpDate: string | null;
  anchorStatus: AnchorStatus;
  applicability: Applicability;
}

/**
 * Один рядок строку на кейс і правило.
 *
 * Ревізія обчислення зростає лише тоді, коли змінився сам результат. Перерахунок,
 * що дав ті самі дати (нова версія еПМК, повторна квитанція), не чіпає рядок і
 * тому не породжує нового нагадування. Якщо ж результат змінився, нагадування за
 * попередньою ревізією закривається як застаріле.
 */
function saveDeadline(store: Store, state: DeadlineState): void {
  const status = state.dueDate ? 'review_by_date' : 'clarify';
  const current = store.row(
    `SELECT id,anchor_date,due_date,applicability_state,anchor_status,provisional_follow_up_date
       FROM deadline WHERE case_id=? AND rule_version_id=?`,
    state.caseId, state.rule,
  );
  if (!current) {
    store.insert('deadline', {
      id: newId(),
      case_id: state.caseId,
      rule_version_id: state.rule,
      anchor_event_id: state.anchorEventId,
      anchor_date: state.anchorDate,
      due_date: state.dueDate,
      applicability_state: state.applicability,
      anchor_status: state.anchorStatus,
      provisional_follow_up_date: state.followUpDate,
      status,
      calculation_revision: 1,
    });
    return;
  }
  const unchanged =
    current.anchor_date === state.anchorDate &&
    current.due_date === state.dueDate &&
    current.applicability_state === state.applicability &&
    current.anchor_status === state.anchorStatus &&
    current.provisional_follow_up_date === state.followUpDate;
  if (unchanged) return;
  // Підтверджений строк не зникає через те, що пізніша подія просто не несе потрібних
  // фактів. Його скасовує лише підтверджена незастосовність правила.
  const downgrade = current.anchor_status === 'confirmed' && state.anchorStatus !== 'confirmed';
  if (downgrade && state.applicability !== 'not_applicable') return;
  store.run(
    `UPDATE deadline SET
       anchor_event_id=?,anchor_date=?,due_date=?,applicability_state=?,anchor_status=?,
       provisional_follow_up_date=?,status=?,calculation_revision=calculation_revision+1
     WHERE id=?`,
    state.anchorEventId, state.anchorDate, state.dueDate, state.applicability, state.anchorStatus,
    state.followUpDate, status, current.id,
  );
  store.run(
    `UPDATE task SET status='resolved',resolution_code='superseded_by_recalculation'
      WHERE case_id=? AND kind='review_deadline' AND status='open' AND trigger_ref LIKE ?`,
    state.caseId, `demo-deadline:${String(current.id)}:%`,
  );
}

/** Перераховує строк довідки з підтверджених фактів кейсу. */
export function refreshCertificateClock(store: Store, caseId: string, anchorEventId: string): void {
  const facts = store.row(
    'SELECT enemy_action,admitted_on,source_recorded_at FROM wound_case WHERE id=?',
    caseId,
  );
  if (!facts) return;
  const clock = certificateClock({
    enemyAction: asEnemyAction(facts.enemy_action),
    admittedOn: facts.admitted_on ? String(facts.admitted_on) : null,
    sourceRecordedAt: facts.source_recorded_at ? String(facts.source_recorded_at) : null,
  });
  saveDeadline(store, {caseId, rule: RULE.certificate, anchorEventId, ...clock});
  // Одна відкрита задача уточнення на кейс: повторна подія не множить її.
  if (clock.needsAdmissionConfirmation && !hasOpenTask(store, caseId, 'confirm_admission_date')) {
    openTask(store, caseId, 'confirm_admission_date', 'support', `demo-certificate-anchor:${caseId}`, anchorEventId);
  }
}

/** Фіксує початок і застосовність контролю лікування й за потреби відкриває задачу уточнення. */
export function saveCareControl(
  store: Store, caseId: string, anchorEventId: string, startDate: string | null, careApplicable: unknown,
): void {
  const control = careControl(startDate, careApplicable);
  store.run(
    'UPDATE wound_case SET continuous_start=?,care_applicability=? WHERE id=?',
    startDate, control.applicability, caseId,
  );
  saveDeadline(store, {
    caseId,
    rule: RULE.care,
    anchorEventId,
    anchorDate: startDate,
    dueDate: control.dueDate,
    followUpDate: null,
    anchorStatus: startDate ? 'confirmed' : 'unknown',
    applicability: control.applicability,
  });
  if (startDate && control.applicability !== 'unknown') {
    resolveTasks(store, caseId, 'clarify_care_start', 'source_anchor_confirmed');
  }
  if (control.needsClarification) {
    openTask(store, caseId, 'clarify_care_start', 'support', `demo-care-anchor:${caseId}`, anchorEventId);
  }
}

const CERTIFICATE_REVIEW = `kind='review_deadline'
        AND EXISTS(
          SELECT 1 FROM deadline d
           WHERE d.case_id=task.case_id AND d.rule_version_id=?
             AND task.trigger_ref LIKE 'demo-deadline:'||d.id||':%')`;

/**
 * Нагадування про строк довідки — функція стану, а не одноразова подія:
 * підтверджена видача його закриває, а відкликання виданої довідки повертає.
 */
export function syncCertificateReview(store: Store, caseId: string): void {
  if (hasIssuedCertificate(store, caseId)) {
    store.run(
      `UPDATE task SET status='resolved',resolution_code='certificate_issue_confirmed'
        WHERE case_id=? AND status='open' AND ${CERTIFICATE_REVIEW}`,
      caseId, RULE.certificate,
    );
    return;
  }
  store.run(
    `UPDATE task SET status='open',resolution_code=NULL
      WHERE case_id=? AND status='resolved' AND resolution_code='certificate_issue_confirmed'
        AND ${CERTIFICATE_REVIEW}`,
    caseId, RULE.certificate,
  );
}

/**
 * Календарний worker: коли підтверджений застосовний строк сплив, створює
 * людині задачу перевірки. Жодних санкцій, зміни виплат чи службового статусу.
 * Строк довідки не нагадує про себе, поки видачу підтверджено, і нагадує знову,
 * якщо видану довідку відкликано. Повторний запуск не створює дублів.
 */
export function reviewOverdueDeadlines(store: Store, now: number): void {
  const today = kyivDate(isoTime(now));
  store.transaction(() => {
    const overdue = store.rows(
      `SELECT id,case_id,rule_version_id,calculation_revision FROM deadline
        WHERE anchor_status='confirmed' AND applicability_state='applicable' AND due_date<?`,
      today,
    );
    for (const deadline of overdue) {
      const caseId = String(deadline.case_id);
      if (deadline.rule_version_id === RULE.certificate) {
        syncCertificateReview(store, caseId);
        if (hasIssuedCertificate(store, caseId)) continue;
      }
      const trigger = `demo-deadline:${String(deadline.id)}:${String(deadline.calculation_revision)}`;
      if (store.exists('SELECT id FROM task WHERE case_id=? AND trigger_ref=?', caseId, trigger)) continue;
      openTask(store, caseId, 'review_deadline', 'support', trigger);
      store.audit('event_validate', 'allowed', 'demo-calendar', String(deadline.id), now, 'worker');
    }
  });
}
