import type {AnalyticsSnapshotId, MetricState} from '../../shared/api';
import type {ToneLabel} from './labels';

export const METRIC_STATES: Record<MetricState, ToneLabel & {explain: string}> = {
  demo: {
    label: 'Вигаданий розрахунок',
    tone: 'neutral',
    explain: 'Пораховано на фіксованій вигаданій когорті.',
  },
  suppressed: {
    label: 'Приховано',
    tone: 'attention',
    explain: 'Група замала або доповнювальна: значення й точні розміри не показуємо.',
  },
  insufficient: {
    label: 'Недостатньо даних',
    tone: 'unknown',
    explain: 'Немає підтвердженого ненульового знаменника.',
  },
  context: {
    label: 'Зовнішній контекст',
    tone: 'pending',
    explain: 'Публічний зовнішній агрегат, не розрахунок на когорті й не ефект прототипу.',
  },
};

export const SNAPSHOT_LABELS: Record<AnalyticsSnapshotId, string> = {
  'demo-cohort-v1': 'Основний вигаданий зріз',
  'demo-small': 'Мала група · перевірити приховування',
};

/** Межі показу — щоб вигадані числа не читалися як результат продукту. */
export const ANALYTICS_LIMITS: readonly string[] = [
  'Це фіксована синтетична когорта, а не живі кейси: події симулятора її не змінюють.',
  'Базовий рівень для порівняння ще не визначено — baseline [TBD].',
  'Демо не доводить ефекту продукту: числа показують лише, як рахується показник.',
  'Фільтрів за підрозділом, закладом чи географією немає; довільних часових зрізів теж.',
];
