import {Card} from '../../components/Card';
import {ExternalLink} from '../../components/ExternalLink';
import {Icon} from '../../components/Icon';
import {StatusPill} from '../../components/StatusPill';
import type {DeadlineRule} from '../../content/legal';
import type {DeadlineSummary} from './deadlines';

interface DeadlineCardProps {
  rule: DeadlineRule;
  summary: DeadlineSummary;
}

/** Строк із поясненням, від чого він рахується і чого не означає. */
export function DeadlineCard({rule, summary}: DeadlineCardProps) {
  return (
    <Card as="article" className="deadline">
      <header className="deadline__head">
        <p className="eyebrow eyebrow--icon">
          <Icon name="calendar" size={16} />
          {rule.title}
        </p>
        <StatusPill tone={summary.tone}>{summary.status}</StatusPill>
      </header>
      <h3 className="deadline__headline">{summary.headline}</h3>
      {summary.date && summary.dateLabel && (
        <p className="deadline__date">
          <span>{summary.dateLabel}</span>
          <strong>{summary.date}</strong>
        </p>
      )}
      {summary.details.map(line => (
        <p key={line} className="deadline__detail">
          {line}
        </p>
      ))}
      <dl className="deadline__rule">
        <div>
          <dt>Що каже норма</dt>
          <dd>{rule.basis}</dd>
        </div>
        <div>
          <dt>Навчальне припущення</dt>
          <dd>{rule.assumption}</dd>
        </div>
        <div>
          <dt>Підстава</dt>
          <dd>
            <ExternalLink href={rule.reference.href}>{rule.reference.label}</ExternalLink>
          </dd>
        </div>
      </dl>
    </Card>
  );
}
