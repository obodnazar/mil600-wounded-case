import {monthEnd} from '../calendar.js';
import {ReviewRequired, newId, optionalText, text, type EventContext} from '../model.js';
import {financeTransitionProblem} from '../rules.js';
import {openTask} from '../tasks.js';

/**
 * Фінансовий стан одного виду виплати за один період.
 * Винагорода й ОГД — окремі маршрути; періоди не змішуються; схвалення,
 * часткове та повне виконання — різні підтверджені стани.
 */
export function applyFinanceStatus({store, event, payload, caseId, caseEventId}: EventContext): void {
  const kind = text(payload, 'kind');
  const period = text(payload, 'period');
  const status = text(payload, 'status');
  const periodStart = `${period}-01`;
  const packetRef = text(payload, 'packet_ref');

  const packet = store.exists(
    'SELECT packet_ref FROM route_packet WHERE case_id=? AND route=? AND packet_ref=? AND period=?',
    caseId, kind, packetRef, period,
  );
  if (!packet) throw new ReviewRequired('finance_without_packet_receipt');

  const prior = store.row(
    'SELECT current_status,decision_ref FROM financial_track WHERE case_id=? AND payment_kind=? AND period_start=?',
    caseId, kind, periodStart,
  );
  const priorState = prior
    ? {status: String(prior.current_status), decisionRef: prior.decision_ref ? String(prior.decision_ref) : null}
    : null;
  const problem = financeTransitionProblem(priorState, {
    status,
    previousDecisionRef: optionalText(payload, 'previous_decision_ref'),
  });
  if (problem) throw new ReviewRequired(problem);

  // Невідомий сигнал не стирає підтверджене рішення: лише відкриває уточнення.
  if (status === 'unknown' && prior?.decision_ref) {
    openTask(store, caseId, 'clarify_finance', 'support', `demo-finance-unknown:${kind}:${period}`, caseEventId);
    return;
  }

  const executed = status.startsWith('execution_');
  store.run(
    `INSERT INTO financial_track(
       id,case_id,payment_kind,period_start,period_end,current_status,reason_code,decision_ref,
       execution_ref,source_version,packet_ref,source_system,decision_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(case_id,payment_kind,period_start,period_end) DO UPDATE SET
       current_status=excluded.current_status,
       reason_code=excluded.reason_code,
       decision_ref=excluded.decision_ref,
       execution_ref=excluded.execution_ref,
       source_version=excluded.source_version,
       packet_ref=excluded.packet_ref,
       source_system=excluded.source_system,
       decision_at=excluded.decision_at`,
    newId(), caseId, kind, periodStart, monthEnd(periodStart), status, text(payload, 'reason_code'),
    text(payload, 'decision_ref'), executed ? text(payload, 'evidence_ref') : null,
    event.source_version, packetRef, event.source_system, event.occurred_at,
  );

  if (['returned', 'denied', 'unknown'].includes(status)) {
    openTask(store, caseId, 'clarify_finance', 'support', `demo-finance:${kind}:${period}:${status}`, caseEventId);
    return;
  }
  store.run(
    `UPDATE task SET status='resolved',resolution_code='source_finance_confirmed'
      WHERE case_id=? AND kind='clarify_finance' AND (trigger_ref LIKE ? OR trigger_ref LIKE ?)`,
    caseId, `demo-finance:${kind}:${period}:%`, `demo-finance-unknown:${kind}:${period}`,
  );
}
