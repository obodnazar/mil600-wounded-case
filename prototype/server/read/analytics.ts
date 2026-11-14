import {Denied, safeAggregate} from '../../security/core.js';
import type {AnalyticsSnapshotId, AnalyticsView, MetricView} from '../../shared/api.js';
import type {Store} from '../db/store.js';

/**
 * Аналітика навчального прототипу.
 *
 * Окрема фіксована вигадана когорта, не пов’язана з живими кейсами D1: рядки
 * існують лише на сервері й ніколи не передаються браузеру. Показники обчислюються
 * формулами нижче, а не задані готовими числами. Це демонстрація розрахунку —
 * не baseline і не доказ ефекту продукту.
 */

export interface CohortRow {
  /** Підтверджена дата поранення або null, якщо її немає. */
  injury: string | null;
  /** Дата постанови ВЛК або null для відкритого кейсу. */
  decision: string | null;
  vlkReceived: boolean;
  vlkReturned: boolean;
  ogdReceived: boolean;
  ogdReturned: boolean;
  stop: 'confirmed_missed_exam' | 'confirmed_no_stop' | 'unknown';
  documents: {kind: string; received: boolean; mode: 'electronic' | 'unknown'}[];
  active: boolean;
  workMinutes: number;
}

const DOCUMENT_KINDS = ['primary_medical_card', 'trauma_certificate', 'medical_summary'];

export const COHORT: CohortRow[] = Array.from({length: 30}, (_, i) => ({
  injury: i >= 15 && i < 20 ? null : '2026-10-01',
  decision: i < 20 ? '2026-10-15' : null,
  vlkReceived: i < 25,
  vlkReturned: i < 10,
  ogdReceived: i < 20,
  ogdReturned: i < 5,
  stop: i < 5 ? 'confirmed_missed_exam' : i < 20 ? 'confirmed_no_stop' : 'unknown',
  documents: DOCUMENT_KINDS.map((kind, j) => {
    const received = i < 20 && j < 2;
    return {kind, received, mode: received ? 'electronic' : 'unknown'};
  }),
  active: true,
  workMinutes: 5 + (i % 3) * 5,
}));

/** Навмисно мала група для перевірки приховування. */
export const SMALL_COHORT = COHORT.slice(0, 3);

const MIN_GROUP = 5;
const MS_PER_DAY = 86_400_000;
const OMBUDSMAN_REPORT =
  'https://milomb.gov.ua/novyny/nad-chim-pracyuvala-komanda-ofisu-viyskovogo-ombudsmana-u-zhovtni';

/** Частка у відсотках з одним знаком; нульовий знаменник дає null, а не 0 %. */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

interface MetricDraft {
  id: string;
  title: string;
  value: string;
  detail: string;
  /** Усі клітинки, з яких складається показник і його покриття, включно з доповнювальними. */
  cells: number[];
  coverage: string;
  /** false — немає підтвердженого ненульового знаменника. */
  available: boolean;
}

/**
 * Чесне подання показника:
 *  - немає знаменника чи всі клітинки нульові → «Недостатньо даних» (а не 0 %);
 *  - хоча б одна клітинка менша за поріг → приховано значення, підсумки й точне
 *    покриття, щоб малу групу не можна було відновити відніманням;
 *  - інакше → обчислене значення з покриттям.
 */
function publish(draft: MetricDraft): MetricView {
  const {id, title} = draft;
  const empty = !draft.available || !draft.cells.length || draft.cells.every(cell => cell === 0);
  if (empty) {
    return {
      id,
      title,
      value: 'Недостатньо даних',
      detail: `Немає підтвердженого ненульового знаменника. ${draft.detail}`,
      state: 'insufficient',
      coverage: 'Покриття потребує уточнення',
    };
  }
  if (safeAggregate(draft.cells, MIN_GROUP).status === 'suppressed') {
    return {
      id,
      title,
      value: 'Приховано',
      detail: 'Мала або доповнювальна група. Значення, пов’язані підсумки й точні розміри приховано.',
      state: 'suppressed',
      coverage: 'Покриття приховане разом із групою',
    };
  }
  return {id, title, value: draft.value, detail: draft.detail, state: 'demo', coverage: draft.coverage};
}

/* ───────────── Формули BO-1 … BO-6 ───────────── */

/** BO-1: медіана календарних днів від підтвердженого поранення до постанови ВЛК. */
function timeToDecision(rows: CohortRow[]): MetricDraft {
  const completed = rows.filter(row => row.decision);
  const dated = completed.filter(row => row.injury);
  const undated = completed.length - dated.length;
  const open = rows.length - completed.length;
  const days = dated
    .map(row => (Date.parse(String(row.decision)) - Date.parse(String(row.injury))) / MS_PER_DAY)
    .sort((a, b) => a - b);
  const value = median(days);
  return {
    id: 'BO-1',
    title: 'Час до постанови ВЛК',
    value: value === null ? 'Недостатньо даних' : `${value} днів`,
    detail:
      'Медіана від підтвердженої дати поранення до визначеної постанови; ' +
      'клінічний час не оголошено адміністративною затримкою.',
    cells: [dated.length, undated, open],
    coverage: `${dated.length} з датами; ${undated} без дати; ${open} відкритих`,
    available: dated.length > 0,
  };
}

/** BO-2: частка унікальних пакетів із хоча б одним поверненням; ВЛК й ОГД окремо. */
function returnedPackets(rows: CohortRow[]): MetricDraft {
  const vlk = rows.filter(row => row.vlkReceived);
  const vlkReturned = vlk.filter(row => row.vlkReturned).length;
  const ogd = rows.filter(row => row.ogdReceived);
  const ogdReturned = ogd.filter(row => row.ogdReturned).length;
  const vlkUnknown = rows.length - vlk.length;
  const ogdUnknown = rows.length - ogd.length;
  return {
    id: 'BO-2',
    title: 'Пакети з поверненням',
    value: `ВЛК ${ratio(vlkReturned, vlk.length) ?? '—'}% · ОГД ${ratio(ogdReturned, ogd.length) ?? '—'}%`,
    detail:
      'Унікальні логічні пакети з ≥1 поверненням / отримані пакети. Ревізії не додають новий пакет. ' +
      'Горизонт спостереження у вигаданій когорті не моделюється.',
    cells: [vlkReturned, vlk.length - vlkReturned, vlkUnknown, ogdReturned, ogd.length - ogdReturned, ogdUnknown],
    coverage:
      `ВЛК ${vlkReturned}/${vlk.length}, отримання невідоме ${vlkUnknown}; ` +
      `ОГД ${ogdReturned}/${ogd.length}, невідоме ${ogdUnknown}`,
    available: vlk.length > 0 && ogd.length > 0,
  };
}

/** BO-3: підтверджені зупинки виплат через пропущений огляд серед покритих кейсів. */
function confirmedStops(rows: CohortRow[]): MetricDraft {
  const stopped = rows.filter(row => row.stop === 'confirmed_missed_exam').length;
  const covered = rows.filter(row => row.stop !== 'unknown').length;
  const unknown = rows.length - covered;
  return {
    id: 'BO-3',
    title: 'Підтверджені зупинки виплат',
    value: `${stopped}/${covered}`,
    detail:
      'Лише підтверджений належним джерелом код причини «пропущений обов’язковий огляд». ' +
      'Таймер не створює такого факту. Показник серед покритих, не оцінка всієї когорти.',
    cells: [stopped, covered - stopped, unknown],
    coverage: `${covered}/${rows.length} з підтвердженням; ${unknown} невідомих`,
    available: covered > 0,
  };
}

/** BO-4: зовнішній публічний контекст; не обчислюється з когорти й не є ефектом прототипу. */
const EXTERNAL_CONTEXT: MetricView = {
  id: 'BO-4',
  title: 'Зовнішній контекст скарг',
  value: '23% із 2 455',
  detail:
    'Частка скарг Військовому омбудсману щодо направлення на ВЛК та лікування — ширша категорія, ніж документи поранених. ' +
    'Звіт омбудсмана за жовтень, опублікований 06.11.2026; перевірено 14.11.2026. Не ефект прототипу.',
  coverage: 'Публічний зовнішній агрегат, поза вигаданою когортою',
  state: 'context',
  source: OMBUDSMAN_REPORT,
};

/** BO-5: електронно отримані документи / усі потрібні документи пакетів, включно з неотриманими. */
function electronicDocuments(rows: CohortRow[]): MetricDraft {
  const documents = rows.flatMap(row => row.documents);
  const electronic = documents.filter(document => document.received && document.mode === 'electronic').length;
  const other = documents.length - electronic;
  return {
    id: 'BO-5',
    title: 'Документи без кур’єра',
    value: `${ratio(electronic, documents.length) ?? '—'}%`,
    detail:
      'Отримані ВЛК електронно документи конкретної версії / всі потрібні документи пакетів зрізу. ' +
      'Брак і невідомий спосіб не зникають зі знаменника.',
    cells: [electronic, other],
    coverage: `${electronic}/${documents.length}; неотримані / спосіб невідомий ${other}`,
    available: documents.length > 0,
  };
}

/** BO-6: активні кейси на погоджену ставку супроводу (FTE) та окремо хвилини роботи на кейс з обліком. */
function supportWorkload(rows: CohortRow[], fte: number | null): MetricDraft {
  const active = rows.filter(row => row.active).length;
  const logged = rows.filter(row => row.workMinutes > 0);
  const minutes = logged.reduce((sum, row) => sum + row.workMinutes, 0);
  const known = fte !== null && fte > 0 && logged.length > 0;
  return {
    id: 'BO-6',
    title: 'Навантаження супроводу',
    value: known
      ? `${oneDecimal(active / fte)} кейсів на ставку · ${oneDecimal(minutes / logged.length)} хв/кейс`
      : 'Недостатньо даних',
    detail:
      'Активні кейси / погоджена вигадана кількість ставок супроводу; окремо вигадані хвилини з обліку роботи / ' +
      'кейси з таким обліком. ' +
      'Вік кейсу не замінює робочий час.',
    cells: fte !== null && fte >= MIN_GROUP ? [active, logged.length] : [],
    coverage: `${active} активних; ставок ${fte ?? 'невідомо'}; ${minutes} хв на ${logged.length} кейсів`,
    available: true,
  };
}

/** Обчислює незмінний зріз показників для когорти. */
const oneDecimal = (value: number): number => Math.round(value * 10) / 10;

/** Підпис зрізу: малий приклад не видається за основну когорту. */
export const SNAPSHOT_LABELS: Readonly<Record<AnalyticsSnapshotId, string>> = {
  'demo-cohort-v1': 'Основний фіксований вигаданий зріз (demo-cohort-v1)',
  'demo-small': 'Навчальний приклад малої групи (demo-small)',
};

export function computeSnapshot(
  rows: CohortRow[] = COHORT, fte: number | null = 5, label: string = SNAPSHOT_LABELS['demo-cohort-v1'],
): AnalyticsView {
  return {
    status: 'synthetic_fixed_snapshot',
    cohort: label,
    asOf: '2026-11-13T12:00:00.000Z',
    minimum: MIN_GROUP,
    metrics: [
      publish(timeToDecision(rows)),
      publish(returnedPackets(rows)),
      publish(confirmedStops(rows)),
      EXTERNAL_CONTEXT,
      publish(electronicDocuments(rows)),
      publish(supportWorkload(rows, fte)),
    ],
  };
}

/* ───────────── Опублікований зріз ───────────── */

export const SNAPSHOT_IDS: readonly AnalyticsSnapshotId[] = ['demo-cohort-v1', 'demo-small'];

/** Аналітик отримує лише заздалегідь зафіксований зріз; живі кейси його не змінюють. */
export function publishedAnalytics(store: Store): AnalyticsView {
  const row = store.row(
    "SELECT payload FROM analytics_snapshot WHERE id=(SELECT value FROM demo_setting WHERE id='analytics')",
  );
  if (!row) throw new Denied(503, 'analytics_unavailable');
  return JSON.parse(String(row.payload)) as AnalyticsView;
}

export function selectedSnapshot(store: Store): AnalyticsSnapshotId {
  const row = store.row("SELECT value FROM demo_setting WHERE id='analytics'");
  return row?.value === 'demo-small' ? 'demo-small' : 'demo-cohort-v1';
}

export function selectSnapshot(store: Store, snapshot: AnalyticsSnapshotId): void {
  store.run("UPDATE demo_setting SET value=? WHERE id='analytics'", snapshot);
}
