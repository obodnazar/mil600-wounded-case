import type {AnchorStatus, Applicability, FinanceStatus} from '../../shared/api.js';
import {calendarDays, calendarMonths, kyivDate} from './calendar.js';

/**
 * Чисті правила: вхід — підтверджені факти, вихід — рішення.
 * Жодного SQL, HTTP чи часу «зараз»; усе перевіряється юніт-тестами.
 */

export const CERTIFICATE_DAYS = 5;
export const CARE_MONTHS = 4;

/* ───────────── Строк довідки про обставини травми ───────────── */

export interface CertificateFacts {
  /** Чи підтвердило джерело, що травма пов’язана з діями противника. */
  enemyAction: 'yes' | 'no' | 'unknown';
  /** Підтверджений момент отримання документа військовослужбовцем (ISO) або null. */
  patientReceivedAt: string | null;
  /** Момент внесення еПМК джерелом (ISO) або null. Лише орієнтир. */
  sourceRecordedAt: string | null;
}

export interface CertificateClock {
  applicability: Applicability;
  anchorStatus: AnchorStatus;
  anchorDate: string | null;
  dueDate: string | null;
  followUpDate: string | null;
  /** Потрібна задача людині: підтвердити дату отримання. */
  needsReceiptConfirmation: boolean;
}

/**
 * Відлік починається тільки від підтвердженого отримання документа військовослужбовцем
 * і тільки коли правило застосовне. Дата внесення еПМК дає орієнтир, але не строк.
 * Невідома дата чи застосовність не породжує вигаданого строку.
 */
export function certificateClock(facts: CertificateFacts): CertificateClock {
  const applicability: Applicability =
    facts.enemyAction === 'yes' ? 'applicable' : facts.enemyAction === 'no' ? 'not_applicable' : 'unknown';
  const received = facts.patientReceivedAt ? kyivDate(facts.patientReceivedAt) : null;
  const recorded = facts.sourceRecordedAt ? kyivDate(facts.sourceRecordedAt) : null;
  const applies = applicability === 'applicable';

  if (applies && received) {
    return {
      applicability,
      anchorStatus: 'confirmed',
      anchorDate: received,
      dueDate: calendarDays(received, CERTIFICATE_DAYS),
      followUpDate: null,
      needsReceiptConfirmation: false,
    };
  }
  return {
    applicability,
    anchorStatus: applies && recorded ? 'estimated' : 'unknown',
    anchorDate: null,
    dueDate: null,
    followUpDate: applies && recorded ? calendarDays(recorded, CERTIFICATE_DAYS) : null,
    needsReceiptConfirmation: applicability !== 'not_applicable',
  };
}

export type EnemyAction = 'yes' | 'no' | 'unknown';

export const asEnemyAction = (value: unknown): EnemyAction =>
  value === 'yes' ? 'yes' : value === 'no' ? 'no' : 'unknown';

/**
 * Підтверджена застосовність правила не знижується до «невідомо» пізнішою подією
 * (новою версією еПМК чи іншим документом без цього поля). Пряма суперечність
 * «так ↔ ні» не вирішується автоматично: `conflict` означає розбір людиною.
 */
export function mergeEnemyAction(current: EnemyAction, incoming: EnemyAction): {value: EnemyAction; conflict: boolean} {
  if (incoming === 'unknown' || incoming === current) return {value: current, conflict: false};
  if (current === 'unknown') return {value: incoming, conflict: false};
  return {value: current, conflict: true};
}

/** Те саме правило для застосовності контролю лікування (`care_applicable` у події). */
export function mergeCareApplicability(current: unknown, incoming: unknown): {value: Applicability; conflict: boolean} {
  const known = (value: unknown): EnemyAction =>
    value === 'applicable' || value === true ? 'yes' : value === 'not_applicable' || value === false ? 'no' : 'unknown';
  const merged = mergeEnemyAction(known(current), known(incoming));
  const value: Applicability = merged.value === 'yes' ? 'applicable' : merged.value === 'no' ? 'not_applicable' : 'unknown';
  return {value, conflict: merged.conflict};
}

/* ───────────── Контроль строку лікування ───────────── */

export interface CareControl {
  applicability: Applicability;
  startDate: string | null;
  dueDate: string | null;
  needsClarification: boolean;
}

/** Чотири календарні місяці від підтвердженого початку безперервного лікування. */
export function careControl(startDate: string | null, careApplicable: unknown): CareControl {
  const applicability: Applicability =
    careApplicable === true ? 'applicable' : careApplicable === false ? 'not_applicable' : 'unknown';
  const dueDate = startDate && applicability === 'applicable' ? calendarMonths(startDate, CARE_MONTHS) : null;
  return {
    applicability,
    startDate,
    dueDate,
    needsClarification: !startDate || applicability === 'unknown',
  };
}

/* ───────────── Фінансовий маршрут одного виду й періоду ───────────── */

export interface FinanceState {
  status: string;
  /** Посилання на останнє джерельне рішення або null, якщо рішення ще не було. */
  decisionRef: string | null;
}

export interface FinanceSignal {
  status: FinanceStatus | string;
  /** На яке попереднє рішення посилається джерело. */
  previousDecisionRef: string | null;
}

const EXECUTION = new Set(['execution_partial', 'execution_confirmed']);

/**
 * Перевіряє, чи новий сигнал джерела можна застосувати до підтвердженого стану.
 * Повертає код причини розбору або null. Сигнал `unknown` ніколи не є переходом:
 * він не стирає підтверджене, а лише відкриває уточнення.
 */
export function financeTransitionProblem(prior: FinanceState | null, signal: FinanceSignal): string | null {
  if (signal.status === 'unknown') return null;
  if (prior?.decisionRef && signal.previousDecisionRef !== prior.decisionRef) {
    return 'financial_revision_order_unknown';
  }
  if (prior?.status === 'execution_partial' && signal.status !== 'execution_confirmed') {
    return 'execution_regression';
  }
  const canExecute = prior?.status === 'approved' || prior?.status === 'execution_partial';
  if (EXECUTION.has(signal.status) && !canExecute) return 'execution_without_approval';
  if (prior?.status === 'execution_confirmed') return 'completed_period_revision_review';
  return null;
}

/* ───────────── Ревізії пакета ───────────── */

export interface PacketState {
  revision: string;
  period: string | null;
}

export interface PacketSignal {
  returned: boolean;
  revision: string;
  period: string | null;
  supersedesRevision: string | null;
  recipientRef: string;
  expectedRecipient: string;
}

/** Повернення без отримання, чужий період, недоведений порядок ревізій, не той адресат. */
export function packetProblem(prior: PacketState | null, signal: PacketSignal): string | null {
  if (signal.returned && !prior) return 'return_without_receipt';
  if (prior?.period && signal.period !== prior.period) return 'packet_period_mismatch';
  if (prior && prior.revision !== signal.revision && signal.supersedesRevision !== prior.revision) {
    return 'packet_revision_order_unknown';
  }
  if (signal.recipientRef !== signal.expectedRecipient) return 'packet_recipient_mismatch';
  return null;
}
