import {useId, useState} from 'react';
import type {StaffCaseView} from '../../../shared/api';
import {Button} from '../../components/Button';
import {EmptyState} from '../../components/EmptyState';
import {Icon} from '../../components/Icon';
import {Segmented} from '../../components/Segmented';
import {CaseListItem} from './CaseListItem';
import {CASE_FILTER_LABELS, CASE_FILTERS, countCases, selectCases, type CaseFilter} from './staffModel';

interface CaseListProps {
  cases: readonly StaffCaseView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Список призначених кейсів із пошуком і фільтром за станом. */
export function CaseList({cases, selectedId, onSelect}: CaseListProps) {
  const [filter, setFilter] = useState<CaseFilter>('all');
  const [query, setQuery] = useState('');
  const searchId = useId();
  const counts = countCases(cases);
  const shown = selectCases(cases, filter, query);
  const options = CASE_FILTERS.filter(item => item === 'all' || counts[item] > 0).map(item => ({
    value: item,
    label: CASE_FILTER_LABELS[item],
    count: counts[item],
  }));
  const reset = () => {
    setFilter('all');
    setQuery('');
  };

  return (
    <section className="case-list" aria-labelledby="case-list-title">
      <h2 id="case-list-title">Призначені кейси</h2>
      <div className="field">
        <label htmlFor={searchId}>Пошук кейсу</label>
        <div className="field__control">
          <Icon name="search" />
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder="Наприклад, учасник 03"
            onChange={event => setQuery(event.target.value)}
          />
        </div>
      </div>
      <Segmented
        label="Фільтр кейсів за станом"
        variant="chips"
        options={options}
        value={filter}
        onChange={setFilter}
      />
      <p className="case-list__count" role="status">
        Показано {shown.length} із {cases.length}
      </p>
      {shown.length > 0 ? (
        <ul className="case-list__items">
          {shown.map(item => (
            <CaseListItem
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon="search"
          title={cases.length === 0 ? 'Призначених кейсів немає' : 'За цими умовами кейсів немає'}
          action={cases.length > 0 ? <Button onClick={reset}>Скинути пошук і фільтр</Button> : undefined}
        >
          {cases.length === 0
            ? 'У вашій області доступу зараз немає жодного кейсу.'
            : 'Змініть запит або зніміть фільтр, щоб побачити інші кейси.'}
        </EmptyState>
      )}
    </section>
  );
}
