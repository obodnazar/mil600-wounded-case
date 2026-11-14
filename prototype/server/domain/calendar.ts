import {Denied} from '../../security/core.js';

/**
 * Календарні обчислення без годин і часових поясів.
 *
 * Дата — рядок YYYY-MM-DD. Місяці додаються як календарні місяці, а не як
 * стала кількість діб: 31 жовтня + 4 місяці = останній день лютого.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const utc = (date: string): Date => new Date(`${date}T00:00:00Z`);
const toDate = (value: Date): string => value.toISOString().slice(0, 10);

export function validDate(value: string): string {
  const parsed = DATE_PATTERN.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  if (!Number.isFinite(parsed) || toDate(new Date(parsed)) !== value) throw new Denied(400, 'invalid_date');
  return value;
}

export function calendarDays(value: string, days: number): string {
  const date = utc(validDate(value));
  date.setUTCDate(date.getUTCDate() + days);
  return toDate(date);
}

export function calendarMonths(value: string, months: number): string {
  const date = utc(validDate(value));
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return toDate(date);
}

const kyivFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Календарна дата моменту часу за київським часом (з урахуванням переходу на літній час). */
export function kyivDate(iso: string): string {
  return kyivFormat.format(new Date(iso));
}

/** Останній день календарного місяця, що починається з `monthStart`. */
export function monthEnd(monthStart: string): string {
  return calendarDays(calendarMonths(monthStart, 1), -1);
}
