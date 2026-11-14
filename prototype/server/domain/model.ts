import {randomUUID} from 'node:crypto';
import type {EventEnvelope} from '../../security/core.js';
import type {Row, Store} from '../db/store.js';

/** Подію збережено, але застосувати її без людини чи належного джерела не можна. */
export class ReviewRequired extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export const newId = (): string => `demo-${randomUUID()}`;
export const isoTime = (now: number): string => new Date(now).toISOString();

/** Шість mock-джерел; назви — власний навчальний контракт, не реальні системи. */
export const SOURCE_SYSTEMS = [
  'demo-mis',
  'demo-sedo',
  'demo-vlk',
  'demo-finance',
  'demo-service',
  'demo-civil-mis',
] as const;

export const RULE = {
  certificate: 'demo-rule-certificate',
  care: 'demo-rule-care',
  vlkChecklist: 'demo-rule-checklist',
} as const;

/** Адресати документів і пакетів у навчальному контракті. */
export const RECIPIENT = {vlk: 'demo-vlk', finance: 'demo-finance', part: 'demo-part'} as const;

export type Route = 'vlk' | 'reward' | 'ogd';
export type Payload = Record<string, unknown>;

/** Рядкове поле payload; відсутнє чи нерядкове значення дає порожній рядок. */
export function text(payload: Payload, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

/** Те саме, але порожнє значення стає null — для необов’язкових дат і посилань. */
export function optionalText(payload: Payload, key: string): string | null {
  return text(payload, key) || null;
}

/** Контекст застосування однієї джерельної події до одного кейсу. */
export interface EventContext {
  store: Store;
  event: EventEnvelope;
  payload: Payload;
  /** Рядок wound_case на момент початку обробки події. */
  caseRow: Row;
  caseId: string;
  /** Запис цієї події в журналі кейсу. */
  caseEventId: string;
  /** Запис inbox, під яким подію прийнято (той самий і для повторної доставки). */
  inboxId: string;
  now: number;
}

export type EventHandler = (context: EventContext) => void;
