import type {TimelineCategory, TimelineEntryView} from '../../../shared/api';
import {TIMELINE_CATEGORIES} from '../../content/labels';
import {dayKey, formatDay, formatShortDay} from '../../lib/dates';

export type TimelineFilter = TimelineCategory | 'all';

/** Скільки подій показуємо одразу й скільки додає «Показати ще». */
export const INITIAL_LIMIT = 8;
export const LIMIT_STEP = 10;

export interface TimelineGroup {
  key: string;
  /** «13 листопада 2026». */
  label: string;
  entries: TimelineEntryView[];
}

/**
 * Журнал упорядковано за часом запису в кейс (так його віддає сервер): нове підтвердження
 * завжди зверху, навіть якщо сама подія давня. Час події за джерелом показуємо окремо.
 */
export function displayTime(entry: TimelineEntryView): string {
  return entry.recordedAt;
}

/** Дата події за джерелом, якщо вона відрізняється від дня запису в кейс; інакше null. */
export function earlierEventDay(entry: TimelineEntryView): string | null {
  if (!entry.occurredAt || dayKey(entry.occurredAt) === dayKey(entry.recordedAt)) return null;
  return formatShortDay(entry.occurredAt);
}

export function countByCategory(entries: readonly TimelineEntryView[]): Record<TimelineFilter, number> {
  const counts: Record<TimelineFilter, number> = {
    all: entries.length,
    medical: 0,
    documents: 0,
    vlk: 0,
    finance: 0,
    requests: 0,
    sync: 0,
  };
  for (const entry of entries) counts[entry.category] += 1;
  return counts;
}

/** Категорії, у яких є події, у сталому порядку. */
export function presentCategories(counts: Record<TimelineFilter, number>): TimelineCategory[] {
  return TIMELINE_CATEGORIES.filter(category => counts[category] > 0);
}

export function filterEntries(entries: readonly TimelineEntryView[], filter: TimelineFilter): TimelineEntryView[] {
  return filter === 'all' ? [...entries] : entries.filter(entry => entry.category === filter);
}

/** Групує сусідні записи одного календарного дня, зберігаючи порядок сервера (від найновішого). */
export function groupByDay(entries: readonly TimelineEntryView[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  for (const entry of entries) {
    const key = dayKey(displayTime(entry));
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({key, label: formatDay(displayTime(entry)) ?? 'Дата невідома', entries: [entry]});
  }
  return groups;
}
