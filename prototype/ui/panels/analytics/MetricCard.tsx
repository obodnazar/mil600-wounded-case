import type {MetricView} from '../../../shared/api';
import {Card} from '../../components/Card';
import {ExternalLink} from '../../components/ExternalLink';
import {StatusPill, Tag} from '../../components/StatusPill';
import {METRIC_STATES} from '../../content/analytics';

/** Картка показника: стан, значення, визначення та покриття зі знаменниками. */
export function MetricCard({metric}: {metric: MetricView}) {
  const state = METRIC_STATES[metric.state];
  const titleId = `metric-${metric.id}`;
  return (
    <Card as="article" className={`metric metric--${metric.state}`} labelledBy={titleId}>
      <header className="metric__head">
        <Tag>{metric.id}</Tag>
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
      </header>
      <h2 id={titleId} className="metric__title">
        {metric.title}
      </h2>
      <p className="metric-value">{metric.value}</p>
      <dl className="metric__facts">
        <div>
          <dt>Як рахується</dt>
          <dd>{metric.detail}</dd>
        </div>
        <div>
          <dt>Покриття й знаменники</dt>
          <dd>{metric.coverage ?? 'Джерело не передало покриття.'}</dd>
        </div>
      </dl>
      <p className="metric__state">{state.explain}</p>
      {metric.source && <ExternalLink href={metric.source}>Першоджерело контексту</ExternalLink>}
    </Card>
  );
}
