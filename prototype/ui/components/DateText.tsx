import {formatDateTime, formatDay} from '../lib/dates';
import {UNKNOWN} from '../content/labels';

interface DateTextProps {
  /** Календарна дата YYYY-MM-DD або момент часу ISO. */
  value: string | null;
  /** Показати також час (для моментів часу). */
  withTime?: boolean;
  /** Текст, якщо дати немає. */
  fallback?: string;
}

/** Дата за київським часом у людському форматі; відсутню дату показуємо словом. */
export function DateText({value, withTime = false, fallback = UNKNOWN}: DateTextProps) {
  const text = withTime ? formatDateTime(value) : formatDay(value);
  if (!value || !text) return <span className="date date--unknown">{fallback}</span>;
  return (
    <time className="date" dateTime={value}>
      {text}
    </time>
  );
}
