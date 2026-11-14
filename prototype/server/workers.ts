import type {Store} from './db/store.js';
import {reviewOverdueDeadlines} from './domain/deadlines.js';

const OUTBOX_BATCH = 10;
const MAX_ATTEMPTS = 3;

/**
 * Локальний outbox: проєкції читають актуальну БД, тому worker лише підтверджує
 * локальне повідомлення про оновлення. Зовнішньої доставки, push чи інтеграції немає.
 */
export function dispatchLocalOutbox(store: Store): void {
  store.transaction(() => {
    const pending = store.rows(
      `SELECT id FROM outbox
        WHERE state='pending' AND destination_ref='demo-local-projection' AND attempt_count<?
        LIMIT ?`,
      MAX_ATTEMPTS, OUTBOX_BATCH,
    );
    for (const item of pending) {
      store.run("UPDATE outbox SET state='delivered_local',attempt_count=attempt_count+1 WHERE id=?", item.id);
    }
  });
}

/** Один прохід фонової роботи: календарні нагадування та локальний outbox. Ідемпотентний. */
export function runMaintenance(store: Store, now: number): void {
  reviewOverdueDeadlines(store, now);
  dispatchLocalOutbox(store);
}
