import type {CommandAction, DemoProfile, Freshness, UnavailableReason} from '../../shared/api.js';
import type {Store} from '../db/store.js';
import {hasIssuedCertificate, hasPreparedCertificate} from './documents.js';
import {hasPendingRequest} from './tasks.js';

/**
 * Єдине місце, де визначено, чому дію зараз не можна виконати.
 * Ним користуються і обробник команд (відмова 409), і службова проєкція
 * (вимкнена кнопка з поясненням) — тому інтерфейс і сервер не розходяться.
 */

export const RESERVE_BASE_CASE = 'demo-case-02';

/**
 * Розбори й задачі, що розкривають стан виплат чи лікування. Їх веде служба супроводу;
 * командирові вони не показуються, і закривати такі розбори командир не може.
 * Тимчасове обережне рішення аудиту 2026-11-14 до рішення команди про службову проєкцію.
 */
export const SUPPORT_ONLY_REVIEWS: ReadonlySet<string> = new Set([
  'finance_without_packet_receipt', 'financial_revision_order_unknown', 'execution_regression',
  'execution_without_approval', 'completed_period_revision_review', 'packet_period_mismatch', 'unknown_finance_route',
  'care_anchor_correction_unproven', 'care_applicability_change_unproven', 'unknown_episode_or_provider',
  'episode_mismatch', 'transfer_predecessor_missing', 'admission_conflict', 'episode_case_mismatch',
]);

export const SUPPORT_ONLY_TASKS: ReadonlySet<string> = new Set(['clarify_finance', 'clarify_care_start']);

/** Задача про виплати чи лікування: за видом або, для нагадування про строк, за правилом лікування. */
export function isSupportOnlyTask(store: Store, taskId: string, kind: string): boolean {
  if (SUPPORT_ONLY_TASKS.has(kind)) return true;
  if (kind !== 'review_deadline') return false;
  return store.exists(
    `SELECT t.id FROM task t JOIN deadline d ON d.case_id=t.case_id AND d.rule_version_id='demo-rule-care'
      WHERE t.id=? AND t.trigger_ref LIKE 'demo-deadline:'||d.id||':%'`,
    taskId,
  );
}

/**
 * Свіжість кейсу для командира без прихованих від нього розборів і задач: інакше «є суперечність»
 * чи «дані не оновлено» видавали б стан виплат або лікування, з яким командир нічого не може зробити.
 */
export function commanderFreshness(
  store: Store, caseId: string, freshness: Freshness, lastSourceAt: string | null,
): Freshness {
  if (freshness !== 'conflict' && freshness !== 'stale') return freshness;
  const reviews = store.rows("SELECT id FROM review_item WHERE case_id=? AND state='open'", caseId);
  if (reviews.some(review => !isSupportOnlyReview(store, String(review.id)))) return 'conflict';
  const gap = store.exists("SELECT id FROM task WHERE case_id=? AND status='open' AND kind='reconcile_missing_event'", caseId);
  if (gap) return 'stale';
  // Без видимих проблем: «актуально», якщо джерела вже щось підтверджували, інакше — початковий стан.
  return lastSourceAt ? 'fresh' : 'unknown';
}

/**
 * Розбір стосується виплат чи лікування — за кодом причини або за типом події, якої він
 * стосується (загальні причини на кшталт `event_conflict` бувають і у фінансових подій).
 */
export function isSupportOnlyReview(store: Store, reviewId: string): boolean {
  const review = store.row(
    `SELECT r.reason_code,i.event_type FROM review_item r
       LEFT JOIN inbox_event i ON i.id=r.inbox_event_id
      WHERE r.id=?`,
    reviewId,
  );
  if (!review) return false;
  const eventType = review.event_type ? String(review.event_type) : '';
  return SUPPORT_ONLY_REVIEWS.has(String(review.reason_code)) || eventType.startsWith('finance.') || eventType.startsWith('care.');
}
export const RESERVE_CASE = 'demo-reserve-case';

const COMMANDER_ONLY: readonly CommandAction[] = ['issue_certificate', 'refer_vlk'];

function hasActiveReferral(store: Store, caseId: string): boolean {
  return store.exists(
    "SELECT id FROM document_ref WHERE case_id=? AND kind='referral' AND active=1 AND state IN ('issued','corrected')",
    caseId,
  );
}

export function hasPendingCopy(store: Store, caseId: string): boolean {
  return store.exists(
    "SELECT id FROM document_ref WHERE case_id=? AND source_system='demo-gallery' AND validation_state='pending'",
    caseId,
  );
}

export function hasOpenSupportRequest(store: Store, caseId: string): boolean {
  return store.exists("SELECT id FROM support_request WHERE case_id=? AND state='open'", caseId);
}

export function reserveExists(store: Store): boolean {
  return store.exists('SELECT id FROM wound_case WHERE id=?', RESERVE_CASE);
}

/**
 * Причина, з якої дію над кейсом зараз не можна виконати, або null.
 * Неповний технічний перелік документів навмисно НЕ є причиною відмови в направленні.
 */
export function commandBlocker(
  store: Store, role: DemoProfile, caseId: string, action: CommandAction,
): UnavailableReason | null {
  if (COMMANDER_ONLY.includes(action) && role !== 'commander') return 'commander_only';
  switch (action) {
    case 'issue_certificate':
      if (hasIssuedCertificate(store, caseId)) return 'certificate_already_issued';
      if (!hasPreparedCertificate(store, caseId)) return 'certificate_not_prepared';
      return hasPendingRequest(store, caseId, action) ? 'request_pending' : null;
    case 'refer_vlk':
      if (hasActiveReferral(store, caseId)) return 'already_referred';
      return hasPendingRequest(store, caseId, action) ? 'request_pending' : null;
    case 'verify_copy':
      return hasPendingCopy(store, caseId) ? null : 'no_pending_copy';
    case 'resolve_support':
      return hasOpenSupportRequest(store, caseId) ? null : 'no_open_request';
    case 'admin_open':
      return reserveExists(store) ? 'reserve_exists' : null;
    default:
      return null;
  }
}

/** Задачу створено вручну командою супроводу, тому її можна й закрити вручну. */
export function isManualTask(store: Store, taskId: string, caseId: string): boolean {
  return store.exists(
    `SELECT t.id FROM task t
      WHERE t.id=? AND t.case_id=? AND t.status='open'
        AND t.kind IN ('clarify_author','reconcile_missing_event')
        AND t.trigger_ref IN (SELECT id FROM demo_command)`,
    taskId, caseId,
  );
}
