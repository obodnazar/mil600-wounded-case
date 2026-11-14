import type {AnalyticsSnapshotId, DevView} from '../../../shared/api';
import {Card} from '../../components/Card';
import {DateText} from '../../components/DateText';
import {EmptyState} from '../../components/EmptyState';
import {Segmented} from '../../components/Segmented';
import {StatusPill} from '../../components/StatusPill';
import {SNAPSHOT_LABELS} from '../../content/analytics';
import {GATEWAY_STEPS, INBOX_STATES, STAT_LABELS, STAT_ORDER} from '../../content/dev';
import {SOURCE_LABELS} from '../../content/labels';

/** Як подія проходить шлюз: коротко й технічно. */
export function GatewayCard() {
  return (
    <Card surface="olive" as="section" labelledBy="gateway-title">
      <p className="eyebrow">Єдиний шлюз</p>
      <h2 id="gateway-title">Від джерела до стану кейсу</h2>
      <ol className="pipeline">
        {GATEWAY_STEPS.map(step => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="card__note">Ключі підпису лишаються на сервері й до браузера не потрапляють.</p>
    </Card>
  );
}

/** Лічильники обробки подій. */
export function StatsGrid({stats}: {stats: DevView['stats']}) {
  return (
    <dl className="stat-grid">
      {STAT_ORDER.map(key => (
        <div key={key} className="stat">
          <dt>{STAT_LABELS[key]}</dt>
          <dd>{stats[key]}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Журнал останніх прийнятих подій: тип, джерело й стан обробки. */
export function RecentLog({recent}: {recent: DevView['recent']}) {
  if (recent.length === 0) {
    return (
      <EmptyState icon="list" title="Журнал порожній">
        Надішліть першу подію — вона з’явиться тут.
      </EmptyState>
    );
  }
  return (
    <ul className="event-log">
      {recent.map((entry, index) => (
        <li key={`${entry.receivedAt}-${entry.eventType}-${index}`}>
          <code>{entry.eventType}</code>
          <StatusPill tone={INBOX_STATES[entry.state].tone}>{INBOX_STATES[entry.state].label}</StatusPill>
          <span className="event-log__meta">
            {SOURCE_LABELS[entry.source]} · <DateText value={entry.receivedAt} withTime />
          </span>
        </li>
      ))}
    </ul>
  );
}

const SNAPSHOTS: readonly AnalyticsSnapshotId[] = ['demo-cohort-v1', 'demo-small'];

interface SnapshotSwitchProps {
  current: AnalyticsSnapshotId;
  busy: boolean;
  onSelect: (snapshot: AnalyticsSnapshotId) => void;
}

/** Перемикач фіксованих зрізів аналітики; малий зріз показує приховування груп. */
export function SnapshotSwitch({current, busy, onSelect}: SnapshotSwitchProps) {
  return (
    <div className="snapshot-switch">
      <Segmented
        label="Фіксований зріз аналітики"
        variant="chips"
        options={SNAPSHOTS.map(id => ({value: id, label: SNAPSHOT_LABELS[id]}))}
        value={current}
        onChange={onSelect}
        disabled={busy}
      />
      <p className="muted">
        Зараз панель «Аналітика» показує: <strong>{SNAPSHOT_LABELS[current]}</strong>. Обидва зрізи вигадані й
        незмінні.
      </p>
    </div>
  );
}
