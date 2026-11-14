import {Denied, type Session} from '../../security/core.js';
import type {ActionAvailability, CommandAction, StaffCaseView, StaffProfile, StaffView} from '../../shared/api.js';
import type {Store} from '../db/store.js';
import {RESERVE_BASE_CASE, commandBlocker} from '../domain/preconditions.js';
import {caseSummary} from './case-view.js';

/** Дії над кейсом, доступність яких службова панель показує наперед. */
const CASE_ACTIONS: readonly CommandAction[] = [
  'issue_certificate',
  'refer_vlk',
  'clarify',
  'verify_copy',
  'support_request',
  'resolve_support',
];

function availability(store: Store, role: StaffProfile, caseId: string, action: CommandAction): ActionAvailability {
  const reason = commandBlocker(store, role, caseId, action);
  return {action, available: reason === null, reason};
}

/**
 * Службова проєкція одного кейсу: стадія, задачі, розбори, звернення, строк довідки.
 * Клінічних полів, місця лікування, документних посилань і фінансових станів
 * у цьому DTO немає взагалі — їх не можна випадково показати.
 */
export function staffCaseView(store: Store, role: StaffProfile, caseId: string): StaffCaseView {
  return {
    ...caseSummary(store, caseId, {staff: true}),
    actions: CASE_ACTIONS.map(action => availability(store, role, caseId, action)),
  };
}

export function staffView(store: Store, session: Session): StaffView {
  if (session.role !== 'commander' && session.role !== 'support') throw new Denied(403, 'forbidden');
  const role = session.role;
  return {
    profile: role,
    cases: [...session.caseIds].sort().map(caseId => staffCaseView(store, role, caseId)),
    reserve: {
      baseCaseId: RESERVE_BASE_CASE,
      action: availability(store, role, RESERVE_BASE_CASE, 'admin_open'),
    },
  };
}
