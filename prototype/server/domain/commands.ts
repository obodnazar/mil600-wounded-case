import {createHash} from 'node:crypto';
import {Denied, checkCase, type EventEnvelope, type Session} from '../../security/core.js';
import type {CommandAction, CommandRequest, CommandResult, DemoProfile} from '../../shared/api.js';
import {resolveSession} from '../access/sessions.js';
import type {Store} from '../db/store.js';
import {appendCaseEvent, enqueueProjection} from './case-log.js';
import {attachEvidence} from './documents.js';
import {applyEvent} from './events/apply.js';
import {refreshFreshness} from './freshness.js';
import {ReviewRequired, SOURCE_SYSTEMS, newId} from './model.js';
import {RESERVE_BASE_CASE, RESERVE_CASE, commandBlocker, isManualTask, isSupportOnlyReview} from './preconditions.js';
import {openTask, ownerScope} from './tasks.js';

/**
 * Дії користувачів у панелях. Жодна дія не створює медичного факту й не
 * підтверджує документ: вона фіксує запит і задачу, а підтвердження надходить
 * окремою подією належного джерела.
 */

const STAFF: readonly DemoProfile[] = ['support', 'commander'];
const CASE_PARTICIPANTS: readonly DemoProfile[] = ['patient', 'support', 'commander'];

/** Хто може виконувати дію. Командир і супровід мають різні повноваження. */
const ALLOWED_ROLES: Readonly<Record<CommandAction, readonly DemoProfile[]>> = {
  issue_certificate: ['commander'],
  refer_vlk: ['commander'],
  admin_open: STAFF,
  clarify: STAFF,
  gap: STAFF,
  resolve_support: STAFF,
  verify_copy: STAFF,
  resolve_review: STAFF,
  close_review: STAFF,
  resolve_task: STAFF,
  copy: CASE_PARTICIPANTS,
  support_request: CASE_PARTICIPANTS,
};

export const COMMAND_ACTIONS = Object.keys(ALLOWED_ROLES) as CommandAction[];

interface CommandContext {
  store: Store;
  input: CommandRequest;
  /** Кейс, якого стосується ефект (для резерву відрізняється від запитаного). */
  caseId: string;
  caseEventId: string;
  now: number;
  role: DemoProfile;
}

type Effect = (context: CommandContext) => void;

/**
 * Виконує команду в одній транзакції: повторна перевірка прав, ідемпотентність,
 * передумови, запис у журнал кейсу, ефект, outbox і аудит. Збій будь-якого кроку
 * (включно з аудитом) відкочує все.
 */
export function executeCommand(store: Store, session: Session, input: CommandRequest, now: number): CommandResult {
  return store.transaction(() => {
    // Права перевіряються заново на кожен запит і на кожен повтор: відкликаний
    // грант чи зміна області діють негайно, навіть для вже прийнятої команди.
    const current = resolveSession(store, session.role, session.actorId, now);
    checkCase(current, input.case_id);
    if (!ALLOWED_ROLES[input.action].includes(session.role)) throw new Denied(403, 'command_forbidden');

    const digest = commandDigest(input);
    const previous = store.row('SELECT actor,digest,outcome FROM demo_command WHERE id=?', input.id);
    if (previous) {
      if (previous.actor !== session.actorId || previous.digest !== digest) throw new Denied(409, 'command_conflict');
      store.audit('command', 'duplicate', session.actorId, input.case_id, now, session.role);
      return {...(JSON.parse(String(previous.outcome)) as CommandResult), duplicate: true};
    }

    assertOptionAllowed(input);
    const blocker = commandBlocker(store, session.role, input.case_id, input.action);
    if (blocker) throw new Denied(409, blocker);

    const caseId = input.action === 'admin_open' ? openReserveCase(store) : input.case_id;
    const caseEventId = appendCaseEvent(store, {
      caseId,
      type: `command.${input.action}`,
      payload: {action: input.action, option: input.option ?? null},
      now,
      occurredAt: new Date(now).toISOString(),
      commandId: input.id,
    });
    EFFECTS[input.action]({store, input, caseId, caseEventId, now, role: session.role});
    enqueueProjection(store, caseId, caseEventId, `command:${input.id}`);

    const outcome: CommandResult = {status: 'recorded', case_id: caseId, source_confirmed: false};
    store.insert('demo_command', {
      id: input.id,
      actor: session.actorId,
      case_id: caseId,
      digest,
      outcome: JSON.stringify(outcome),
    });
    store.audit('command', 'allowed', session.actorId, caseId, now, session.role);
    return outcome;
  });
}

function commandDigest(input: CommandRequest): string {
  const canonical = {id: input.id, case_id: input.case_id, action: input.action, option: input.option ?? null};
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Параметри дій — лише з фіксованого переліку; довільних значень немає. */
function assertOptionAllowed(input: CommandRequest): void {
  if (input.action === 'admin_open') {
    if (input.case_id !== RESERVE_BASE_CASE || input.option !== 'primary_unavailable') {
      throw new Denied(400, 'reserve_fixture_only');
    }
  }
  if (input.action === 'copy' && !['trauma_certificate', 'wrong_kind'].includes(input.option ?? '')) {
    throw new Denied(400, 'gallery_only');
  }
}

/**
 * Резервний адміністративний кейс без еПМК: фіксований навчальний учасник.
 * Медичного факту не створює — лише чекає на медичне джерело. Пізня еПМК
 * долучиться до цього самого кейсу за перевіреною прив’язкою випадку.
 */
function openReserveCase(store: Store): string {
  // Задача очікування еПМК прив'язується до події команди вже після її запису (див. EFFECTS).
  const base = store.row('SELECT subject_id FROM wound_case WHERE id=?', RESERVE_BASE_CASE);
  if (!base) throw new Denied(404, 'not_found');
  const subjectId = String(base.subject_id);
  const incident = 'demo-reserve-02';
  store.insert('wound_case', {
    id: RESERVE_CASE,
    subject_id: subjectId,
    incident_namespace: 'demo-mis',
    incident_ref: incident,
    origin: 'administrative_request',
    injury_date: null,
    injury_date_assurance: 'unknown',
    lifecycle_state: 'administrative_open',
    revision: 1,
  });
  for (const source of SOURCE_SYSTEMS) {
    store.insert('incident_link', {
      source,
      subject_id: subjectId,
      incident_ref: incident,
      case_id: RESERVE_CASE,
      proof: 'demo-admin-identity-incident-check',
    });
  }
  return RESERVE_CASE;
}

const awaitPrimarySource: Effect = ({store, caseId, caseEventId}) => {
  openTask(store, caseId, 'await_primary_source', 'support', 'demo-reserve-primary', caseEventId);
};

const awaitSourceConfirmation: Effect = ({store, input, caseId, caseEventId}) => {
  openTask(store, caseId, 'await_source_confirmation', 'support', input.id, caseEventId);
};

/** Копія з готової галереї — запасний шлях; вона ніколи не стає джерельним оригіналом. */
const addGalleryCopy: Effect = ({store, input, caseId, caseEventId}) => {
  const wrongKind = input.option === 'wrong_kind';
  const documentId = newId();
  store.insert('document_ref', {
    id: documentId,
    case_id: caseId,
    source_system: 'demo-gallery',
    source_record_ref: input.id,
    document_version: 'gallery-v1',
    kind: 'trauma_certificate',
    provenance: 'manual_demo_copy',
    validation_state: wrongKind ? 'wrong_kind' : 'pending',
    classification: 'administrative',
    state: 'copy',
    active: 1,
  });
  attachEvidence(store, caseId, documentId, 'trauma_certificate', 'demo-gallery');
  openTask(store, caseId, wrongKind ? 'clarify_author' : 'verify_demo_copy', 'support', input.id, caseEventId);
};

const verifyCopy: Effect = ({store, caseId}) => {
  store.run(
    `UPDATE document_ref SET validation_state='technical_checked'
      WHERE case_id=? AND source_system='demo-gallery' AND validation_state='pending'`,
    caseId,
  );
  store.run(
    `UPDATE task SET status='resolved',resolution_code='technical_copy_checked'
      WHERE case_id=? AND kind='verify_demo_copy' AND status='open'`,
    caseId,
  );
};

/** Звернення родини фіксується як звернення; доступу, сесії чи гранта воно не створює. */
const registerSupportRequest: Effect = ({store, input, caseId}) => {
  store.insert('support_request', {
    id: newId(),
    case_id: caseId,
    category: input.option === 'relative' ? 'relative_contact_without_access' : 'status_clarification',
    owner_scope: ownerScope(store, caseId),
    state: 'open',
    result_code: null,
    authority_checked: 0,
  });
};

const resolveSupportRequests: Effect = ({store, caseId}) => {
  store.run(
    `UPDATE support_request SET state='resolved',result_code='clarification_prepared_for_authorized_channel'
      WHERE case_id=? AND state='open'`,
    caseId,
  );
};

const reportGap: Effect = ({store, input, caseId, caseEventId}) => {
  openTask(store, caseId, 'reconcile_missing_event', 'support', input.id, caseEventId);
  refreshFreshness(store, caseId);
};

const requestClarification: Effect = ({store, input, caseId, caseEventId}) => {
  openTask(store, caseId, 'clarify_author', 'support', input.id, caseEventId);
};

/**
 * Ручна звірка невизначеного випадку: особа вже перевірена джерелом, людина
 * явно підтверджує кейс. Інші причини розбору вручну не закриваються — їх
 * має розв’язати належне джерело.
 */
const resolveReview: Effect = ({store, input, caseId, caseEventId, now, role}) => {
  const review = store.row("SELECT * FROM review_item WHERE id=? AND state='open'", input.option ?? '');
  const inScope = review !== undefined && store.exists(
    `SELECT u.id FROM unit_assignment u JOIN wound_case c ON c.subject_id=u.subject_id
      WHERE c.id=? AND u.unit_ref=? AND u.verification_state='verified' AND u.valid_to IS NULL`,
    caseId, review.assigned_scope,
  );
  if (!review || !inScope || review.reason_code !== 'missing_incident') {
    throw new Denied(409, 'source_review_required');
  }
  // Розбір фінансової чи медичної події командир не бачить — і застосувати його не може.
  if (role === 'commander' && isSupportOnlyReview(store, String(review.id))) throw new Denied(403, 'command_forbidden');
  const inbox = store.row('SELECT minimal_envelope FROM inbox_event WHERE id=?', review.inbox_event_id);
  if (!inbox) throw new Denied(404, 'not_found');
  const event = JSON.parse(String(inbox.minimal_envelope)) as EventEnvelope;
  applyEvent(store, event, String(review.inbox_event_id), now, caseId);
  store.run("UPDATE inbox_event SET processing_state='applied' WHERE id=?", review.inbox_event_id);
  store.run(
    "UPDATE review_item SET state='resolved',resolution_event_ref=?,case_id=? WHERE id=?",
    caseEventId, caseId, review.id,
  );
  refreshFreshness(store, caseId);
};

/**
 * Закриває розбір після звірки з джерелом, коли подію застосовувати не слід
 * (суперечлива версія, неможлива хронологія, чужий адресат). Бізнес-стан не
 * змінюється, подія лишається незастосованою в inbox; якщо джерело надішле її
 * знову й причина не зникне — розбір відкриється повторно.
 * Невизначений випадок закривається лише явним підтвердженням (resolve_review).
 */
const closeReview: Effect = ({store, input, caseId, caseEventId, role}) => {
  const review = store.row(
    "SELECT id,case_id,reason_code,assigned_scope FROM review_item WHERE id=? AND state='open'",
    input.option ?? '',
  );
  const ownCase = review?.case_id === caseId;
  const ownScope = review !== undefined && review.case_id === null && store.exists(
    `SELECT u.id FROM unit_assignment u JOIN wound_case c ON c.subject_id=u.subject_id
      WHERE c.id=? AND u.unit_ref=? AND u.verification_state='verified' AND u.valid_to IS NULL`,
    caseId, review.assigned_scope,
  );
  if (!review || (!ownCase && !ownScope) || review.reason_code === 'missing_incident') {
    throw new Denied(409, 'review_not_closable');
  }
  if (role === 'commander' && isSupportOnlyReview(store, String(review.id))) {
    throw new Denied(403, 'command_forbidden');
  }
  store.run(
    "UPDATE review_item SET state='resolved',resolution_event_ref=? WHERE id=?",
    caseEventId, review.id,
  );
  refreshFreshness(store, caseId);
};

/** Закриває лише вручну створене уточнення; задачі від джерел закриває тільки джерело. */
const resolveManualTask: Effect = ({store, input, caseId}) => {
  const taskId = input.option ?? '';
  if (!isManualTask(store, taskId, caseId)) throw new Denied(409, 'task_not_closable');
  store.run("UPDATE task SET status='resolved',resolution_code='closed_by_staff' WHERE id=?", taskId);
  refreshFreshness(store, caseId);
};

const EFFECTS: Readonly<Record<CommandAction, Effect>> = {
  admin_open: awaitPrimarySource,
  issue_certificate: awaitSourceConfirmation,
  refer_vlk: awaitSourceConfirmation,
  copy: addGalleryCopy,
  verify_copy: verifyCopy,
  support_request: registerSupportRequest,
  resolve_support: resolveSupportRequests,
  gap: reportGap,
  clarify: requestClarification,
  resolve_review: resolveReview,
  close_review: closeReview,
  resolve_task: resolveManualTask,
};

/** Помилку застосування події під час ручної звірки показуємо як потребу розбору джерелом. */
export function asCommandError(error: unknown): unknown {
  return error instanceof ReviewRequired ? new Denied(409, 'source_review_required') : error;
}
