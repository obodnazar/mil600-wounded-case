import type {ActionAvailability, CommandAction, StaffCaseView, StaffProfile} from '../../../shared/api';
import {COMMANDER_ACTIONS} from '../../content/actions';

export type CaseFilter = 'all' | 'review' | 'stale' | 'deadline' | 'requests';

export const CASE_FILTER_LABELS: Record<CaseFilter, string> = {
  all: 'Усі',
  review: 'Потрібна звірка',
  stale: 'Дані не оновлено',
  deadline: 'Строк на контролі',
  requests: 'Є звернення',
};

export const CASE_FILTERS: readonly CaseFilter[] = ['all', 'review', 'stale', 'deadline', 'requests'];

const MATCHERS: Record<CaseFilter, (item: StaffCaseView) => boolean> = {
  all: () => true,
  review: item => item.reviews.length > 0,
  stale: item => item.freshness === 'stale' || item.freshness === 'conflict',
  deadline: item => item.certificateDeadline.dueDate !== null || item.certificateDeadline.reviewOpen,
  requests: item => item.requests.some(request => request.state === 'open'),
};

export function countCases(cases: readonly StaffCaseView[]): Record<CaseFilter, number> {
  return {
    all: cases.length,
    review: cases.filter(MATCHERS.review).length,
    stale: cases.filter(MATCHERS.stale).length,
    deadline: cases.filter(MATCHERS.deadline).length,
    requests: cases.filter(MATCHERS.requests).length,
  };
}

/** Пошук за назвою кейсу й фільтр за станом — лише на клієнті, без запитів до сервера. */
export function selectCases(cases: readonly StaffCaseView[], filter: CaseFilter, query: string): StaffCaseView[] {
  const needle = query.trim().toLocaleLowerCase('uk');
  return cases.filter(item => MATCHERS[filter](item) && item.label.toLocaleLowerCase('uk').includes(needle));
}

/**
 * Доступність дії для кейсу. Джерело правди — `actions` із сервера; якщо дії там немає,
 * дії командира в ролі супроводу вважаємо недоступними, решту — доступними (сервер усе одно перевірить).
 */
export function availabilityOf(item: StaffCaseView, action: CommandAction, profile: StaffProfile): ActionAvailability {
  const listed = item.actions.find(entry => entry.action === action);
  if (listed) return listed;
  const commanderOnly = COMMANDER_ACTIONS.includes(action) && profile !== 'commander';
  return {action, available: !commanderOnly, reason: commanderOnly ? 'commander_only' : null};
}

/** Чи чекає кейс підтвердження джерела після запиту командира. */
export function awaitsSource(item: StaffCaseView): boolean {
  return item.tasks.some(task => task.kind === 'await_source_confirmation' && task.awaits !== null);
}
