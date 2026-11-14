/**
 * Контракт між сервером і браузером навчального прототипу.
 *
 * Сервер віддає коди станів, а не готові фрази: українські підписи живуть в UI.
 * Жодне поле тут не містить секретів, ключів джерел, внутрішніх ідентифікаторів
 * записів джерела чи клінічного змісту.
 */

export type DemoProfile = 'patient' | 'commander' | 'support' | 'analyst' | 'dev';
export type StaffProfile = 'commander' | 'support';

export interface SessionView {
  profile: DemoProfile | null;
  csrf: string;
  /** Unix-час у мілісекундах, після якого сесія нечинна. */
  expiresAt: number;
  profiles: DemoProfile[];
}

/* ───────────── Спільні коди ───────────── */

export type Freshness = 'fresh' | 'stale' | 'conflict' | 'unknown';
export type Applicability = 'applicable' | 'not_applicable' | 'unknown';
export type AnchorStatus = 'confirmed' | 'estimated' | 'unknown';

export type StageCode =
  | 'administrative_open'
  | 'source_linked'
  | 'care'
  | 'documents'
  | 'vlk'
  | 'service_action'
  | 'finance'
  | 'completed';

export type CaseOrigin = 'medical_event' | 'administrative_request';

/** Узагальнене джерело події без технічного ключа системи. */
export type SourceCode =
  | 'medical'
  | 'civil_medical'
  | 'documents'
  | 'vlk'
  | 'finance'
  | 'service'
  | 'user'
  | 'seed';

export type OwnerRole = 'support' | 'commander' | 'medical_service';

export type TaskKind =
  | 'await_primary_source'
  | 'prepare_certificate'
  | 'issue_certificate'
  | 'await_source_confirmation'
  | 'await_recipient_receipt'
  | 'confirm_receipt_date'
  | 'certificate_status_check'
  | 'review_deadline'
  | 'clarify_care_start'
  | 'await_vlk_receipt'
  | 'next_service_action'
  | 'clarify_finance'
  | 'clarify_author'
  | 'verify_demo_copy'
  | 'reconcile_missing_event';

export interface TaskView {
  id: string;
  kind: TaskKind;
  ownerRole: OwnerRole;
  /** Для await_source_confirmation — яку саме дію командира очікує джерело. */
  awaits: 'issue_certificate' | 'refer_vlk' | null;
  /** Задачу створено вручну командою супроводу, і її можна закрити вручну. */
  manual: boolean;
}

export interface ReviewView {
  id: string;
  /** Код причини розбору (наприклад missing_incident, event_conflict). */
  reason: string;
  /** Лише невизначений випадок можна підтвердити вручну після звірки (resolve_review). */
  resolvable: boolean;
  /**
   * Інші розбори супровід може закрити після звірки з джерелом (close_review):
   * подія лишається незастосованою, бізнес-стан не змінюється.
   */
  closable: boolean;
}

export type SupportRequestCategory =
  | 'next_step'
  | 'status_clarification'
  | 'relative_contact_without_access';

export interface SupportRequestView {
  id: string;
  category: SupportRequestCategory;
  state: 'open' | 'resolved';
}

/** Правило довідки: 5 календарних днів від підтвердженого отримання документа. */
export interface CertificateDeadlineView {
  applicability: Applicability;
  anchorStatus: AnchorStatus;
  /** Дата (YYYY-MM-DD) підтвердженого отримання документа військовослужбовцем. */
  anchorDate: string | null;
  /** Є лише за підтвердженого отримання й застосовності. */
  dueDate: string | null;
  /** Орієнтир від внесення еПМК; це не юридичний строк. */
  followUpDate: string | null;
  /** Строк сплив, і людині створено задачу перевірки. Санкцій немає. */
  reviewOpen: boolean;
}

/** Контроль строку лікування: 4 календарні місяці від підтвердженого початку. */
export interface CareDeadlineView {
  applicability: Applicability;
  startDate: string | null;
  dueDate: string | null;
}

/* ───────────── Кейс ───────────── */

export interface CaseSummaryView {
  id: string;
  label: string;
  stage: StageCode;
  origin: CaseOrigin;
  /** false — медичний документ ще не підтверджений джерелом. */
  sourceLinked: boolean;
  freshness: Freshness;
  /** Час останньої прийнятої джерельної події (ISO) або null. */
  lastSourceAt: string | null;
  tasks: TaskView[];
  reviews: ReviewView[];
  requests: SupportRequestView[];
  certificateDeadline: CertificateDeadlineView;
}

export type RouteCode = 'vlk' | 'reward' | 'ogd';

export type DocumentKind =
  | 'primary_medical_card'
  | 'trauma_certificate'
  | 'medical_summary'
  | 'hospital_stay_certificate'
  | 'vlk_decision'
  | 'referral';

export type DocumentItemState =
  | 'not_applicable'
  | 'applicability_unknown'
  | 'missing'
  | 'wrong_kind'
  | 'copy_pending'
  | 'copy_checked'
  | 'prepared'
  | 'issued'
  | 'source_referenced';

export interface DocumentVersionView {
  version: string;
  state: 'superseded' | 'withdrawn';
}

export interface DocumentItemView {
  kind: DocumentKind;
  state: DocumentItemState;
  /** Чинна версія документа або null, якщо документа немає. */
  version: string | null;
  provenance: 'source_reference' | 'manual_demo_copy' | null;
  /** Стан доставки саме чинної версії адресатові маршруту. */
  delivery: 'received' | 'sent' | 'none';
  /** Попередні версії: історія не стирається. */
  history: DocumentVersionView[];
}

export interface RouteChecklistView {
  route: RouteCode;
  /** Період пакета (YYYY-MM), якщо адресат його підтвердив; один маршрут може мати кілька пакетів. */
  period: string | null;
  packetRevision: string;
  /** Версія технічного правила переліку; це не юридична повнота пакета. */
  ruleVersion: string;
  items: DocumentItemView[];
}

export type FinanceStatus =
  | 'under_review'
  | 'returned'
  | 'denied'
  | 'approved'
  | 'execution_partial'
  | 'execution_confirmed'
  | 'unknown';

export interface FinanceTrackView {
  kind: 'reward' | 'ogd';
  /** Перший день періоду (YYYY-MM-DD). */
  periodStart: string;
  periodEnd: string;
  status: FinanceStatus;
  reason: 'documents_needed' | 'confirmed_scope' | 'not_available' | string;
  decisionConfirmed: boolean;
  executionConfirmed: boolean;
  source: SourceCode;
  /** Є відкрите уточнення через невідомий або негативний сигнал джерела. */
  clarificationOpen: boolean;
}

export type TimelineCategory = 'medical' | 'documents' | 'vlk' | 'finance' | 'requests' | 'sync';

/** Задача, яку відкрила саме ця подія: реальний власник і стан наступної дії. */
export interface TimelineFollowUp {
  kind: TaskKind;
  ownerRole: OwnerRole;
  /** true — дія ще очікується; false — уже виконана й підтверджена. */
  open: boolean;
}

export interface TimelineEntryView {
  id: string;
  /** Тип події контракту, наприклад document.issued або command.refer_vlk. */
  type: string;
  category: TimelineCategory;
  /** Час події за джерелом (ISO) або null, якщо джерело його не дало. */
  occurredAt: string | null;
  /** Коли джерело внесло запис (ISO); null для дій користувача й seed. */
  sourceRecordedAt: string | null;
  /** Коли подію записано в кейс (ISO). */
  recordedAt: string;
  source: SourceCode;
  assurance: 'synthetic_seed' | 'simulated_source' | 'demo_command';
  /** Порожньо — подія лише підтверджує факт і не потребує наступної дії. */
  followUps: TimelineFollowUp[];
}

/**
 * Підтверджені віхи маршруту. Кожна має власне джерело підтвердження,
 * жодна не виводиться з іншої: «подано запит» ≠ «видано», «постанова» ≠ «виконано».
 */
export interface CaseMilestones {
  /** Довідка про обставини травми: складено медслужбою → запит командира → видачу підтвердило джерело. */
  certificate: 'none' | 'prepared' | 'requested' | 'issued';
  referral: 'none' | 'requested' | 'issued';
  vlkPacket: 'none' | 'received' | 'returned';
  /** Чинною є остання постанова: або запит на уточнення, або оформлена постанова. */
  vlkDecision: 'none' | 'clarification_needed' | 'recorded';
  /** Адміністративна дія за чинною постановою: очікується або підтверджена джерелом. */
  serviceAction: 'none' | 'awaited' | 'confirmed';
}

export interface PatientCaseView extends CaseSummaryView {
  milestones: CaseMilestones;
  care: {
    /** Умовна назва закладу без адреси; null, якщо поточний заклад не підтверджено. */
    facility: string | null;
    deadline: CareDeadlineView;
  };
  documents: RouteChecklistView[];
  finances: FinanceTrackView[];
  /** Від найновішої до найстарішої; сервер обмежує довжину. */
  timeline: TimelineEntryView[];
  timelineTotal: number;
}

/* ───────────── Службова панель ───────────── */

export type CommandAction =
  | 'admin_open'
  | 'issue_certificate'
  | 'refer_vlk'
  | 'clarify'
  | 'gap'
  | 'support_request'
  | 'resolve_support'
  | 'copy'
  | 'verify_copy'
  | 'resolve_review'
  | 'close_review'
  | 'resolve_task';

export type UnavailableReason =
  | 'commander_only'
  | 'certificate_not_prepared'
  | 'certificate_already_issued'
  | 'request_pending'
  | 'already_referred'
  | 'no_pending_copy'
  | 'no_open_request'
  | 'reserve_exists';

export interface ActionAvailability {
  action: CommandAction;
  available: boolean;
  reason: UnavailableReason | null;
}

/**
 * Адресний мінімум для частини (рішення команди 2026-11-14): стан довідки без
 * документних посилань, умовна назва закладу, вид / період / стан виплати без сум.
 */
export interface StaffAddressMinimum {
  certificate: CaseMilestones['certificate'];
  /** Умовна назва закладу без адреси; null, якщо поточний заклад не підтверджено. */
  facility: string | null;
  vlkDecision: CaseMilestones['vlkDecision'];
  finances: {kind: 'reward' | 'ogd'; periodStart: string; status: FinanceStatus}[];
}

/**
 * Службова проєкція: без клінічних полів і документних посилань.
 * Заклад і стан виплат — лише в межах адресного мінімуму.
 */
export interface StaffCaseView extends CaseSummaryView {
  address: StaffAddressMinimum;
  actions: ActionAvailability[];
}

export interface StaffView {
  profile: StaffProfile;
  cases: StaffCaseView[];
  /** Фіксований навчальний резерв без еПМК. */
  reserve: {baseCaseId: string; action: ActionAvailability};
}

/* ───────────── Аналітика ───────────── */

export type MetricState = 'demo' | 'suppressed' | 'insufficient' | 'context';

export interface MetricView {
  id: string;
  title: string;
  value: string;
  detail: string;
  state: MetricState;
  coverage?: string;
  source?: string;
}

export interface AnalyticsView {
  status: string;
  cohort: string;
  asOf: string;
  minimum: number;
  metrics: MetricView[];
}

/* ───────────── Dev-симулятор ───────────── */

export type FixtureGroup = 'd1' | 's1' | 's2' | 's3' | 's4' | 's5' | 's6';

export interface FixtureView {
  id: string;
  title: string;
  group: FixtureGroup;
  source: SourceCode;
}

export type InboxState = 'applied' | 'pending_review';

export interface DevView {
  fixtures: FixtureView[];
  stats: {
    inboxTotal: number;
    pendingReview: number;
    openReviews: number;
    outboxPending: number;
    outboxDelivered: number;
  };
  /** Останні прийняті події: лише тип, джерело й стан обробки. */
  recent: {eventType: string; source: SourceCode; state: InboxState; receivedAt: string}[];
  analyticsSnapshot: AnalyticsSnapshotId;
}

export type AnalyticsSnapshotId = 'demo-cohort-v1' | 'demo-small';
export type SimulatorMode = 'send' | 'repeat' | 'conflict';

/* ───────────── Гайд без входу ───────────── */

export interface GuideView {
  title: string;
  steps: string[];
}

/* ───────────── Запити й відповіді мутацій ───────────── */

export interface CommandRequest {
  /** Ключ ідемпотентності: той самий id — той самий результат без подвійного ефекту. */
  id: string;
  case_id: string;
  action: CommandAction;
  option?: string;
}

export interface CommandResult {
  status: 'recorded';
  case_id: string;
  /** Завжди false: дія в панелі не є підтвердженням джерела. */
  source_confirmed: false;
  duplicate?: true;
}

/**
 * accepted (202) — застосовано; duplicate (200) — уже застосовано, нового ефекту немає;
 * pending_review (202 уперше, 200 при повторній доставці) — збережено, чекає попередника чи звірки;
 * event_conflict (409) — той самий ключ з іншим змістом.
 */
export type IngestStatus = 'accepted' | 'duplicate' | 'pending_review' | 'event_conflict';

export interface IngestResult {
  status: IngestStatus;
  business_applied: boolean;
}

export interface ApiErrorBody {
  error: string;
}
