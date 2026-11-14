import type {TimelineCategory, TimelineEntryView, TimelineFollowUp} from '../../../shared/api';
import {DateText} from '../../components/DateText';
import {Icon, type IconName} from '../../components/Icon';
import {StatusPill, Tag} from '../../components/StatusPill';
import {
  ASSURANCE_LABELS,
  OWNER_LABELS,
  SOURCE_LABELS,
  taskKindLabel,
  TIMELINE_CATEGORY_LABELS,
} from '../../content/labels';
import {timelineCopy} from '../../content/timeline';
import {formatTime} from '../../lib/dates';
import {displayTime, earlierEventDay} from './timelineModel';

const CATEGORY_ICONS: Record<TimelineCategory, IconName> = {
  medical: 'medical',
  documents: 'document',
  vlk: 'shield',
  finance: 'finance',
  requests: 'message',
  sync: 'refresh',
};

/** Що далі після події: задачі, які відкрила саме вона, з власником і станом. */
function FollowUps({items}: {items: readonly TimelineFollowUp[]}) {
  if (items.length === 0) {
    return <p className="timeline__next">Подія лише підтверджує факт; наступної дії не потребує.</p>;
  }
  return (
    <div className="timeline__next">
      <p className="timeline__next-title">Що далі</p>
      <ul className="follow-ups">
        {items.map((item, index) => (
          <li key={`${item.kind}-${index}`}>
            <span>
              <strong>{taskKindLabel(item.kind)}</strong>
              <span className="follow-ups__owner">Відповідає: {OWNER_LABELS[item.ownerRole]}</span>
            </span>
            <StatusPill tone={item.open ? 'pending' : 'confirmed'}>{item.open ? 'Очікується' : 'Виконано'}</StatusPill>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Компактний рядок події; деталі (три різні моменти часу й джерело) — за розгортанням. */
export function TimelineEntry({entry}: {entry: TimelineEntryView}) {
  const copy = timelineCopy(entry.type);
  const eventDay = earlierEventDay(entry);
  return (
    <li className="timeline__entry">
      <details>
        <summary>
          <span className="timeline__icon">
            <Icon name={CATEGORY_ICONS[entry.category]} size={16} />
          </span>
          <span className="timeline__time">{formatTime(displayTime(entry)) ?? '—'}</span>
          <span className="timeline__title">{copy.title}</span>
          <span className="timeline__category">
            {TIMELINE_CATEGORY_LABELS[entry.category]}
            {eventDay && ` · подія від ${eventDay}`}
          </span>
          <Icon name="chevron" size={16} />
        </summary>
        <div className="timeline__details">
          <p>{copy.meaning}</p>
          <FollowUps items={entry.followUps} />
          <dl className="timeline__meta">
            <div>
              <dt>Час події за джерелом</dt>
              <dd>
                <DateText value={entry.occurredAt} withTime fallback="джерело не вказало" />
              </dd>
            </div>
            <div>
              <dt>Коли внесло джерело</dt>
              <dd>
                <DateText value={entry.sourceRecordedAt} withTime fallback="не застосовується" />
              </dd>
            </div>
            <div>
              <dt>Коли записано в кейс</dt>
              <dd>
                <DateText value={entry.recordedAt} withTime />
              </dd>
            </div>
            <div>
              <dt>Джерело</dt>
              <dd>{SOURCE_LABELS[entry.source]}</dd>
            </div>
          </dl>
          <Tag>{ASSURANCE_LABELS[entry.assurance]}</Tag>
        </div>
      </details>
    </li>
  );
}
