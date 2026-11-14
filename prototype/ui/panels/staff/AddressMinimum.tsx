import type {StaffAddressMinimum} from '../../../shared/api';
import {StatusPill} from '../../components/StatusPill';
import {financeRowLabel, financeState, MILESTONES, TONE_WORDS, UNKNOWN, type Tone} from '../../content/labels';
import {formatMonth} from '../../lib/dates';
import {OgdAwaitsVlk} from '../shared/OgdAwaitsVlk';

interface Row {
  id: string;
  label: string;
  value: string;
  tone: Tone;
}

const KIND_ORDER: Record<StaffAddressMinimum['finances'][number]['kind'], number> = {reward: 0, ogd: 1};

/** Сталий порядок, як у бійця: спершу винагорода, потім ОГД; усередині — за періодом. */
function sortedFinances(address: StaffAddressMinimum): StaffAddressMinimum['finances'] {
  return [...address.finances].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.periodStart.localeCompare(b.periodStart),
  );
}

function buildRows(address: StaffAddressMinimum): Row[] {
  const certificate = MILESTONES.certificate.values[address.certificate];
  const decision = MILESTONES.vlkDecision.values[address.vlkDecision];
  const rows: Row[] = [
    {id: 'certificate', label: MILESTONES.certificate.label, ...certificate},
    address.facility
      ? {id: 'facility', label: 'Заклад лікування', value: address.facility, tone: 'confirmed'}
      : {id: 'facility', label: 'Заклад лікування', value: UNKNOWN, tone: 'unknown'},
    {id: 'vlk', label: MILESTONES.vlkDecision.label, ...decision},
  ];
  if (address.finances.length === 0) {
    rows.push({id: 'finance', label: 'Виплати', value: UNKNOWN, tone: 'unknown'});
  }
  for (const track of sortedFinances(address)) {
    const state = financeState(track.kind, track.status);
    rows.push({
      id: `finance-${track.kind}-${track.periodStart}`,
      label: financeRowLabel(track.kind, formatMonth(track.periodStart)),
      value: state.short,
      tone: state.tone,
    });
  }
  return rows;
}

/**
 * Що бачить частина: адресний мінімум без клінічних документів, документних посилань і сум
 * (рішення команди 2026-11-14).
 */
export function AddressMinimum({address}: {address: StaffAddressMinimum}) {
  return (
    <section className="case-block" aria-labelledby="case-address-title">
      <h3 id="case-address-title">Що бачить частина</h3>
      <p className="muted">
        Стан довідки, заклад лікування, постанова ВЛК і стан виплат — без медичних документів і сум.
      </p>
      <dl className="facts facts--address">
        {buildRows(address).map(row => (
          <div key={row.id} className="facts__row">
            <dt>{row.label}</dt>
            <dd>
              <span className="facts__value">{row.value}</span>
              <StatusPill tone={row.tone}>{TONE_WORDS[row.tone]}</StatusPill>
            </dd>
          </div>
        ))}
      </dl>
      <OgdAwaitsVlk vlkDecision={address.vlkDecision} />
    </section>
  );
}
