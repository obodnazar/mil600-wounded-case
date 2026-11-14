import type {
  CaseMilestones,
  DemoProfile,
  DocumentItemState,
  DocumentItemView,
  DocumentKind,
  FinanceStatus,
  FinanceTrackView,
  Freshness,
  OwnerRole,
  RouteCode,
  SourceCode,
  StageCode,
  SupportRequestCategory,
  SupportRequestView,
  TaskKind,
  TaskView,
  TimelineCategory,
  TimelineEntryView,
} from '../../shared/api';
import {TRAUMA_CERTIFICATE_NAME} from './legal';

/** Смисловий тон стану. Колір завжди дублюється іконкою й текстом. */
export type Tone = 'confirmed' | 'pending' | 'unknown' | 'attention' | 'conflict' | 'neutral';

export interface ToneLabel {
  label: string;
  tone: Tone;
}

export const UNKNOWN = 'невідомо';

export const PROFILE_LABELS: Record<DemoProfile, string> = {
  patient: 'Військовослужбовець',
  commander: 'Командир',
  support: 'Супровід',
  analyst: 'Аналітик',
  dev: 'Розробник',
};

export const STAGE_LABELS: Record<StageCode, string> = {
  administrative_open: 'Адміністративний запит відкрито',
  source_linked: 'Медичний документ долучено',
  care: 'Лікування',
  documents: 'Оформлення документів',
  vlk: 'Розгляд ВЛК',
  service_action: 'Дія за постановою ВЛК',
  finance: 'Розгляд виплат',
  completed: 'Маршрут завершено',
};

export const FRESHNESS: Record<Freshness, ToneLabel & {detail: string}> = {
  fresh: {label: 'Дані актуальні', tone: 'confirmed', detail: 'Останнє підтвердження джерела враховано.'},
  stale: {
    label: 'Дані не оновлено',
    tone: 'attention',
    detail: 'Дані не оновлено; попередні підтвердження збережено.',
  },
  conflict: {
    label: 'Є суперечність',
    tone: 'conflict',
    detail: 'Є суперечність, її розбирає супровід — нічого не втрачено.',
  },
  unknown: {
    label: 'Актуальність невідома',
    tone: 'unknown',
    detail: 'Джерело не підтвердило, чи ці дані актуальні.',
  },
};

/** Початковий стан навчальних даних: джерела ще нічого не надсилали, і це не суперечить фактам кейсу. */
const INITIAL_STATE: ToneLabel & {detail: string} = {
  label: 'Початковий навчальний стан',
  tone: 'neutral',
  detail: 'Початковий навчальний стан: нових подій від джерел ще не надходило.',
};

/** Актуальність кейсу з урахуванням того, чи була хоч одна подія від джерела. */
export function describeFreshness(freshness: Freshness, lastSourceAt: string | null): ToneLabel & {detail: string} {
  return freshness === 'unknown' && lastSourceAt === null ? INITIAL_STATE : FRESHNESS[freshness];
}

const AWAITING_SOURCE = 'запит подано; чекаємо підтвердження джерела';

type MilestoneCopy<K extends keyof CaseMilestones> = Record<CaseMilestones[K], {value: string; tone: Tone}>;

/** Віхи кейсу: кожне значення має власний підпис; «none» — джерело ще нічого не підтверджувало. */
export const MILESTONES: {[K in keyof CaseMilestones]: {label: string; values: MilestoneCopy<K>}} = {
  certificate: {
    label: 'Видача довідки про обставини травми',
    values: {
      none: {value: UNKNOWN, tone: 'unknown'},
      prepared: {value: 'складено медичною службою; видача не підтверджена', tone: 'pending'},
      requested: {value: AWAITING_SOURCE, tone: 'pending'},
      issued: {value: 'видачу підтверджено джерелом', tone: 'confirmed'},
    },
  },
  referral: {
    label: 'Направлення на ВЛК',
    values: {
      none: {value: UNKNOWN, tone: 'unknown'},
      requested: {value: AWAITING_SOURCE, tone: 'pending'},
      issued: {value: 'підтверджено джерелом', tone: 'confirmed'},
    },
  },
  vlkPacket: {
    label: 'Пакет ВЛК',
    values: {
      none: {value: UNKNOWN, tone: 'unknown'},
      received: {value: 'ВЛК підтвердила отримання пакета', tone: 'confirmed'},
      returned: {value: 'ВЛК повернула пакет авторові на уточнення', tone: 'attention'},
    },
  },
  vlkDecision: {
    label: 'Постанова ВЛК',
    values: {
      none: {value: UNKNOWN, tone: 'unknown'},
      clarification_needed: {value: 'ВЛК запитала уточнення; попередня постанова не є підставою', tone: 'attention'},
      recorded: {value: 'постанову оформлено; підтверджено джерелом', tone: 'confirmed'},
    },
  },
  serviceAction: {
    label: 'Дія за постановою',
    values: {
      none: {value: UNKNOWN, tone: 'unknown'},
      awaited: {value: 'очікується; виконання має підтвердити джерело', tone: 'pending'},
      confirmed: {value: 'виконання підтверджено джерелом', tone: 'confirmed'},
    },
  },
};

export const OWNER_LABELS: Record<OwnerRole, string> = {
  support: 'Служба супроводу',
  commander: 'Командир',
  medical_service: 'Медична служба',
};

const TASK_LABELS: Record<TaskKind, string> = {
  await_primary_source: 'Дочекатися медичного документа від джерела',
  prepare_certificate: `Скласти документ: ${TRAUMA_CERTIFICATE_NAME}`,
  issue_certificate: `Видати документ: ${TRAUMA_CERTIFICATE_NAME}`,
  await_source_confirmation: 'Дочекатися підтвердження джерела',
  await_recipient_receipt: 'Отримати підтвердження, що адресат отримав чинну версію',
  confirm_receipt_date: 'Підтвердити дату отримання документа',
  certificate_status_check: 'Уточнити стан видачі довідки',
  review_deadline: 'Перевірити строк разом із відповідальним',
  clarify_care_start: 'Уточнити початок лікування',
  await_vlk_receipt: 'Уточнити, чи ВЛК отримала пакет',
  next_service_action: 'Виконати адміністративну дію за постановою ВЛК',
  clarify_finance: 'Уточнити підставу й результат виплати',
  clarify_author: 'Уточнити в автора документа',
  verify_demo_copy: 'Технічно перевірити навчальну копію',
  reconcile_missing_event: 'Звірити пропущене підтвердження з джерелом',
};

const AWAITED_LABELS: Record<NonNullable<TaskView['awaits']>, string> = {
  issue_certificate: 'Дочекатися від джерела підтвердження видачі довідки',
  refer_vlk: 'Дочекатися від джерела підтвердження направлення на ВЛК',
};

/** Підпис задачі за її видом (коли деталей задачі немає). */
export function taskKindLabel(kind: TaskKind): string {
  return TASK_LABELS[kind];
}

export function taskLabel(task: TaskView): string {
  if (task.kind === 'await_source_confirmation' && task.awaits) return AWAITED_LABELS[task.awaits];
  return TASK_LABELS[task.kind];
}

/** Відкритий перелік кодів: невідомий код отримує запасний підпис. */
const REVIEW_REASONS: Record<string, string> = {
  missing_incident: 'Особа відома, але випадок треба звірити з джерелом',
  event_conflict: 'Та сама подія надійшла з іншим змістом',
  packet_returned: 'Адресат повернув пакет на уточнення',
  receipt_date_conflict: 'Джерела дали різні дати отримання документа',
  admission_conflict: 'Суперечність у даних про надходження до закладу',
  receipt_unknown_version: 'Отримання стосується невідомої версії документа',
  unknown_document: 'Подія посилається на документ, якого немає в кейсі',
};

export function reviewReasonLabel(reason: string): string {
  return REVIEW_REASONS[reason] ?? 'Дані джерела потребують ручної звірки';
}

export const REQUEST_CATEGORY_LABELS: Record<SupportRequestCategory, string> = {
  next_step: 'Питання про наступний крок',
  status_clarification: 'Уточнення стану кейсу',
  relative_contact_without_access: 'Звернення родини (без доступу до кейсу)',
};

export const REQUEST_STATES: Record<SupportRequestView['state'], ToneLabel> = {
  open: {label: 'Призначено супроводу', tone: 'pending'},
  resolved: {label: 'Відповідь підготовлено', tone: 'confirmed'},
};

export const ROUTE_LABELS: Record<RouteCode, string> = {
  vlk: 'ВЛК',
  reward: 'Винагорода',
  ogd: 'ОГД',
};

export const ROUTE_RECIPIENTS: Record<RouteCode, string> = {
  vlk: 'ВЛК',
  reward: 'фінансовий орган',
  ogd: 'фінансовий орган',
};

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  primary_medical_card: 'Первинна медична картка (еПМК)',
  trauma_certificate: TRAUMA_CERTIFICATE_NAME,
  medical_summary: 'Виписка / медичне резюме',
  hospital_stay_certificate: 'Довідка про перебування в закладі',
  vlk_decision: 'Постанова ВЛК',
  referral: 'Направлення на ВЛК',
};

export const DOCUMENT_STATES: Record<DocumentItemState, ToneLabel> = {
  not_applicable: {label: 'Не застосовується', tone: 'neutral'},
  applicability_unknown: {label: 'Застосовність уточнюється', tone: 'unknown'},
  missing: {label: 'Бракує', tone: 'attention'},
  wrong_kind: {label: 'Помилка: інший вид зразка', tone: 'conflict'},
  copy_pending: {label: 'Копія очікує перевірки', tone: 'pending'},
  copy_checked: {label: 'Копію технічно звірено', tone: 'pending'},
  prepared: {label: 'Складено; видача не підтверджена', tone: 'pending'},
  issued: {label: 'Видачу підтвердило джерело', tone: 'confirmed'},
  source_referenced: {label: 'Є посилання джерела', tone: 'confirmed'},
};

export const PROVENANCE_LABELS: Record<NonNullable<DocumentItemView['provenance']>, string> = {
  source_reference: 'Посилання джерела',
  manual_demo_copy: 'Навчальна копія, не оригінал',
};

export const DELIVERY_STEPS: readonly {state: DocumentItemView['delivery']; label: string}[] = [
  {state: 'none', label: 'Не передано'},
  {state: 'sent', label: 'Надіслано'},
  {state: 'received', label: 'Отримано'},
];

export const DELIVERY_DETAILS: Record<DocumentItemView['delivery'], string> = {
  none: 'Чинну версію ще не передано адресатові',
  sent: 'Надіслано; отримання адресатом не підтверджене',
  received: 'Отримання цієї версії адресатом підтверджене',
};

export const VERSION_STATE_LABELS: Record<DocumentItemView['history'][number]['state'], string> = {
  superseded: 'замінена новішою',
  withdrawn: 'відкликана',
};

export const FINANCE_KIND_LABELS: Record<FinanceTrackView['kind'], string> = {
  reward: 'Винагорода під час лікування',
  ogd: 'Одноразова грошова допомога (ОГД)',
};

export const FINANCE_STATES: Record<FinanceStatus, ToneLabel & {short: string}> = {
  under_review: {label: 'Розгляд документів', short: 'на розгляді', tone: 'pending'},
  returned: {label: 'Повернуто на уточнення', short: 'повернуто на уточнення', tone: 'attention'},
  denied: {label: 'Відмовлено; уточніть підставу', short: 'відмовлено', tone: 'conflict'},
  approved: {
    label: 'Схвалено; виконання ще не підтверджене',
    short: 'схвалено, виконання не підтверджене',
    tone: 'pending',
  },
  execution_partial: {
    label: 'Виконання підтверджене частково',
    short: 'виконання підтверджене частково',
    tone: 'pending',
  },
  execution_confirmed: {
    label: 'Виконання підтверджене джерелом',
    short: 'виконання підтверджене',
    tone: 'confirmed',
  },
  unknown: {label: 'Джерельний стан невідомий', short: UNKNOWN, tone: 'unknown'},
};

const FINANCE_REASONS: Record<string, string> = {
  documents_needed: 'Потрібне уточнення документів',
  confirmed_scope: 'Підставу підтвердило джерело',
  not_available: 'Джерело ще не передало підстави',
};

export function financeReasonLabel(reason: string): string {
  return FINANCE_REASONS[reason] ?? 'Підставу уточнює супровід';
}

export const SOURCE_LABELS: Record<SourceCode, string> = {
  medical: 'Військове медичне джерело',
  civil_medical: 'Цивільний медичний заклад',
  documents: 'Система документообігу',
  vlk: 'ВЛК',
  finance: 'Фінансовий орган',
  service: 'Служба частини',
  user: 'Дія в панелі',
  seed: 'Початкові навчальні дані',
};

export const TIMELINE_CATEGORY_LABELS: Record<TimelineCategory, string> = {
  medical: 'Лікування',
  documents: 'Документи',
  vlk: 'ВЛК і служба',
  finance: 'Виплати',
  requests: 'Звернення',
  sync: 'Оновлення даних',
};

export const TIMELINE_CATEGORIES: readonly TimelineCategory[] = [
  'medical',
  'documents',
  'vlk',
  'finance',
  'requests',
  'sync',
];

export const ASSURANCE_LABELS: Record<TimelineEntryView['assurance'], string> = {
  synthetic_seed: 'Вигаданий seed',
  simulated_source: 'Симуляція',
  demo_command: 'Дія в панелі',
};
