import type {FinanceTrackView, PatientCaseView} from '../../../shared/api';
import {Card} from '../../components/Card';
import {Section} from '../../components/Section';
import {EmptyState} from '../../components/EmptyState';
import {ExternalLink} from '../../components/ExternalLink';
import {Icon} from '../../components/Icon';
import {StatusPill} from '../../components/StatusPill';
import {FINANCE_KIND_LABELS, FINANCE_STATES, financeReasonLabel, SOURCE_LABELS} from '../../content/labels';
import {FINANCE_NOTE, OGD_DECISION_NOTE, OGD_NOTE, OGD_REFERENCE, REWARD_NOTE} from '../../content/legal';
import {formatMonth} from '../../lib/dates';

/** Рішення й виконання — два окремі підтвердження джерела. */
function Confirmation({label, confirmed}: {label: string; confirmed: boolean}) {
  return (
    <li className={confirmed ? 'confirmation is-confirmed' : 'confirmation'}>
      <Icon name={confirmed ? 'check' : 'clock'} size={16} />
      <span>
        {label}: {confirmed ? 'підтверджене джерелом' : 'не підтверджене'}
      </span>
    </li>
  );
}

function FinancePeriod({track}: {track: FinanceTrackView}) {
  const state = FINANCE_STATES[track.status];
  return (
    <li className="finance-period">
      <p className="finance-period__month">{formatMonth(track.periodStart) ?? 'Період невідомий'}</p>
      <StatusPill tone={state.tone}>{state.label}</StatusPill>
      <ul className="finance-period__confirmations">
        <Confirmation label="Рішення" confirmed={track.decisionConfirmed} />
        <Confirmation label="Виконання" confirmed={track.executionConfirmed} />
      </ul>
      <p className="finance-period__meta">
        {financeReasonLabel(track.reason)} · {SOURCE_LABELS[track.source]}
      </p>
      {track.clarificationOpen && (
        <p className="finance-period__flag">
          <Icon name="message" size={16} />
          Супровід уточнює цей період
        </p>
      )}
    </li>
  );
}

function FinanceColumn({kind, tracks}: {kind: FinanceTrackView['kind']; tracks: FinanceTrackView[]}) {
  return (
    <Card as="article" className="finance-route">
      <header className="finance-route__head">
        <span className="finance-route__icon">
          <Icon name="finance" />
        </span>
        <h3>{FINANCE_KIND_LABELS[kind]}</h3>
      </header>
      {tracks.length > 0 ? (
        <ul className="finance-route__periods">
          {tracks.map(track => (
            <FinancePeriod key={track.periodStart} track={track} />
          ))}
        </ul>
      ) : (
        <EmptyState icon="finance" title="Періодів ще немає">
          Джерело ще не передавало даних цим маршрутом.
        </EmptyState>
      )}
      {kind === 'reward' ? (
        <p className="card__note">{REWARD_NOTE}</p>
      ) : (
        <details className="disclosure">
          <summary>Що варто знати про ОГД</summary>
          <p>{OGD_NOTE}</p>
          <p>{OGD_DECISION_NOTE}</p>
          <p>
            <ExternalLink href={OGD_REFERENCE.href}>{OGD_REFERENCE.label}</ExternalLink>
          </p>
        </details>
      )}
    </Card>
  );
}

const KINDS: readonly FinanceTrackView['kind'][] = ['reward', 'ogd'];

/** Два окремі фінансові маршрути; у кожному — окремі періоди. Стани не зливаються. */
export function FinanceSection({view}: {view: PatientCaseView}) {
  return (
    <Section
      id="finance"
      eyebrow="Виплати"
      title="Окремі фінансові маршрути"
      lead="Винагорода під час лікування й одноразова допомога мають різні рішення та різне виконання."
      collapsible
      summary={`Періодів: ${view.finances.length}`}
    >
      <div className="finance-grid">
        {KINDS.map(kind => (
          <FinanceColumn key={kind} kind={kind} tracks={view.finances.filter(track => track.kind === kind)} />
        ))}
      </div>
      <p className="section__note">{FINANCE_NOTE}</p>
    </Section>
  );
}
