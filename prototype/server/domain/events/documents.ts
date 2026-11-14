import type {Row} from '../../db/store.js';
import {kyivDate} from '../calendar.js';
import {refreshCertificateClock, syncCertificateReview} from '../deadlines.js';
import {recordSourceDocument} from '../documents.js';
import {RECIPIENT, ReviewRequired, newId, text, type EventContext} from '../model.js';
import {asEnemyAction, mergeEnemyAction} from '../rules.js';
import {hasIssuedCertificate} from '../documents.js';
import type {Store} from '../../db/store.js';
import {openTask, pendingRequestAt, resolveAwaitedCommand, resolveOpenTasksByTrigger, resolveTasks} from '../tasks.js';

/**
 * Життєвий цикл версії документа: складено → видано → надіслано → отримано.
 * Кожен крок — окреме підтвердження окремого джерела; жоден не випливає з іншого.
 */

interface DocumentRef {
  recordRef: string;
  version: string;
  kind: string;
}

const refOf = ({payload}: EventContext): DocumentRef => ({
  recordRef: text(payload, 'document_ref'),
  version: text(payload, 'document_version'),
  kind: text(payload, 'document_kind'),
});

const HOSPITAL_SOURCES = ['demo-mis', 'demo-civil-mis'];

/**
 * Довідка про перебування в закладі може нести підтверджену застосовність правила
 * (дії противника) — резерв для випадку без еПМК. Лише від медичного джерела й з доказом.
 */
function applyHospitalContext(context: EventContext, document: DocumentRef): void {
  const {store, event, payload, caseRow, caseId, caseEventId} = context;
  if (payload.enemy_action === undefined) return;
  const allowed =
    event.event_type === 'document.prepared' &&
    document.kind === 'hospital_stay_certificate' &&
    HOSPITAL_SOURCES.includes(event.source_system) &&
    Boolean(payload.applicability_evidence_ref);
  if (!allowed) throw new ReviewRequired('hospital_context_proof_missing');
  // Резервний документ не перекреслює застосовність, уже підтверджену іншим джерелом.
  const merged = mergeEnemyAction(asEnemyAction(caseRow.enemy_action), asEnemyAction(payload.enemy_action));
  if (merged.conflict) throw new ReviewRequired('applicability_change_unproven');
  store.run('UPDATE wound_case SET enemy_action=? WHERE id=?', merged.value, caseId);
  refreshCertificateClock(store, caseId, caseEventId);
}

/** Медслужба склала документ. Для довідки про обставини травми далі діє командир. */
export function applyDocumentPrepared(context: EventContext): void {
  const {store, event, caseId, caseEventId} = context;
  const document = refOf(context);
  applyHospitalContext(context, document);
  recordSourceDocument(store, {caseId, source: event.source_system, ...document, state: 'prepared'});
  if (document.kind !== 'trauma_certificate') return;
  resolveTasks(store, caseId, 'prepare_certificate', 'source_prepared');
  const issueTrigger = `demo-cert-issue:${caseId}:${document.recordRef}:${document.version}`;
  openTask(store, caseId, 'issue_certificate', 'commander', issueTrigger, caseEventId);
}

/**
 * Коли подія вперше надійшла до шлюзу (ISO). Береться з рядка inbox, під яким подію прийнято:
 * повторна доставка — навіть із новим event_id, але тим самим змістом — зберігає перше надходження.
 */
function firstArrival(store: Store, inboxId: string): string | null {
  const inbox = store.row('SELECT received_at FROM inbox_event WHERE id=?', inboxId);
  return inbox ? String(inbox.received_at) : null;
}

/** Тригер очікування квитанції для конкретного запису й версії довідки. */
const receiptTrigger = (caseId: string, recordRef: string, version: string): string =>
  `demo-cert-receipt:${caseId}:${recordRef}:${version}`;

/**
 * Підтвердження джерела стосується лише запиту, поданого до того, як підтвердження надійшло:
 * подія, що чекала на розборі ще до запиту командира, не може бути підтвердженням цього запиту.
 */
export function assertConfirmsPendingRequest(
  store: Store, inboxId: string, caseId: string, action: 'issue_certificate' | 'refer_vlk', reason: string,
): void {
  const requestedAt = pendingRequestAt(store, caseId, action);
  if (!requestedAt) throw new ReviewRequired(reason);
  const arrived = firstArrival(store, inboxId);
  if (arrived && Date.parse(arrived) < Date.parse(requestedAt)) throw new ReviewRequired('confirmation_before_request');
}

/**
 * Джерело підтвердило видачу довідки про обставини травми. Потрібні обидві передумови:
 * складена медслужбою версія саме цього виду та ще не підтверджений запит командира.
 * Один запит командира — одне підтвердження видачі. Підтверджена видача закриває
 * нагадування про строк і перевірку стану видачі.
 */
export function applyDocumentIssued(context: EventContext): void {
  const {store, event, caseId, caseEventId, inboxId} = context;
  const document = refOf(context);
  applyHospitalContext(context, document);
  if (document.kind !== 'trauma_certificate') throw new ReviewRequired('issue_kind_mismatch');
  const prepared = store.exists(
    `SELECT id FROM document_ref
      WHERE case_id=? AND source_record_ref=? AND document_version=?
        AND state='prepared' AND source_system='demo-mis' AND kind='trauma_certificate'`,
    caseId, document.recordRef, document.version,
  );
  if (!prepared) throw new ReviewRequired('issue_needs_preparation_and_command');
  assertConfirmsPendingRequest(store, inboxId, caseId, 'issue_certificate', 'issue_needs_preparation_and_command');
  recordSourceDocument(store, {caseId, source: event.source_system, ...document, state: 'issued'});
  resolveAwaitedCommand(store, caseId, 'command.issue_certificate');
  // Складена чернетка медслужби поступається місцем виданій версії.
  store.run(
    `UPDATE document_ref SET active=0
      WHERE case_id=? AND source_record_ref=? AND source_system='demo-mis' AND state='prepared'`,
    caseId, document.recordRef,
  );
  resolveTasks(store, caseId, 'issue_certificate', 'source_issued');
  resolveTasks(store, caseId, 'certificate_status_check', 'certificate_issue_confirmed');
  openTask(store, caseId, 'await_recipient_receipt', 'support', receiptTrigger(caseId, document.recordRef, document.version), caseEventId);
  syncCertificateReview(store, caseId);
}

/**
 * Виправлена версія замінює попередню, але не успадковує її квитанцію:
 * отримання нової версії адресат підтверджує окремо. Історія зберігається.
 *
 * Виправлення не змінює стадії документа: виправлена складена версія лишається
 * складеною, а «виправленою виданою» стає лише версія, видачу якої вже підтвердило
 * джерело. Довідку про обставини травми можна виправити тільки після видачі —
 * інакше виправлення підробило б підтвердження видачі.
 */
export function applyDocumentCorrected(context: EventContext): void {
  const {store, event, payload, caseId} = context;
  const document = refOf(context);
  applyHospitalContext(context, document);
  const previousVersion = text(payload, 'supersedes_document_version');
  const previous = store.row(
    `SELECT id,state FROM document_ref
      WHERE case_id=? AND source_system=? AND source_record_ref=? AND document_version=? AND active=1`,
    caseId, event.source_system, document.recordRef, previousVersion,
  );
  if (!previous || document.version === previousVersion) throw new ReviewRequired('correction_predecessor_missing');
  const wasIssued = previous.state === 'issued' || previous.state === 'corrected';
  if (document.kind === 'trauma_certificate' && !wasIssued) throw new ReviewRequired('correction_before_issue');
  const inherited = String(previous.state);
  const state = wasIssued ? 'corrected' : inherited === 'prepared' ? 'prepared' : 'recorded';
  store.run('UPDATE document_ref SET active=0 WHERE id=?', previous.id);
  recordSourceDocument(store, {
    caseId,
    source: event.source_system,
    ...document,
    state,
    supersedesId: String(previous.id),
  });
  // Квитанцію тепер очікуємо саме на нову видану версію довідки, а не на замінену.
  if (document.kind === 'trauma_certificate') {
    const previousTrigger = receiptTrigger(caseId, document.recordRef, previousVersion);
    resolveOpenTasksByTrigger(store, caseId, 'await_recipient_receipt', previousTrigger, 'version_superseded');
    const trigger = receiptTrigger(caseId, document.recordRef, document.version);
    openTask(store, caseId, 'await_recipient_receipt', 'support', trigger, context.caseEventId);
  }
}

/**
 * Відкликання не стирає запис: версія стає неактивною, а уточнення адресується автору.
 * Якщо відкликано видану довідку, нагадування про строк її видачі знову чинне.
 */
export function applyDocumentWithdrawn(context: EventContext): void {
  const {store, event, caseId, caseEventId} = context;
  const document = refOf(context);
  applyHospitalContext(context, document);
  const target = store.row(
    `SELECT id FROM document_ref
      WHERE case_id=? AND source_system=? AND source_record_ref=? AND document_version=?`,
    caseId, event.source_system, document.recordRef, document.version,
  );
  if (!target) throw new ReviewRequired('unknown_document');
  store.run("UPDATE document_ref SET active=0,state='withdrawn' WHERE id=?", target.id);
  const targetId = String(target.id);
  openTask(store, caseId, 'clarify_author', 'support', `demo-withdrawn:${targetId}`, caseEventId);
  if (document.kind === 'trauma_certificate') {
    restartCertificateRoute(store, caseId, receiptTrigger(caseId, document.recordRef, document.version), targetId, caseEventId);
  }
  syncCertificateReview(store, caseId);
}

/**
 * Після відкликання чинної довідки маршрут починається знову: квитанція відкликаної
 * версії більше не очікується, а медслужба має скласти нову версію.
 */
function restartCertificateRoute(store: Store, caseId: string, receipt: string, withdrawnId: string, caseEventId: string): void {
  resolveOpenTasksByTrigger(store, caseId, 'await_recipient_receipt', receipt, 'version_withdrawn');
  if (hasIssuedCertificate(store, caseId)) return;
  const trigger = `demo-cert-prepare:${caseId}:after-withdrawal:${withdrawnId}`;
  openTask(store, caseId, 'prepare_certificate', 'medical_service', trigger, caseEventId);
}

const KNOWN_RECIPIENTS: readonly string[] = Object.values(RECIPIENT);

/** Відправлення — лише факт відправлення виданої чинної версії; отримання підтверджується окремо. */
export function applyDocumentSent({store, event, payload, caseId}: EventContext): void {
  const recipient = text(payload, 'recipient_ref');
  const document = store.row(
    `SELECT id FROM document_ref
      WHERE case_id=? AND source_system=? AND source_record_ref=? AND document_version=?
        AND active=1 AND state IN ('issued','corrected')`,
    caseId, event.source_system, text(payload, 'document_ref'), text(payload, 'document_version'),
  );
  if (!document || !KNOWN_RECIPIENTS.includes(recipient)) {
    throw new ReviewRequired('dispatch_document_or_recipient_unknown');
  }
  store.run(
    `INSERT INTO delivery(id,document_ref_id,recipient_ref,delivery_kind,sent_at,state)
     VALUES (?,?,?,'electronic',?,'sent')
     ON CONFLICT(document_ref_id,recipient_ref,delivery_kind) DO UPDATE SET
       sent_at=excluded.sent_at,
       state=CASE WHEN delivery.received_at IS NULL THEN 'sent' ELSE 'received' END`,
    newId(), document.id, recipient, text(payload, 'sent_at'),
  );
}

const RECIPIENT_BY_KIND: Readonly<Record<string, string>> = {
  vlk: RECIPIENT.vlk,
  finance: RECIPIENT.finance,
  part: RECIPIENT.part,
};

/** Чинна версія, якої стосується квитанція; видана версія має пріоритет над складеною. */
function receivedDocument({store, payload, caseId}: EventContext): Row {
  const candidates = store.rows(
    `SELECT * FROM document_ref
      WHERE case_id=? AND source_record_ref=? AND document_version=?
        AND active=1 AND provenance='source_reference'
      ORDER BY CASE WHEN state IN ('issued','corrected') THEN 0 ELSE 1 END`,
    caseId, text(payload, 'document_ref'), text(payload, 'document_version'),
  );
  const document = candidates[0];
  const issued = document && ['issued', 'corrected'].includes(String(document.state));
  if (document?.kind === 'trauma_certificate' && !issued) throw new ReviewRequired('receipt_before_issue');
  if (!document) throw new ReviewRequired('receipt_unknown_version');
  return document;
}

/**
 * Квитанція про отримання конкретної версії конкретним адресатом.
 * Суперечлива повторна квитанція не пересуває підтверджену дату — вона йде на розбір.
 * Отримання військовослужбовцем медичного документа запускає відлік строку довідки,
 * але лише один раз: пізніші квитанції інших версій підтверджену дату не змінюють.
 */
export function applyDocumentReceived(context: EventContext): void {
  const {store, payload, caseRow, caseId} = context;
  const document = receivedDocument(context);
  const recipientKind = text(payload, 'recipient_kind');
  const recipient = text(payload, 'recipient_ref');
  const toServicemember = recipientKind === 'servicemember';
  if (toServicemember && recipient !== caseRow.subject_id) throw new ReviewRequired('receipt_wrong_person');
  if (!toServicemember && recipient !== RECIPIENT_BY_KIND[recipientKind]) {
    throw new ReviewRequired('receipt_wrong_recipient');
  }
  const receivedAt = text(payload, 'received_at');
  assertPlausibleReceipt(context, receivedAt, toServicemember);
  const earlier = store.row(
    'SELECT received_at FROM delivery WHERE document_ref_id=? AND recipient_ref=? AND received_at IS NOT NULL',
    document.id, recipient,
  );
  if (earlier && Date.parse(String(earlier.received_at)) !== Date.parse(receivedAt)) {
    throw new ReviewRequired('receipt_date_conflict');
  }
  store.run(
    `INSERT INTO delivery(id,document_ref_id,recipient_ref,delivery_kind,sent_at,received_at,receipt_ref,state)
     VALUES (?,?,?,'electronic',NULL,?,?,'received')
     ON CONFLICT(document_ref_id,recipient_ref,delivery_kind) DO UPDATE SET
       received_at=excluded.received_at,receipt_ref=excluded.receipt_ref,state='received'`,
    newId(), document.id, recipient, receivedAt, text(payload, 'evidence_ref'),
  );
  // Квитанцію на довідку закриває лише отримання саме чинної версії довідки, а не будь-якого документа.
  if (recipientKind === 'vlk' && document.kind === 'trauma_certificate') {
    const trigger = receiptTrigger(caseId, String(document.source_record_ref), String(document.document_version));
    resolveOpenTasksByTrigger(store, caseId, 'await_recipient_receipt', trigger, 'receipt_confirmed');
  }
  if (toServicemember && startsCertificateClock(context, document)) {
    anchorCertificateClock(context, receivedAt);
  }
}

const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Неможлива хронологія не приймається мовчки: отримання в майбутньому або до поранення. */
function assertPlausibleReceipt({caseRow, now}: EventContext, receivedAt: string, toServicemember: boolean): void {
  if (Date.parse(receivedAt) > now + CLOCK_SKEW_MS) throw new ReviewRequired('receipt_in_future');
  const injuryDate = caseRow.injury_date ? String(caseRow.injury_date) : null;
  if (toServicemember && injuryDate && kyivDate(receivedAt) < injuryDate) {
    throw new ReviewRequired('receipt_before_injury');
  }
}

/**
 * Якір відліку — перше підтверджене отримання. Пізніша квитанція іншої версії його
 * не змінює. Квитанція з ранішою датою, що надійшла пізніше, зрушила б уже
 * підтверджений строк, тому вона йде на розбір, а не застосовується мовчки.
 */
function anchorCertificateClock({store, caseRow, caseId, caseEventId}: EventContext, receivedAt: string): void {
  const confirmed = caseRow.patient_received_at ? String(caseRow.patient_received_at) : null;
  if (confirmed && Date.parse(receivedAt) < Date.parse(confirmed)) {
    throw new ReviewRequired('receipt_would_move_confirmed_anchor');
  }
  if (confirmed) return;
  store.run('UPDATE wound_case SET patient_received_at=? WHERE id=?', receivedAt, caseId);
  refreshCertificateClock(store, caseId, caseEventId);
  resolveTasks(store, caseId, 'confirm_receipt_date', 'receipt_confirmed');
}

/**
 * Якорем відліку є отримання еПМК; довідка про перебування в закладі — резерв,
 * що діє лише тоді, коли чинної еПМК у кейсі немає.
 */
function startsCertificateClock({store, caseId}: EventContext, document: Row): boolean {
  if (document.kind === 'primary_medical_card') return true;
  if (document.kind !== 'hospital_stay_certificate') return false;
  return !store.exists(
    "SELECT id FROM document_ref WHERE case_id=? AND kind='primary_medical_card' AND active=1",
    caseId,
  );
}
