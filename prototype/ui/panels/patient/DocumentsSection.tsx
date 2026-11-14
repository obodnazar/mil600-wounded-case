import {useState} from 'react';
import type {PatientCaseView, RouteChecklistView} from '../../../shared/api';
import type {CommandDraft} from '../../app/useCommand';
import {Card} from '../../components/Card';
import {Section} from '../../components/Section';
import {EmptyState} from '../../components/EmptyState';
import {Segmented} from '../../components/Segmented';
import {ROUTE_LABELS} from '../../content/labels';
import {CHECKLIST_NOTE} from '../../content/legal';
import {formatMonth} from '../../lib/dates';
import {DocumentRow} from './DocumentRow';
import {SampleGallery} from './SampleGallery';

/** «Винагорода · листопад 2026»; без періоду — лише назва маршруту. */
function checklistLabel(list: RouteChecklistView): string {
  const period = formatMonth(list.period);
  return period ? `${ROUTE_LABELS[list.route]} · ${period}` : ROUTE_LABELS[list.route];
}

const ROUTE_ORDER: readonly RouteChecklistView['route'][] = ['vlk', 'reward', 'ogd'];

/** Сталий порядок переліків: ВЛК, винагорода, ОГД; усередині маршруту — за періодом. */
function orderChecklists(lists: readonly RouteChecklistView[]): RouteChecklistView[] {
  return [...lists].sort(
    (a, b) =>
      ROUTE_ORDER.indexOf(a.route) - ROUTE_ORDER.indexOf(b.route) || (a.period ?? '').localeCompare(b.period ?? ''),
  );
}

function Checklist({list}: {list: RouteChecklistView}) {
  if (list.items.length === 0) {
    return (
      <EmptyState icon="document" title="У цьому переліку ще немає документів">
        Перелік з’явиться, коли адресат підтвердить пакет.
      </EmptyState>
    );
  }
  return (
    <>
      <p className="checklist__meta">
        Пакет: ревізія {list.packetRevision}. Перелік технічний і може уточнюватися.
      </p>
      <ul className="document-grid">
        {list.items.map((item, position) => (
          <DocumentRow key={`${item.kind}-${position}`} item={item} route={list.route} />
        ))}
      </ul>
    </>
  );
}

interface DocumentsSectionProps {
  view: PatientCaseView;
  busy: boolean;
  onCommand: (draft: CommandDraft) => void;
}

/** Документи за маршрутами: окремий перелік для кожного адресата й періоду. */
export function DocumentsSection({view, busy, onCommand}: DocumentsSectionProps) {
  const [selected, setSelected] = useState('0');
  const lists = orderChecklists(view.documents);
  const options = lists.map((list, index) => ({value: String(index), label: checklistLabel(list)}));
  const index = Math.min(Number(selected), lists.length - 1);
  const current = lists[index];
  return (
    <Section
      id="documents"
      eyebrow="Документи"
      title="Документи та їх актуальні версії"
      lead="Для кожного адресата — окремий перелік. Надіслано й отримано — різні підтвердження."
      collapsible
      summary={`Переліків: ${view.documents.length}`}
    >
      <Card>
        {current ? (
          <>
            <Segmented
              label="Перелік документів"
              variant="chips"
              options={options}
              value={String(index)}
              onChange={setSelected}
            />
            <Checklist list={current} />
          </>
        ) : (
          <EmptyState icon="document" title="Переліків документів ще немає">
            Вони з’являться після першого підтвердження джерела.
          </EmptyState>
        )}
        <p className="card__note">{CHECKLIST_NOTE}</p>
        <SampleGallery caseId={view.id} busy={busy} onCommand={onCommand} />
      </Card>
    </Section>
  );
}
