import {Denied, type Session} from '../../security/core.js';
import type {ActionAvailability, CommandAction, StaffCaseView, StaffProfile, StaffView} from '../../shared/api.js';
import type {Store} from '../db/store.js';
import {
  RESERVE_BASE_CASE, commandBlocker, commanderFreshness, isSupportOnlyReview, isSupportOnlyTask,
} from '../domain/preconditions.js';
import {caseSummary, currentFacility, financeTracks, milestones} from './case-view.js';

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
 * Службова проєкція одного кейсу: стадія, задачі, розбори, звернення, строк довідки
 * й адресний мінімум (рішення команди 2026-11-14). Клінічних полів і документних
 * посилань у цьому DTO немає взагалі — їх не можна випадково показати.
 */
export function staffCaseView(store: Store, role: StaffProfile, caseId: string): StaffCaseView {
  const summary = caseSummary(store, caseId, {staff: true});
  // Командир бачить службовий мінімум: без задач і розборів про виплати та лікування.
  const visible = role === 'commander'
    ? {
        tasks: summary.tasks.filter(task => !isSupportOnlyTask(store, task.id, task.kind)),
        reviews: summary.reviews.filter(review => !isSupportOnlyReview(store, review.id)),
        freshness: commanderFreshness(store, caseId, summary.freshness, summary.lastSourceAt),
      }
    : {};
  const marks = milestones(store, caseId);
  return {
    ...summary,
    ...visible,
    address: {
      certificate: marks.certificate,
      facility: currentFacility(store, caseId),
      vlkDecision: marks.vlkDecision,
      // Лише вид, період і стан: без посилань на рішення, доказів виконання й сум.
      finances: financeTracks(store, caseId).map(({kind, periodStart, status}) => ({kind, periodStart, status})),
    },
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
