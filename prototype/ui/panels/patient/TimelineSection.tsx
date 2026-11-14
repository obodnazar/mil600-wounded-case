import {useState} from 'react';
import type {PatientCaseView} from '../../../shared/api';
import {Button} from '../../components/Button';
import {Card} from '../../components/Card';
import {Section} from '../../components/Section';
import {EmptyState} from '../../components/EmptyState';
import {Segmented} from '../../components/Segmented';
import {TIMELINE_CATEGORY_LABELS} from '../../content/labels';
import {pluralize} from '../../lib/dates';
import {TimelineEntry} from './TimelineEntry';
import {
  countByCategory,
  filterEntries,
  groupByDay,
  INITIAL_LIMIT,
  LIMIT_STEP,
  presentCategories,
  type TimelineFilter,
} from './timelineModel';

const EVENT_FORMS = ['подія', 'події', 'подій'] as const;

/** Журнал подій: фільтр за категорією, останні N із «Показати ще», групи за датою. */
export function TimelineSection({view}: {view: PatientCaseView}) {
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [limit, setLimit] = useState(INITIAL_LIMIT);
  const counts = countByCategory(view.timeline);
  const activeFilter = counts[filter] > 0 ? filter : 'all';
  const filtered = filterEntries(view.timeline, activeFilter);
  const visible = filtered.slice(0, limit);
  const hidden = filtered.length - visible.length;
  const options = [
    {value: 'all' as const, label: 'Усі', count: counts.all},
    ...presentCategories(counts).map(category => ({
      value: category,
      label: TIMELINE_CATEGORY_LABELS[category],
      count: counts[category],
    })),
  ];
  const changeFilter = (next: TimelineFilter) => {
    setFilter(next);
    setLimit(INITIAL_LIMIT);
  };

  return (
    <Section
      id="timeline"
      eyebrow="Журнал"
      title="Події кейсу"
      lead="Від найновішого запису в кейсі. Натисніть подію, щоб побачити, що далі, хто відповідає і звідки запис."
      collapsible
      summary={pluralize(view.timeline.length, EVENT_FORMS)}
    >
      <Card>
        {view.timeline.length === 0 ? (
          <EmptyState icon="list" title="Подій ще немає">
            Перший запис з’явиться, коли джерело підтвердить медичний документ.
          </EmptyState>
        ) : (
          <>
            <Segmented
              label="Фільтр подій за категорією"
              variant="chips"
              options={options}
              value={activeFilter}
              onChange={changeFilter}
            />
            <p className="timeline__summary" role="status">
              Показано {visible.length} із {pluralize(filtered.length, EVENT_FORMS)}
              {view.timelineTotal > view.timeline.length &&
                `. У кейсі всього ${view.timelineTotal}; давніші записи зберігаються на сервері`}
              .
            </p>
            <div className="timeline">
              {groupByDay(visible).map((group, index) => (
                <section key={`${group.key}-${index}`} className="timeline__group" aria-label={group.label}>
                  <h3 className="timeline__day">{group.label}</h3>
                  <ol className="timeline__list">
                    {group.entries.map(entry => (
                      <TimelineEntry key={entry.id} entry={entry} />
                    ))}
                  </ol>
                </section>
              ))}
            </div>
            <div className="timeline__more">
              {hidden > 0 && (
                <Button icon="chevron" onClick={() => setLimit(limit + LIMIT_STEP)}>
                  Показати ще {Math.min(hidden, LIMIT_STEP)}
                </Button>
              )}
              {limit > INITIAL_LIMIT && filtered.length > INITIAL_LIMIT && (
                <Button variant="ghost" onClick={() => setLimit(INITIAL_LIMIT)}>
                  Згорнути до останніх {INITIAL_LIMIT}
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
    </Section>
  );
}
