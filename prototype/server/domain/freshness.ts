import type {Freshness} from '../../shared/api.js';
import type {Store} from '../db/store.js';

/**
 * Свіжість кейсу виводиться з усіх відкритих проблем одразу, тому закриття однієї
 * (наприклад, ручна звірка випадку) не приховує іншу (незакриту прогалину даних):
 *
 *   відкритий розбір суперечності          → conflict
 *   відкрита прогалина / невідомий сигнал  → stale
 *   інакше                                 → fresh
 */
export function computeFreshness(store: Store, caseId: string): Freshness {
  if (store.exists("SELECT 1 FROM review_item WHERE case_id=? AND state='open'", caseId)) return 'conflict';
  const gap = store.exists(
    `SELECT 1 FROM task
      WHERE case_id=? AND status='open'
        AND (kind='reconcile_missing_event' OR trigger_ref LIKE 'demo-finance-unknown:%')`,
    caseId,
  );
  return gap ? 'stale' : 'fresh';
}

export function refreshFreshness(store: Store, caseId: string): void {
  store.run('UPDATE wound_case SET freshness_state=? WHERE id=?', computeFreshness(store, caseId), caseId);
}
