import type {CaseMilestones, PatientCaseView} from '../../../shared/api';
import {financeRowLabel, financeState, MILESTONES, UNKNOWN, type Tone} from '../../content/labels';
import {formatDay, formatMonth} from '../../lib/dates';

/** Один рядок блоку «Що підтверджено, а що невідомо». */
export interface Fact {
  id: string;
  label: string;
  value: string;
  tone: Tone;
}

const fact = (id: string, label: string, value: string, tone: Tone): Fact => ({id, label, value, tone});

function receiptFact(view: PatientCaseView): Fact {
  const {anchorStatus, anchorDate} = view.certificateDeadline;
  const label = 'Надходження на лікування';
  if (anchorStatus === 'confirmed') {
    return fact('receipt', label, `${formatDay(anchorDate) ?? 'дата є'} — підтверджено`, 'confirmed');
  }
  if (anchorStatus === 'estimated') return fact('receipt', label, 'є лише орієнтир; дату треба підтвердити', 'pending');
  return fact('receipt', label, UNKNOWN, 'unknown');
}

/** Віха кейсу з контракту: сервер віддає код стану, підпис і тон — у content/labels. */
function milestoneFact<K extends keyof CaseMilestones>(milestones: CaseMilestones, key: K): Fact {
  const copy = MILESTONES[key];
  const state = copy.values[milestones[key]];
  return fact(key, copy.label, state.value, state.tone);
}

function financeFacts(view: PatientCaseView): Fact[] {
  if (view.finances.length === 0) return [fact('finance', 'Виплати', UNKNOWN, 'unknown')];
  return view.finances.map(track => {
    const state = financeState(track.kind, track.status);
    const label = financeRowLabel(track.kind, formatMonth(track.periodStart));
    return fact(`finance-${track.kind}-${track.periodStart}`, label, state.short, state.tone);
  });
}

/** Стислий перелік фактів: невідоме показуємо словом «невідомо», а не ховаємо. */
export function buildFacts(view: PatientCaseView): Fact[] {
  const careStart = view.care.deadline.startDate;
  const {milestones} = view;
  return [
    view.sourceLinked
      ? fact('source', 'Медичний документ', 'підтверджено джерелом', 'confirmed')
      : fact('source', 'Медичний документ', 'ще не підтверджений', 'pending'),
    receiptFact(view),
    careStart
      ? fact('care-start', 'Початок лікування', `${formatDay(careStart) ?? 'дата є'} — підтверджено`, 'confirmed')
      : fact('care-start', 'Початок лікування', UNKNOWN, 'unknown'),
    view.care.facility
      ? fact('facility', 'Заклад лікування', view.care.facility, 'confirmed')
      : fact('facility', 'Заклад лікування', UNKNOWN, 'unknown'),
    milestoneFact(milestones, 'certificate'),
    milestoneFact(milestones, 'referral'),
    milestoneFact(milestones, 'vlkPacket'),
    milestoneFact(milestones, 'vlkDecision'),
    milestoneFact(milestones, 'serviceAction'),
    ...financeFacts(view),
  ];
}
