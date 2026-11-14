import type {CareDeadlineView, CertificateDeadlineView} from '../../../shared/api';
import type {Tone} from '../../content/labels';
import {describeDistance, formatDay} from '../../lib/dates';

/** Строк, описаний для показу: стан, головна фраза й пояснення. */
export interface DeadlineSummary {
  tone: Tone;
  status: string;
  headline: string;
  details: string[];
  /** Дата, яку варто винести окремо (строк або орієнтир), уже відформатована. */
  date: string | null;
  dateLabel: string | null;
}

const APPLICABILITY_PENDING =
  'Застосовність правила ще уточнюється: воно діє, коли травму спричинили дії противника.';

function dated(day: string): string {
  const distance = describeDistance(day);
  return distance ? `${formatDay(day)} (${distance})` : (formatDay(day) ?? day);
}

function notApplicable(reason: string): DeadlineSummary {
  return {
    tone: 'neutral',
    status: 'Не застосовується',
    headline: 'Правило не застосовується',
    details: [reason],
    date: null,
    dateLabel: null,
  };
}

function confirmedCertificate(view: CertificateDeadlineView): DeadlineSummary {
  const received = `Надходження на лікування — ${formatDay(view.anchorDate) ?? 'у підтверджену дату'}.`;
  if (!view.dueDate) {
    return {
      tone: 'unknown',
      status: 'Строку немає',
      headline: 'Дата надходження підтверджена',
      details: [received, APPLICABILITY_PENDING],
      date: null,
      dateLabel: null,
    };
  }
  const overdue = view.reviewOpen;
  return {
    tone: overdue ? 'attention' : 'confirmed',
    status: overdue ? 'Строк сплив — стан перевіряють' : 'Строк визначено',
    headline: 'Дата надходження підтверджена',
    details: [
      `${received} Строк довідки — до ${dated(view.dueDate)}.`,
      ...(overdue ? ['Строк сплив: супровід отримав нагадування перевірити стан видачі.'] : []),
    ],
    date: formatDay(view.dueDate),
    dateLabel: 'Строк довідки',
  };
}

export function summarizeCertificateDeadline(view: CertificateDeadlineView): DeadlineSummary {
  if (view.applicability === 'not_applicable') {
    return notApplicable('Правило застосовується, коли травму спричинили дії противника. Тут строк не рахуємо.');
  }
  const pending = view.applicability === 'unknown' ? [APPLICABILITY_PENDING] : [];
  if (view.anchorStatus === 'confirmed') return confirmedCertificate(view);
  if (view.anchorStatus === 'estimated') {
    const orientir = view.followUpDate ? dated(view.followUpDate) : 'дата уточнюється';
    return {
      tone: 'pending',
      status: 'Орієнтир, ще не строк',
      headline: 'Дату надходження на лікування підтвердити',
      details: [
        `Орієнтир за датою внесення еПМК: ${orientir}. Дату надходження на лікування треба підтвердити; це ще не строк.`,
        ...pending,
      ],
      date: formatDay(view.followUpDate),
      dateLabel: 'Орієнтир',
    };
  }
  return {
    tone: 'unknown',
    status: 'Строку немає',
    headline: 'Дату надходження ще не встановлено',
    details: ['Без підтвердженої дати надходження на лікування строку немає. Супровід має задачу її уточнити.', ...pending],
    date: null,
    dateLabel: null,
  };
}

export function summarizeCareDeadline(view: CareDeadlineView): DeadlineSummary {
  if (view.applicability === 'not_applicable') {
    return notApplicable('Контроль чотиримісячного строку до цього кейсу не застосовується.');
  }
  if (!view.startDate) {
    return {
      tone: 'unknown',
      status: 'Строку немає',
      headline: 'Початок лікування не підтверджено',
      details: ['Без підтвердженої дати початку лікування контрольної дати немає.'],
      date: null,
      dateLabel: null,
    };
  }
  const started = `Початок лікування підтверджено: ${formatDay(view.startDate)}.`;
  if (!view.dueDate) {
    return {
      tone: 'unknown',
      status: 'Строку немає',
      headline: 'Застосовність правила уточнюється',
      details: [started, 'Поки застосовність не підтверджена, контрольної дати немає.'],
      date: null,
      dateLabel: null,
    };
  }
  return {
    tone: 'confirmed',
    status: 'Контрольну дату визначено',
    headline: 'Початок лікування підтверджено',
    details: [`${started} Контрольна дата — ${dated(view.dueDate)}.`],
    date: formatDay(view.dueDate),
    dateLabel: 'Контрольна дата',
  };
}
