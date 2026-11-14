import type {DevView, FixtureGroup, InboxState} from '../../shared/api';
import type {ToneLabel} from './labels';

export const FIXTURE_GROUPS: readonly FixtureGroup[] = ['d1', 's1', 's2', 's3', 's4', 's5', 's6'];

export const FIXTURE_GROUP_LABELS: Record<FixtureGroup, {short: string; title: string}> = {
  d1: {short: 'D1', title: 'Основний шлях: від еПМК до виплат'},
  s1: {short: 'S1', title: 'Випадок потребує звірки, пізня еПМК'},
  s2: {short: 'S2', title: 'Цивільний заклад і виписка'},
  s3: {short: 'S3', title: 'Версії документа: виправлення й відкликання'},
  s4: {short: 'S4', title: 'ВЛК повертає пакет на уточнення'},
  s5: {short: 'S5', title: 'Інший період виплати'},
  s6: {short: 'S6', title: 'Пропущені підтвердження й резервний шлях'},
};

export const INBOX_STATES: Record<InboxState, ToneLabel> = {
  applied: {label: 'Застосовано', tone: 'confirmed'},
  pending_review: {label: 'На розборі', tone: 'attention'},
};

export const STAT_LABELS: Record<keyof DevView['stats'], string> = {
  inboxTotal: 'Подій у inbox',
  pendingReview: 'Подій на розборі',
  openReviews: 'Відкритих розборів',
  outboxPending: 'Outbox: у черзі',
  outboxDelivered: 'Outbox: доставлено',
};

export const STAT_ORDER: readonly (keyof DevView['stats'])[] = [
  'inboxTotal',
  'pendingReview',
  'openReviews',
  'outboxPending',
  'outboxDelivered',
];

/** Крок шпаргалки D1: або серія подій симулятора, або дія в іншій панелі. */
export type DemoPathStep =
  | {kind: 'events'; title: string; fixtures: readonly string[]}
  | {kind: 'panel'; title: string; text: string};

export const D1_PATH: readonly DemoPathStep[] = [
  {
    kind: 'events',
    title: 'Медичний документ і лікування',
    fixtures: ['primary', 'admit', 'care-start', 'transfer', 'patient-receipt', 'certificate-prepared'],
  },
  {
    kind: 'panel',
    title: 'Дія командира',
    text: 'Панель «Супровід» → роль «Командир» → «Запит видачі довідки».',
  },
  {
    kind: 'events',
    title: 'Довідка й винагорода',
    fixtures: [
      'certificate-issued',
      'certificate-sent',
      'certificate-received',
      'reward-packet',
      'reward-approved',
      'reward-execution_partial',
      'reward-execution_confirmed',
    ],
  },
  {
    kind: 'panel',
    title: 'Дія командира',
    text: 'Панель «Супровід» → роль «Командир» → «Направити на ВЛК».',
  },
  {
    kind: 'events',
    title: 'ВЛК, дія за постановою та ОГД',
    fixtures: [
      'referral',
      'vlk-received',
      'vlk-decision',
      'service-executed',
      'ogd-packet',
      'ogd-returned',
      'ogd-packet-v2',
      'ogd-conclusion',
      'ogd-approved',
      'ogd-execution_confirmed',
    ],
  },
  {
    kind: 'panel',
    title: 'Перевірка й винятки',
    text: 'Панель «Мій кейс» покаже результат. Далі — групи S1–S6; конфлікт запускайте наприкінці.',
  },
];

export const GATEWAY_STEPS: readonly string[] = [
  'Фіксована вигадана подія з переліку — довільного JSON немає.',
  'Той самий шлюз, що й для зовнішнього джерела: підпис HMAC і схема перевіряються на сервері.',
  'Inbox, зміна кейсу, задача й запис аудиту зберігаються однією транзакцією.',
  'Повідомлення йде в outbox; повтор тієї самої події нічого не дублює.',
];
