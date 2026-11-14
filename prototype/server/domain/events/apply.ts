import type {EventEnvelope} from '../../../security/core.js';
import type {Row, Store} from '../../db/store.js';
import {appendCaseEvent, enqueueProjection} from '../case-log.js';
import {refreshFreshness} from '../freshness.js';
import {ReviewRequired, isoTime, newId, type EventHandler} from '../model.js';
import {
  applyDocumentCorrected,
  applyDocumentIssued,
  applyDocumentPrepared,
  applyDocumentReceived,
  applyDocumentSent,
  applyDocumentWithdrawn,
} from './documents.js';
import {applyFinanceStatus} from './finance.js';
import {
  applyCareArrival,
  applyCareDischarged,
  applyCareStartConfirmed,
  applyPrimaryRecorded,
  applySyncGap,
} from './medical.js';
import {applyPackageSignal, applyReferralIssued, applyServiceActionConfirmed, applyVlkDecision} from './vlk.js';

/** Таблиця переходів: тип джерельної події → правило, що змінює стан кейсу. */
const HANDLERS: Readonly<Record<string, EventHandler>> = {
  'medical.primary_recorded': applyPrimaryRecorded,
  'source.sync_gap': applySyncGap,
  'care.start_confirmed': applyCareStartConfirmed,
  'care.admitted': applyCareArrival,
  'care.transferred': applyCareArrival,
  'care.discharged': applyCareDischarged,
  'document.prepared': applyDocumentPrepared,
  'document.issued': applyDocumentIssued,
  'document.corrected': applyDocumentCorrected,
  'document.withdrawn': applyDocumentWithdrawn,
  'document.sent': applyDocumentSent,
  'document.received': applyDocumentReceived,
  'referral.issued': applyReferralIssued,
  'vlk.package_received': applyPackageSignal,
  'vlk.package_returned': applyPackageSignal,
  'finance.package_received': applyPackageSignal,
  'vlk.decision_recorded': applyVlkDecision,
  'service.action_confirmed': applyServiceActionConfirmed,
  'finance.status_recorded': applyFinanceStatus,
};

const PRIMARY = 'medical.primary_recorded';

/**
 * Застосовує перевірену джерельну подію до кейсу. Викликається лише всередині
 * транзакції шлюзу; будь-яка невизначеність кидає ReviewRequired, і подія
 * лишається на розборі без зміни бізнес-стану.
 *
 * `confirmedCaseId` передається тільки після ручної звірки випадку людиною.
 */
export function applyEvent(
  store: Store, event: EventEnvelope, inboxId: string, now: number, confirmedCaseId?: string,
): string {
  const subjectId = verifiedSubject(store, event, isoTime(now));
  if (!event.incident_ref && !confirmedCaseId) throw new ReviewRequired('missing_incident');

  let caseRow = confirmedCaseId
    ? confirmedCase(store, event, subjectId, confirmedCaseId)
    : linkedCase(store, event, subjectId);
  if (!caseRow && event.event_type !== PRIMARY) throw new ReviewRequired('unknown_incident');
  assertRevisionOrder(store, event);
  caseRow ??= openCaseFromMedicalEvent(store, event, subjectId);

  const caseId = String(caseRow.id);
  const caseEventId = appendCaseEvent(store, {
    caseId,
    type: event.event_type,
    payload: event.payload,
    now,
    inboxId,
    source: event.source_system,
    version: event.source_version,
    occurredAt: event.occurred_at,
  });

  const handler = HANDLERS[event.event_type];
  if (!handler) throw new ReviewRequired('unsupported_type');
  handler({store, event, payload: event.payload, caseRow, caseId, caseEventId, now});

  closeRecoveredGap(store, event, caseId);
  advanceCursor(store, event);
  store.run('UPDATE wound_case SET revision=revision+1,last_source_at=? WHERE id=?', isoTime(now), caseId);
  refreshFreshness(store, caseId);
  enqueueProjection(store, caseId, caseEventId, `${event.source_system}:${event.event_id}`);
  return caseId;
}

/** Особа визначається лише чинною перевіреною прив’язкою джерела; жодного нечіткого зіставлення. */
function verifiedSubject(store: Store, event: EventEnvelope, at: string): string {
  const link = store.row(
    `SELECT subject_id FROM identity_link
      WHERE source_namespace=? AND source_subject_token=? AND verification_state='verified'
        AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)`,
    event.source_system, event.subject_ref, at, at,
  );
  if (!link) throw new ReviewRequired('unknown_identity');
  return String(link.subject_id);
}

function linkedCase(store: Store, event: EventEnvelope, subjectId: string): Row | undefined {
  if (event.source_system === 'demo-mis') {
    return store.row(
      "SELECT * FROM wound_case WHERE subject_id=? AND incident_namespace='demo-mis' AND incident_ref=?",
      subjectId, event.incident_ref,
    );
  }
  return store.row(
    `SELECT c.* FROM wound_case c JOIN incident_link l ON l.case_id=c.id
      WHERE l.source=? AND l.subject_id=? AND l.incident_ref=?`,
    event.source_system, subjectId, event.incident_ref,
  );
}

/** Ручна звірка стосується лише подій без посилання на випадок і лише кейсів тієї самої особи. */
function confirmedCase(store: Store, event: EventEnvelope, subjectId: string, caseId: string): Row {
  const target = store.row('SELECT * FROM wound_case WHERE id=? AND subject_id=?', caseId, subjectId);
  if (!target || event.incident_ref !== null) throw new ReviewRequired('identity_incident_mismatch');
  return target;
}

/**
 * Порядок версій одного потоку має бути доведений: нова версія або збігається
 * з останньою прийнятою, або явно її замінює. Інакше — розбір, а не мовчазне перезаписування.
 */
function assertRevisionOrder(store: Store, event: EventEnvelope): void {
  const cursor = store.row(
    'SELECT version FROM source_cursor WHERE source=? AND stream=? AND event_type=?',
    event.source_system, event.source_stream, event.event_type,
  );
  if (!cursor) return;
  if (event.source_version !== cursor.version && event.supersedes_version !== cursor.version) {
    throw new ReviewRequired('unproven_revision_order');
  }
}

/** Новий підтверджений випадок відкривається без вигаданої дати поранення. */
function openCaseFromMedicalEvent(store: Store, event: EventEnvelope, subjectId: string): Row {
  const id = newId();
  store.insert('wound_case', {
    id,
    subject_id: subjectId,
    incident_namespace: 'demo-mis',
    incident_ref: event.incident_ref,
    origin: 'medical_event',
    injury_date: null,
    injury_date_assurance: 'unknown',
    lifecycle_state: 'source_linked',
    revision: 1,
  });
  const created = store.row('SELECT * FROM wound_case WHERE id=?', id);
  if (!created) throw new Error('case_insert_failed');
  return created;
}

/** Прогалину закриває лише саме той сигнал, якого бракувало: те саме джерело, тип і потік. */
function closeRecoveredGap(store: Store, event: EventEnvelope, caseId: string): void {
  store.run(
    `UPDATE task SET status='resolved',resolution_code='source_signal_recovered'
      WHERE case_id=? AND kind='reconcile_missing_event' AND trigger_ref=?`,
    caseId, `demo-gap:${event.source_system}:${event.event_type}:${event.source_stream}`,
  );
}

function advanceCursor(store: Store, event: EventEnvelope): void {
  store.run(
    `INSERT INTO source_cursor VALUES (?,?,?,?)
     ON CONFLICT(source,stream,event_type) DO UPDATE SET version=excluded.version`,
    event.source_system, event.source_stream, event.event_type, event.source_version,
  );
}
