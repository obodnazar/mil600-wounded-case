import type {CommandAction, DemoProfile, UnavailableReason} from '../../shared/api.js';
import type {Store} from '../db/store.js';
import {hasIssuedCertificate, hasPreparedCertificate} from './documents.js';
import {hasPendingRequest} from './tasks.js';

/**
 * Єдине місце, де визначено, чому дію зараз не можна виконати.
 * Ним користуються і обробник команд (відмова 409), і службова проєкція
 * (вимкнена кнопка з поясненням) — тому інтерфейс і сервер не розходяться.
 */

export const RESERVE_BASE_CASE = 'demo-case-02';
export const RESERVE_CASE = 'demo-reserve-case';

const COMMANDER_ONLY: readonly CommandAction[] = ['issue_certificate', 'refer_vlk'];

function hasActiveReferral(store: Store, caseId: string): boolean {
  return store.exists("SELECT id FROM document_ref WHERE case_id=? AND kind='referral' AND active=1", caseId);
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
