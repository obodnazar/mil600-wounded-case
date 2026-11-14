import type {FinanceTrackView, PatientCaseView} from '../../../shared/api';
import {Card} from '../../components/Card';
import {Section} from '../../components/Section';
import {EmptyState} from '../../components/EmptyState';
import {ExternalLink} from '../../components/ExternalLink';
import {Icon} from '../../components/Icon';
import {StatusPill} from '../../components/StatusPill';
import {FINANCE_KIND_LABELS, FINANCE_STATES, financeReasonLabel, financeState, SOURCE_LABELS} from '../../content/labels';
import {
  FINANCE_NOTE,
  OGD_DECISION_NOTE,
  OGD_NOTE,
  OGD_OUT_OF_SCOPE_NOTE,
  OGD_REFERENCE,
  PAYMENTS_VLK_RULE,
  REWARD_NOTE,
  SEVERITY_PAYMENTS_NOTE,
} from '../../content/legal';
import {formatMonth} from '../../lib/dates';
import {OgdAwaitsVlk} from '../shared/OgdAwaitsVlk';

/** Рішення й виконання — два окремі підтвердження джерела. */
function Confirmation({label, confirmed}: {label: string; confirmed: boolean}) {
  return (
    <li className={confirmed ? 'confirmation is-confirmed' : 'confirmation'}>
      <Icon name={confirmed ? 'check' : 'clock'} size={16} />
      <span>
        {label}: {confirmed ? 'підтверджено джерелом' : 'не підтверджено'}
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

/** Кроки ОГД за Порядком №975 (ADR 0013); крок пройдено, лише коли його підтвердило джерело. */
const OGD_STEPS: readonly {label: string; reached: readonly FinanceTrackView['status'][]}[] = [
  {label: 'Документи подано до уповноваженого органу', reached: ['under_review', 'returned', 'conclusion_prepared', 'approved', 'denied', 'execution_confirmed']},
  {label: 'Висновок уповноваженого органу за місцем служби', reached: ['conclusion_prepared', 'approved', 'denied', 'execution_confirmed']},
  {label: 'Рішення розпорядника бюджетних коштів', reached: ['approved', 'denied', 'execution_confirmed']},
  {label: 'Виплату здійснено', reached: ['execution_confirmed']},
];

function OgdPayment({track}: {track: FinanceTrackView}) {
  const state = financeState('ogd', track.status);
  return (
    <div className="finance-period finance-period--single">
      <p className="finance-period__month">Одноразова виплата</p>
      <StatusPill tone={state.tone}>{state.label}</StatusPill>
      <ol className="finance-period__confirmations ogd-steps">
        {OGD_STEPS.map(step => (
          <Confirmation key={step.label} label={step.label} confirmed={step.reached.includes(track.status)} />
        ))}
      </ol>
      <p className="finance-period__meta">
        {financeReasonLabel(track.reason)} · {SOURCE_LABELS[track.source]}
      </p>
      {track.clarificationOpen && (
        <p className="finance-period__flag">
          <Icon name="message" size={16} />
          Супровід уточнює стан ОГД
        </p>
      )}
    </div>
  );
}

interface FinanceColumnProps {
  kind: FinanceTrackView['kind'];
  tracks: FinanceTrackView[];
  vlkDecision: PatientCaseView['milestones']['vlkDecision'];
}

function FinanceColumn({kind, tracks, vlkDecision}: FinanceColumnProps) {
  return (
    <Card as="article" className="finance-route">
      <header className="finance-route__head">
        <span className="finance-route__icon">
          <Icon name="finance" />
        </span>
        <h3>{FINANCE_KIND_LABELS[kind]}</h3>
      </header>
      {kind === 'ogd' && <OgdAwaitsVlk vlkDecision={vlkDecision} />}
      {kind === 'ogd' && tracks[0] ? (
        <OgdPayment track={tracks[0]} />
      ) : kind === 'ogd' ? (
        <EmptyState icon="finance" title="Даних про ОГД ще немає">
          Джерело ще не передавало даних про ОГД.
        </EmptyState>
      ) : tracks.length > 0 ? (
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
          <p>{OGD_OUT_OF_SCOPE_NOTE}</p>
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

/** Два окремі фінансові маршрути: винагорода — за періодами, ОГД — одна виплата після постанови ВЛК. */
export function FinanceSection({view}: {view: PatientCaseView}) {
  return (
    <Section
      id="finance"
      eyebrow="Виплати"
      title="Окремі фінансові маршрути"
      lead={PAYMENTS_VLK_RULE}
      collapsible
      summary={`Маршрутів із даними: ${new Set(view.finances.map(track => track.kind)).size}`}
    >
      <div className="finance-grid">
        {KINDS.map(kind => (
          <FinanceColumn
            key={kind}
            kind={kind}
            tracks={view.finances.filter(track => track.kind === kind)}
            vlkDecision={view.milestones.vlkDecision}
          />
        ))}
      </div>
      <p className="section__note">
        {SEVERITY_PAYMENTS_NOTE} {FINANCE_NOTE}
      </p>
    </Section>
  );
}
