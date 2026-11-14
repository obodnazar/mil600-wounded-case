/** Усі дати показуємо за київським часом українською; сирі ISO-рядки в інтерфейс не потрапляють. */
const ZONE = 'Europe/Kyiv';
const LOCALE = 'uk-UA';

const dayFormat = new Intl.DateTimeFormat(LOCALE, {day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONE});
const shortDayFormat = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: ZONE,
});
const timeFormat = new Intl.DateTimeFormat(LOCALE, {hour: '2-digit', minute: '2-digit', timeZone: ZONE});
const monthFormat = new Intl.DateTimeFormat(LOCALE, {month: 'long', year: 'numeric', timeZone: ZONE});
const keyFormat = new Intl.DateTimeFormat('en-CA', {year: 'numeric', month: '2-digit', day: '2-digit', timeZone: ZONE});
const plural = new Intl.PluralRules(LOCALE);

const DAY_MS = 86_400_000;

/** Календарна дата YYYY-MM-DD (або YYYY-MM) без зсуву між часовими поясами. */
function calendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3] ?? '01'}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function instant(value: string): Date | null {
  const date = calendarDate(value) ?? new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const withoutYearMark = (text: string): string => text.replace(/\s*р\.$/, '');

/** «15 листопада 2026» для календарної дати чи моменту часу; null, якщо значення не розпізнано. */
export function formatDay(value: string | null): string | null {
  const date = value ? instant(value) : null;
  return date ? withoutYearMark(dayFormat.format(date)) : null;
}

/** «15.11.2026». */
export function formatShortDay(value: string | null): string | null {
  const date = value ? instant(value) : null;
  return date ? shortDayFormat.format(date) : null;
}

/** «12:05» за київським часом. */
export function formatTime(value: string | number | null): string | null {
  if (value === null) return null;
  const date = typeof value === 'number' ? new Date(value) : instant(value);
  return date && !Number.isNaN(date.getTime()) ? timeFormat.format(date) : null;
}

/** «15.11.2026, 12:05». */
export function formatDateTime(value: string | null): string | null {
  const day = formatShortDay(value);
  const time = formatTime(value);
  return day && time ? `${day}, ${time}` : null;
}

/** «листопад 2026» для YYYY-MM або YYYY-MM-DD. */
export function formatMonth(value: string | null): string | null {
  const date = value ? calendarDate(value) : null;
  return date ? withoutYearMark(monthFormat.format(date)) : null;
}

/** Ключ календарного дня в Києві (YYYY-MM-DD) — для групування подій. */
export function dayKey(value: string): string {
  const date = instant(value);
  return date ? keyFormat.format(date) : 'unknown';
}

/** Скільки календарних днів від сьогодні (у Києві) до дати; від’ємне — дата минула. */
export function daysUntil(day: string, now: number = Date.now()): number | null {
  const target = calendarDate(day);
  const today = calendarDate(keyFormat.format(new Date(now)));
  if (!target || !today) return null;
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}

type Forms = readonly [one: string, few: string, many: string];

/** Українська множина: 1 день, 2 дні, 5 днів. */
export function pluralize(count: number, forms: Forms): string {
  const rule = plural.select(Math.abs(count));
  const word = rule === 'one' ? forms[0] : rule === 'few' ? forms[1] : forms[2];
  return `${Math.abs(count)} ${word}`;
}

const DAY_FORMS: Forms = ['день', 'дні', 'днів'];

/** «залишилось 2 дні», «сьогодні», «минуло 3 дні». */
export function describeDistance(day: string, now?: number): string | null {
  const days = daysUntil(day, now);
  if (days === null) return null;
  if (days === 0) return 'сьогодні';
  return days > 0 ? `через ${pluralize(days, DAY_FORMS)}` : `минуло ${pluralize(days, DAY_FORMS)}`;
}
