import type {Store} from '../../db/store.js';
import {refreshCertificateClock, saveCareControl} from '../deadlines.js';
import {ensureRequirements, recordSourceDocument} from '../documents.js';
import {kyivDate} from '../calendar.js';
import {ReviewRequired, isoTime, newId, optionalText, text, type EventContext, type Route} from '../model.js';
import {asEnemyAction, mergeCareApplicability, mergeEnemyAction} from '../rules.js';
import {openTask, resolveTasks} from '../tasks.js';

const ROUTES: readonly Route[] = ['vlk', 'reward', 'ogd'];

/**
 * Первинний медичний запис (еПМК) від медичного джерела — основний тригер кейсу.
 * Підтверджує медичний факт, який адміністративний запит створити не може.
 *
 * Нова версія еПМК не зрушує вже підтверджену дату надходження, не знижує підтверджену
 * застосовність правила до «невідомо» і не пересуває орієнтир: ним лишається
 * найраніше внесення запису джерелом. Суперечність «так ↔ ні» йде на розбір.
 */
export function applyPrimaryRecorded({store, event, payload, caseRow, caseId, caseEventId}: EventContext): void {
  const injuryDate = optionalText(payload, 'injury_date');
  const enemyAction = mergeEnemyAction(asEnemyAction(caseRow.enemy_action), asEnemyAction(payload.enemy_action));
  if (enemyAction.conflict) throw new ReviewRequired('applicability_change_unproven');
  // Підтверджена дата поранення не змінюється мовчки новою версією запису.
  const confirmedInjury = caseRow.injury_date_assurance === 'confirmed' ? caseRow.injury_date : null;
  if (confirmedInjury && injuryDate && injuryDate !== confirmedInjury) throw new ReviewRequired('injury_date_change_unproven');
  store.run(
    `UPDATE wound_case SET
       source_linked=1,
       source_recorded_at=?,
       enemy_action=?,
       injury_date=COALESCE(?,injury_date),
       injury_date_assurance=CASE WHEN ? IS NULL THEN injury_date_assurance ELSE 'confirmed' END,
       lifecycle_state=CASE WHEN lifecycle_state='administrative_open' THEN 'source_linked' ELSE lifecycle_state END
     WHERE id=?`,
    earliest(caseRow.source_recorded_at, event.recorded_at),
    enemyAction.value,
    injuryDate, injuryDate, caseId,
  );
  for (const route of ROUTES) ensureRequirements(store, caseId, route, packetRefFor(store, caseId, route));
  resolveTasks(store, caseId, 'await_primary_source', 'primary_source_confirmed');
  recordSourceDocument(store, {
    caseId,
    source: event.source_system,
    recordRef: event.source_record_ref,
    version: text(payload, 'document_version'),
    kind: 'primary_medical_card',
    state: 'recorded',
  });
  refreshCertificateClock(store, caseId, caseEventId);
  openTask(store, caseId, 'prepare_certificate', 'medical_service', `demo-cert-prepare:${caseId}`, caseEventId);
}

/** Найраніший із двох моментів часу (ISO); відсутній попередній не враховується. */
function earliest(previous: unknown, incoming: string): string {
  if (typeof previous !== 'string' || !previous) return incoming;
  return Date.parse(previous) <= Date.parse(incoming) ? previous : incoming;
}

/** Пакет маршруту: уже отриманий адресатом, уже описаний переліком або типовий для кейсу. */
function packetRefFor(store: Store, caseId: string, route: Route): string {
  const received = store.row('SELECT packet_ref FROM route_packet WHERE case_id=? AND route=?', caseId, route);
  if (received) return String(received.packet_ref);
  const listed = store.row('SELECT packet_ref FROM case_requirement WHERE case_id=? AND route=? LIMIT 1', caseId, route);
  if (listed) return String(listed.packet_ref);
  return `demo-${route}-packet-${caseId.slice(-2)}`;
}

/** Джерело повідомило, що очікуваний сигнал не надійшов: дані позначаються неоновленими. */
export function applySyncGap({store, event, payload, caseId, caseEventId}: EventContext): void {
  const expected = `${text(payload, 'expected_type')}:${text(payload, 'expected_stream')}`;
  const trigger = `demo-gap:${event.source_system}:${expected}`;
  openTask(store, caseId, 'reconcile_missing_event', 'support', trigger, caseEventId);
}

/* ───────────── Лікування ───────────── */

function requireEpisodeAndProvider({store, event, payload}: EventContext): void {
  const provider = store.exists('SELECT id FROM demo_provider WHERE id=?', text(payload, 'provider_ref'));
  if (!event.episode_ref || !provider) throw new ReviewRequired('unknown_episode_or_provider');
}

/**
 * Підтверджений початок безперервного лікування — єдиний якір чотиримісячного контролю.
 * Інша дата без доказу, що вона виправляє попередній запис, іде на розбір і нічого не зрушує.
 * Підтверджена застосовність контролю не знижується до «невідомо» подією без цього поля;
 * суперечність «застосовується ↔ не застосовується» теж іде на розбір.
 */
export function applyCareStartConfirmed(context: EventContext): void {
  requireEpisodeAndProvider(context);
  const {store, payload, caseRow, caseId, caseEventId} = context;
  const date = optionalText(payload, 'date');
  if (caseRow.continuous_start && date !== caseRow.continuous_start) {
    const previous = store.row(
      `SELECT minimal_payload FROM case_event
        WHERE case_id=? AND event_type='care.start_confirmed' AND id!=?
        ORDER BY rowid DESC LIMIT 1`,
      caseId, caseEventId,
    );
    const previousEvidence = previous ? JSON.parse(String(previous.minimal_payload)).evidence_ref : undefined;
    if (!previous || payload.supersedes_anchor_evidence_ref !== previousEvidence) {
      throw new ReviewRequired('care_anchor_correction_unproven');
    }
  }
  assertPlausibleCareStart(context, date);
  const applicability = mergeCareApplicability(caseRow.care_applicability, payload.care_applicable);
  if (applicability.conflict) throw new ReviewRequired('care_applicability_change_unproven');
  const careApplicable = applicability.value === 'applicable' ? true : applicability.value === 'not_applicable' ? false : null;
  saveCareControl(store, caseId, caseEventId, date, careApplicable);
}

/** Початок лікування не може бути в майбутньому чи раніше за підтверджену дату поранення. */
function assertPlausibleCareStart({caseRow, now}: EventContext, date: string | null, prefix = 'care_start'): void {
  if (!date) return;
  if (date > kyivDate(isoTime(now))) throw new ReviewRequired(`${prefix}_in_future`);
  const injury = caseRow.injury_date_assurance === 'confirmed' ? caseRow.injury_date : null;
  if (typeof injury === 'string' && date < injury) throw new ReviewRequired(`${prefix}_before_injury`);
}

/**
 * Перше підтверджене надходження на лікування — якір п’ятиденного строку довідки (ADR 0012).
 * Переведення й повторне надходження його не змінюють. Надходження з ранішою датою, що
 * прийшло після підтвердженого якоря, зрушило б строк — воно йде на розбір.
 */
function assertAdmissionAnchor({caseRow}: EventContext, date: string): boolean {
  const confirmed = caseRow.admitted_on ? String(caseRow.admitted_on) : null;
  if (confirmed && date < confirmed) throw new ReviewRequired('admission_would_move_confirmed_anchor');
  return confirmed === null;
}

function anchorAdmission({store, caseId, caseEventId}: EventContext, date: string): void {
  store.run('UPDATE wound_case SET admitted_on=? WHERE id=?', date, caseId);
  refreshCertificateClock(store, caseId, caseEventId);
  resolveTasks(store, caseId, 'confirm_admission_date', 'admission_confirmed');
}

/** Виписка закриває поточний епізод; наступний заклад не вигадується. */
export function applyCareDischarged(context: EventContext): void {
  requireEpisodeAndProvider(context);
  const {store, event, payload, caseRow, caseId} = context;
  if (caseRow.current_episode !== event.episode_ref) throw new ReviewRequired('episode_mismatch');
  store.run(
    'UPDATE treatment_episode SET end_date=? WHERE case_id=? AND source_episode_ref=?',
    optionalText(payload, 'date'), caseId, event.episode_ref,
  );
  store.run('UPDATE wound_case SET current_episode=NULL WHERE id=?', caseId);
}

/**
 * Надходження або переведення. Переведення вимагає доказу попереднього епізоду
 * й закриває його; початок безперервного лікування при цьому не змінюється.
 */
export function applyCareArrival(context: EventContext): void {
  requireEpisodeAndProvider(context);
  const {store, event, payload, caseRow, caseId} = context;
  const date = optionalText(payload, 'date');
  const current = caseRow.current_episode;
  const transfer = event.event_type === 'care.transferred';
  if (transfer && (!payload.previous_episode_ref || current !== payload.previous_episode_ref)) {
    throw new ReviewRequired('transfer_predecessor_missing');
  }
  if (!transfer && current && current !== event.episode_ref) throw new ReviewRequired('admission_conflict');
  const anchors = !transfer && date !== null && (assertPlausibleCareStart(context, date, 'admission'), assertAdmissionAnchor(context, date));
  if (current && current !== event.episode_ref) {
    store.run(
      'UPDATE treatment_episode SET end_date=? WHERE case_id=? AND source_episode_ref=? AND end_date IS NULL',
      date, caseId, current,
    );
  }
  const existing = store.row(
    'SELECT case_id FROM treatment_episode WHERE source_system=? AND source_episode_ref=?',
    event.source_system, event.episode_ref,
  );
  if (existing && existing.case_id !== caseId) throw new ReviewRequired('episode_case_mismatch');
  if (!existing) {
    store.insert('treatment_episode', {
      id: newId(),
      case_id: caseId,
      source_system: event.source_system,
      source_episode_ref: event.episode_ref,
      provider_ref: text(payload, 'provider_ref'),
      start_date: date,
      end_date: null,
      evidence_ref: text(payload, 'evidence_ref'),
      assurance: date ? 'confirmed' : 'unknown',
    });
  }
  // Подія лікування оновлює епізод, але не відкочує стадію кейсу назад (наприклад, з дії за постановою ВЛК).
  store.run(
    `UPDATE wound_case SET current_episode=?,
       lifecycle_state=CASE WHEN lifecycle_state IN ('administrative_open','source_linked') THEN 'care' ELSE lifecycle_state END
     WHERE id=?`,
    event.episode_ref, caseId,
  );
  if (anchors && date) anchorAdmission(context, date);
}
