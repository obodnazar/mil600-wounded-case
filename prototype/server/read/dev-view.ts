import type {DevView, GuideView, InboxState} from '../../shared/api.js';
import type {Store} from '../db/store.js';
import {fixtures} from '../simulator/fixtures.js';
import {selectedSnapshot} from './analytics.js';
import {sourceCode} from './case-view.js';

const RECENT_LIMIT = 12;

/**
 * Технічний огляд для dev-панелі: перелік фіксованих подій, лічильники шлюзу
 * та останні прийняті події. Тіл подій, ідентифікаторів осіб і ключів тут немає.
 */
export function devView(store: Store): DevView {
  const recent = store.rows(
    'SELECT event_type,source_system,processing_state,received_at FROM inbox_event ORDER BY rowid DESC LIMIT ?',
    RECENT_LIMIT,
  );
  return {
    fixtures: fixtures.map(item => ({
      id: item.id,
      title: item.title,
      group: item.group,
      source: sourceCode(item.event.source_system),
    })),
    stats: {
      inboxTotal: store.count('SELECT COUNT(*) AS n FROM inbox_event'),
      pendingReview: store.count("SELECT COUNT(*) AS n FROM inbox_event WHERE processing_state!='applied'"),
      openReviews: store.count("SELECT COUNT(*) AS n FROM review_item WHERE state='open'"),
      outboxPending: store.count("SELECT COUNT(*) AS n FROM outbox WHERE state='pending'"),
      outboxDelivered: store.count("SELECT COUNT(*) AS n FROM outbox WHERE state='delivered_local'"),
    },
    recent: recent.map(item => ({
      eventType: String(item.event_type),
      source: sourceCode(String(item.source_system)),
      state: (item.processing_state === 'applied' ? 'applied' : 'pending_review') satisfies InboxState,
      receivedAt: String(item.received_at),
    })),
    analyticsSnapshot: selectedSnapshot(store),
  };
}

/** Загальний гайд, доступний без входу бійця й без жодної ролі. */
export const GUIDE: GuideView = {
  title: 'Допомога без входу бійця',
  steps: [
    'Зверніться до призначеної служби супроводу через чинний службовий канал.',
    'Не передавайте пароль чи медичні документи неперевіреним людям.',
    'Споріднення саме по собі не відкриває доступ до кейсу.',
    'Відсутній сигнал у цьому сервісі не є рішенням про службовий статус чи виплати: ' +
      'такі рішення ухвалюють лише уповноважені органи.',
  ],
};
