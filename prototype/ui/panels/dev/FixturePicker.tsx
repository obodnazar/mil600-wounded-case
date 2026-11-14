import {useEffect, useId, useRef} from 'react';
import type {FixtureGroup, FixtureView} from '../../../shared/api';
import {Icon} from '../../components/Icon';
import {Segmented} from '../../components/Segmented';
import {FIXTURE_GROUP_LABELS, FIXTURE_GROUPS} from '../../content/dev';
import {SOURCE_LABELS} from '../../content/labels';

const groupLabel = (group: FixtureGroup): string =>
  `${FIXTURE_GROUP_LABELS[group].short} · ${FIXTURE_GROUP_LABELS[group].title}`;

interface FixturePickerProps {
  fixtures: readonly FixtureView[];
  selected: FixtureView;
  sent: readonly string[];
  onSelect: (id: string) => void;
}

/** Вибір навчальної події: звичайний select і зручний список за групами сценаріїв. */
export function FixturePicker({fixtures, selected, sent, onSelect}: FixturePickerProps) {
  const selectId = useId();
  const list = useRef<HTMLUListElement>(null);
  // Вибрана подія має бути видима у прокручуваному списку (вибір може прийти зі шпаргалки чи select).
  useEffect(() => {
    list.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({block: 'nearest'});
  }, [selected.id]);
  const groups = FIXTURE_GROUPS.filter(group => fixtures.some(fixture => fixture.group === group));
  const inGroup = (group: FixtureGroup) => fixtures.filter(fixture => fixture.group === group);
  const openGroup = (group: FixtureGroup) => {
    const first = inGroup(group)[0];
    if (first) onSelect(first.id);
  };

  return (
    <div className="fixture-picker">
      <div className="field">
        <label htmlFor={selectId}>Навчальна подія</label>
        <div className="field__control">
          <select id={selectId} value={selected.id} onChange={event => onSelect(event.target.value)}>
            {groups.map(group => (
              <optgroup key={group} label={groupLabel(group)}>
                {inGroup(group).map(fixture => (
                  <option key={fixture.id} value={fixture.id}>
                    {fixture.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Icon name="chevron" />
        </div>
      </div>
      <Segmented
        label="Група сценаріїв"
        variant="chips"
        options={groups.map(group => ({
          value: group,
          label: FIXTURE_GROUP_LABELS[group].short,
          count: inGroup(group).length,
        }))}
        value={selected.group}
        onChange={openGroup}
      />
      <p className="fixture-picker__group">{FIXTURE_GROUP_LABELS[selected.group].title}</p>
      <ul className="fixture-list" aria-label="Події вибраної групи" ref={list}>
        {inGroup(selected.group).map(fixture => (
          <li key={fixture.id}>
            <button
              type="button"
              className="fixture-list__item"
              aria-pressed={fixture.id === selected.id}
              onClick={() => onSelect(fixture.id)}
            >
              <span className="fixture-list__title">{fixture.title}</span>
              <span className="fixture-list__meta">
                {SOURCE_LABELS[fixture.source]}
                {sent.includes(fixture.id) && (
                  <span className="fixture-list__sent">
                    <Icon name="check" size={16} />
                    надіслано з цієї вкладки
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
