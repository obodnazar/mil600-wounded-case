import {Denied, semanticDigest, type EventEnvelope, type SignatureHeaders} from '../../security/core.js';
import type {IngestStatus} from '../../shared/api.js';
import {sha256, type Row, type Store} from '../db/store.js';
import {applyEvent} from '../domain/events/apply.js';
import {refreshFreshness} from '../domain/freshness.js';
import {ReviewRequired, isoTime, newId} from '../domain/model.js';

export interface IngestOutcome {
  http: number;
  status: IngestStatus;
  business_applied: boolean;
}

const INBOX_CAPACITY = 1000;
/** Nonce живе довше за вікно підпису з обох боків, щоб повтор не пройшов на межі. */
const NONCE_TTL_MS = 601_000;
const UNASSIGNED_SCOPE = 'demo-source-review';

/**
 * Стійке приймання автентифікованої події — одна транзакція SQLite:
 * nonce транспорту → дедуплікація → inbox → застосування домену (кейс, задача,
 * outbox) → аудит. Якщо будь-що, зокрема аудит, не записалося — не записано нічого.
 *
 * Підпис, схему та політику джерела перевіряє Ingress ДО виклику цієї функції;
 * dev-симулятор проходить той самий шлях.
 */
export function acceptEvent(store: Store, event: EventEnvelope, headers: SignatureHeaders, now: number): IngestOutcome {
  return store.transaction(() => {
    consumeNonce(store, headers, now);
    const digest = semanticDigest(event);
    const previous = store.rows(
      `SELECT id,semantic_digest,processing_state FROM inbox_event
        WHERE (source_system=? AND event_id=?)
           OR (source_system=? AND source_stream=? AND source_version=? AND event_type=?)`,
      event.source_system, event.event_id,
      event.source_system, event.source_stream, event.source_version, event.event_type,
    );
    if (previous.some(item => item.semantic_digest !== digest)) return recordConflict(store, event, previous, now);
    if (previous.length) return redeliver(store, event, previous, now);

    const inboxFull = store.count('SELECT COUNT(*) AS n FROM inbox_event') >= INBOX_CAPACITY;
    if (inboxFull) throw new Denied(429, 'ingress_capacity');
    const inboxId = newId();
    store.run(
      'INSERT INTO inbox_event VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      inboxId, event.source_system, event.event_id, event.source_stream, event.source_version,
      event.source_order, event.event_type, digest, isoTime(now), JSON.stringify(event), 'pending_review',
    );
    if (tryApply(store, event, inboxId, now)) return accepted(store, event, inboxId, now);
    return pending(store, event, now);
  });
}

function consumeNonce(store: Store, headers: SignatureHeaders, now: number): void {
  store.run('DELETE FROM transport_nonce WHERE expires_at<=?', now);
  const nonce = sha256(headers.nonce);
  if (store.exists('SELECT 1 FROM transport_nonce WHERE key_id=? AND nonce_hash=?', headers.keyId, nonce)) {
    throw new Denied(409, 'transport_replay');
  }
  store.run('INSERT INTO transport_nonce VALUES (?,?,?)', headers.keyId, nonce, now + NONCE_TTL_MS);
}

/**
 * Застосовує подію у вкладеній межі. Будь-яка відмова домену відкочує лише
 * доменні зміни й залишає запис inbox на розборі з причиною: автентифікована
 * подія не зникає безслідно, а джерело не отримує нескінченних 5xx.
 * Збій самого inbox чи аудиту (поза цією межею) відкочує всю транзакцію.
 */
function tryApply(store: Store, event: EventEnvelope, inboxId: string, now: number): boolean {
  try {
    store.savepoint('domain_apply', () => applyEvent(store, event, inboxId, now));
    return true;
  } catch (error) {
    openReview(store, event, inboxId, reviewReason(error), now);
    return false;
  }
}

/** Порушення обмеження БД чи некоректне значення — теж причина розбору, а не втрата події. */
function reviewReason(error: unknown): string {
  if (error instanceof ReviewRequired) return error.reason;
  // Порушення обмеження БД чи некоректне значення в даних джерела (наприклад, неможлива дата) —
  // проблема даних, а не коду: подія лишається на розборі. Помилки програми (TypeError тощо)
  // не маскуються: транзакція відкочується, і назовні йде 503.
  const sqlite = typeof error === 'object' && error !== null && (error as {code?: unknown}).code === 'ERR_SQLITE_ERROR';
  if (sqlite || error instanceof Denied) return 'unprocessable_event';
  throw error;
}

function accepted(store: Store, event: EventEnvelope, inboxId: string, now: number): IngestOutcome {
  store.run("UPDATE inbox_event SET processing_state='applied' WHERE id=?", inboxId);
  store.audit('event_validate', 'accepted', event.source_system, event.event_id, now);
  return {http: 202, status: 'accepted', business_applied: true};
}

function pending(store: Store, event: EventEnvelope, now: number): IngestOutcome {
  store.audit('event_validate', 'pending', event.source_system, event.event_id, now);
  return {http: 202, status: 'pending_review', business_applied: false};
}

/**
 * Повторна доставка тієї самої події (той самий зміст).
 *
 * Уже застосована — дублікат без жодного нового ефекту.
 * Досі на розборі — джерело має право доставити її знову: якщо попередник
 * тим часом надійшов, подія застосовується рівно один раз і розбір закривається.
 * Якщо причина розбору лишилась, стан не змінюється й новий розбір не створюється.
 */
function redeliver(store: Store, event: EventEnvelope, previous: Row[], now: number): IngestOutcome {
  const waiting = previous.find(item => item.processing_state === 'pending_review');
  if (!waiting) {
    store.audit('event_validate', 'duplicate', event.source_system, event.event_id, now);
    return {http: 200, status: 'duplicate', business_applied: false};
  }
  const inboxId = String(waiting.id);
  try {
    store.savepoint('domain_retry', () => applyEvent(store, event, inboxId, now));
  } catch (error) {
    // Причина розбору лишилась. Якщо попередній розбір уже закрили, відкриваємо новий,
    // щоб незастосована подія не стала невидимою.
    if (!store.exists("SELECT id FROM review_item WHERE inbox_event_id=? AND state='open'", inboxId)) {
      openReview(store, event, inboxId, reviewReason(error), now);
    }
    store.audit('event_validate', 'pending', event.source_system, event.event_id, now);
    return {http: 200, status: 'pending_review', business_applied: false};
  }
  const reviewedCases = store.rows(
    "SELECT DISTINCT case_id FROM review_item WHERE inbox_event_id=? AND state='open' AND case_id IS NOT NULL",
    inboxId,
  );
  store.run(
    "UPDATE review_item SET state='resolved',resolution_event_ref='source_redelivery' WHERE inbox_event_id=? AND state='open'",
    inboxId,
  );
  for (const item of reviewedCases) refreshFreshness(store, String(item.case_id));
  const applied = store.row('SELECT case_id FROM case_event WHERE inbox_event_id=?', inboxId);
  if (applied) refreshFreshness(store, String(applied.case_id));
  return accepted(store, event, inboxId, now);
}

/**
 * Той самий ідентифікатор або та сама версія потоку з іншим змістом — суперечність.
 * Підтверджений стан не перезаписується; створюється видимий розбір — один на
 * прийняту подію, скільки б разів суперечливу версію не надсилали.
 */
function recordConflict(store: Store, event: EventEnvelope, previous: Row[], now: number): IngestOutcome {
  const first = previous[0];
  const original = store.row('SELECT case_id FROM case_event WHERE inbox_event_id=? LIMIT 1', first?.id);
  const caseId = original ? String(original.case_id) : null;
  const alreadyOpen = store.exists(
    "SELECT id FROM review_item WHERE inbox_event_id=? AND reason_code='event_conflict' AND state='open'",
    first?.id,
  );
  if (!alreadyOpen) {
    store.insert('review_item', {
      id: newId(),
      case_id: caseId,
      inbox_event_id: first ? String(first.id) : null,
      reason_code: 'event_conflict',
      assigned_scope: caseId ? unitOfCase(store, caseId) : UNASSIGNED_SCOPE,
      state: 'open',
      resolution_event_ref: null,
    });
  }
  if (caseId) refreshFreshness(store, caseId);
  store.audit('event_validate', 'denied', event.source_system, event.event_id, now);
  return {http: 409, status: 'event_conflict', business_applied: false};
}

/** Розбір адресується області особи, якщо її вдалося надійно визначити. */
function openReview(store: Store, event: EventEnvelope, inboxId: string, reason: string, now: number): void {
  const at = isoTime(now);
  const person = store.row(
    `SELECT subject_id FROM identity_link
      WHERE source_namespace=? AND source_subject_token=? AND verification_state='verified'
        AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)`,
    event.source_system, event.subject_ref, at, at,
  );
  const knownCase = person && event.incident_ref
    ? store.row(
        "SELECT id FROM wound_case WHERE subject_id=? AND incident_namespace='demo-mis' AND incident_ref=?",
        person.subject_id, event.incident_ref,
      )
    : undefined;
  const assignment = person
    ? store.row(
        `SELECT unit_ref FROM unit_assignment
          WHERE subject_id=? AND verification_state='verified'
            AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)`,
        person.subject_id, at, at,
      )
    : undefined;
  const caseId = knownCase ? String(knownCase.id) : null;
  store.insert('review_item', {
    id: newId(),
    case_id: caseId,
    inbox_event_id: inboxId,
    reason_code: reason,
    assigned_scope: assignment ? String(assignment.unit_ref) : UNASSIGNED_SCOPE,
    state: 'open',
    resolution_event_ref: null,
  });
  if (caseId) refreshFreshness(store, caseId);
}

function unitOfCase(store: Store, caseId: string): string {
  const assignment = store.row(
    `SELECT u.unit_ref FROM unit_assignment u JOIN wound_case c ON c.subject_id=u.subject_id
      WHERE c.id=? AND u.verification_state='verified' AND u.valid_to IS NULL`,
    caseId,
  );
  return assignment ? String(assignment.unit_ref) : UNASSIGNED_SCOPE;
}
