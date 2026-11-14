import {Denied} from '../../security/core.js';
import type {
  AnchorStatus,
  Applicability,
  CareDeadlineView,
  CaseMilestones,
  CaseOrigin,
  CaseSummaryView,
  CertificateDeadlineView,
  FinanceStatus,
  FinanceTrackView,
  Freshness,
  OwnerRole,
  PatientCaseView,
  ReviewView,
  SourceCode,
  StageCode,
  SupportRequestCategory,
  SupportRequestView,
  TaskKind,
  TaskView,
  TimelineCategory,
  TimelineEntryView,
  TimelineFollowUp,
} from '../../shared/api.js';
import type {Row, Store} from '../db/store.js';
import {hasIssuedCertificate, hasPreparedCertificate} from '../domain/documents.js';
import {RULE} from '../domain/model.js';
import {hasOpenTask, hasPendingRequest} from '../domain/tasks.js';
import {documentChecklists} from './documents-view.js';

const TIMELINE_LIMIT = 200;

/**
 * Проєкції кейсу для панелей. Кожна роль отримує власний DTO, зібраний явно:
 * нове поле в БД не потрапить у відповідь автоматично.
 */

/* ───────────── Спільна частина: стадія, задачі, розбори, звернення, строк довідки ───────────── */

interface SummaryOptions {
  /** Службова панель бачить нерозподілені розбори своєї області й може їх підтверджувати. */
  staff: boolean;
}

export function caseSummary(store: Store, caseId: string, {staff}: SummaryOptions): CaseSummaryView {
  const item = store.row(
    `SELECT c.id,c.lifecycle_state,c.origin,c.source_linked,c.freshness_state,c.last_source_at,s.demo_label
       FROM wound_case c JOIN subject s ON s.id=c.subject_id WHERE c.id=?`,
    caseId,
  );
  if (!item) throw new Denied(404, 'not_found');
  return {
    id: caseId,
    label: String(item.demo_label),
    stage: String(item.lifecycle_state) as StageCode,
    origin: String(item.origin) as CaseOrigin,
    sourceLinked: item.source_linked === 1,
    freshness: String(item.freshness_state) as Freshness,
    lastSourceAt: item.last_source_at ? String(item.last_source_at) : null,
    tasks: openTasks(store, caseId),
    reviews: openReviews(store, caseId, staff),
    requests: supportRequests(store, caseId),
    certificateDeadline: certificateDeadline(store, caseId),
  };
}

function openTasks(store: Store, caseId: string): TaskView[] {
  const rows = store.rows(
    `SELECT t.id,t.kind,t.owner_role,
            (SELECT e.event_type FROM case_event e
              WHERE e.case_id=t.case_id AND e.command_id=t.trigger_ref LIMIT 1) AS command_type,
            EXISTS(SELECT 1 FROM demo_command d WHERE d.id=t.trigger_ref) AS from_command
       FROM task t WHERE t.case_id=? AND t.status='open' ORDER BY t.rowid`,
    caseId,
  );
  return rows.map(task => {
    const kind = String(task.kind) as TaskKind;
    return {
      id: String(task.id),
      kind,
      ownerRole: String(task.owner_role) as OwnerRole,
      awaits: kind === 'await_source_confirmation' ? awaitedAction(task.command_type) : null,
      manual: task.from_command === 1 && (kind === 'clarify_author' || kind === 'reconcile_missing_event'),
    };
  });
}

function awaitedAction(commandType: unknown): TaskView['awaits'] {
  if (commandType === 'command.issue_certificate') return 'issue_certificate';
  if (commandType === 'command.refer_vlk') return 'refer_vlk';
  return null;
}

function openReviews(store: Store, caseId: string, staff: boolean): ReviewView[] {
  const rows = store.rows(
    `SELECT id,reason_code FROM review_item
      WHERE state='open' AND (
        case_id=?
        OR (case_id IS NULL AND ?=1 AND assigned_scope IN (
              SELECT u.unit_ref FROM unit_assignment u JOIN wound_case c ON c.subject_id=u.subject_id
               WHERE c.id=? AND u.verification_state='verified' AND u.valid_to IS NULL)))
      ORDER BY rowid`,
    caseId, staff ? 1 : 0, caseId,
  );
  return rows.map(review => {
    const uncertainCase = review.reason_code === 'missing_incident';
    return {
      id: String(review.id),
      reason: String(review.reason_code),
      resolvable: staff && uncertainCase,
      closable: staff && !uncertainCase,
    };
  });
}

function supportRequests(store: Store, caseId: string): SupportRequestView[] {
  return store
    .rows('SELECT id,category,state FROM support_request WHERE case_id=? ORDER BY rowid', caseId)
    .map(request => ({
      id: String(request.id),
      category: String(request.category) as SupportRequestCategory,
      state: request.state === 'open' ? 'open' : 'resolved',
    }));
}

function certificateDeadline(store: Store, caseId: string): CertificateDeadlineView {
  const deadline = store.row(
    `SELECT id,applicability_state,anchor_status,anchor_date,due_date,provisional_follow_up_date
       FROM deadline WHERE case_id=? AND rule_version_id=?`,
    caseId, RULE.certificate,
  );
  if (!deadline) {
    return {
      applicability: 'unknown',
      anchorStatus: 'unknown',
      anchorDate: null,
      dueDate: null,
      followUpDate: null,
      reviewOpen: false,
    };
  }
  const reviewOpen = store.exists(
    "SELECT id FROM task WHERE case_id=? AND kind='review_deadline' AND status='open' AND trigger_ref LIKE ?",
    caseId, `demo-deadline:${String(deadline.id)}:%`,
  );
  return {
    applicability: String(deadline.applicability_state) as Applicability,
    anchorStatus: String(deadline.anchor_status) as AnchorStatus,
    anchorDate: nullableText(deadline.anchor_date),
    dueDate: nullableText(deadline.due_date),
    followUpDate: nullableText(deadline.provisional_follow_up_date),
    reviewOpen,
  };
}

const nullableText = (value: unknown): string | null => (value ? String(value) : null);

/* ───────────── Проєкція військовослужбовця ───────────── */

/** Власний кейс: документи, заклад, строки, виплати й журнал. Лише для ролі бійця. */
export function patientCaseView(store: Store, caseId: string): PatientCaseView {
  const summary = caseSummary(store, caseId, {staff: false});
  const timeline = timelineOf(store, caseId);
  return {
    ...summary,
    milestones: milestones(store, caseId),
    care: {facility: currentFacility(store, caseId), deadline: careDeadline(store, caseId)},
    documents: documentChecklists(store, caseId),
    finances: financeTracks(store, caseId),
    timeline: timeline.entries,
    timelineTotal: timeline.total,
  };
}

/** Віхи маршруту з підтверджених записів БД, а не з обмеженого журналу подій. */
export function milestones(store: Store, caseId: string): CaseMilestones {
  const referralIssued = store.exists(
    "SELECT id FROM document_ref WHERE case_id=? AND kind='referral' AND active=1 AND state IN ('issued','corrected')",
    caseId,
  );
  const packet = store.row("SELECT state FROM route_packet WHERE case_id=? AND route='vlk'", caseId);
  const decision = store.row(
    `SELECT json_extract(minimal_payload,'$.service_code') AS service_code FROM case_event
      WHERE case_id=? AND event_type='vlk.decision_recorded' ORDER BY rowid DESC LIMIT 1`,
    caseId,
  );
  const executed = store.exists(
    `SELECT id FROM task
      WHERE case_id=? AND kind='next_service_action' AND status='resolved'
        AND resolution_code='source_execution_confirmed'`,
    caseId,
  );
  const actionAwaited = hasOpenTask(store, caseId, 'next_service_action');
  return {
    certificate: hasIssuedCertificate(store, caseId)
      ? 'issued'
      : hasPendingRequest(store, caseId, 'issue_certificate')
        ? 'requested'
        : hasPreparedCertificate(store, caseId) ? 'prepared' : 'none',
    referral: referralIssued ? 'issued' : hasPendingRequest(store, caseId, 'refer_vlk') ? 'requested' : 'none',
    vlkPacket: packet ? (packet.state === 'returned' ? 'returned' : 'received') : 'none',
    vlkDecision: !decision ? 'none' : decision.service_code === 'clarification_needed' ? 'clarification_needed' : 'recorded',
    // За чинного запиту ВЛК на уточнення попереднє виконання вже не є виконанням чинної постанови.
    serviceAction: actionAwaited ? 'awaited' : executed && decision?.service_code !== 'clarification_needed' ? 'confirmed' : 'none',
  };
}

/**
 * Поточний заклад — лише підтверджений відкритий епізод. Після виписки чи без
 * підтвердження наступний заклад не вигадується.
 */
export function currentFacility(store: Store, caseId: string): string | null {
  const item = store.row('SELECT current_episode,last_source_at FROM wound_case WHERE id=?', caseId);
  if (!item) return null;
  if (item.current_episode) {
    const provider = store.row(
      `SELECT p.label FROM treatment_episode e JOIN demo_provider p ON p.id=e.provider_ref
        WHERE e.case_id=? AND e.source_episode_ref=? AND e.end_date IS NULL`,
      caseId, item.current_episode,
    );
    return provider ? String(provider.label) : null;
  }
  // Після будь-якої джерельної події покладаємося тільки на поточний епізод від джерела.
  if (item.last_source_at) return null;
  const seeded = store.row(
    `SELECT p.label FROM treatment_episode e JOIN demo_provider p ON p.id=e.provider_ref
      WHERE e.case_id=? AND e.end_date IS NULL ORDER BY e.start_date DESC LIMIT 1`,
    caseId,
  );
  return seeded ? String(seeded.label) : null;
}

function careDeadline(store: Store, caseId: string): CareDeadlineView {
  const deadline = store.row(
    'SELECT anchor_date,due_date,applicability_state FROM deadline WHERE case_id=? AND rule_version_id=?',
    caseId, RULE.care,
  );
  return {
    applicability: deadline ? (String(deadline.applicability_state) as Applicability) : 'unknown',
    startDate: nullableText(deadline?.anchor_date),
    dueDate: nullableText(deadline?.due_date),
  };
}

export function financeTracks(store: Store, caseId: string): FinanceTrackView[] {
  const rows = store.rows('SELECT * FROM financial_track WHERE case_id=? ORDER BY payment_kind,period_start', caseId);
  return rows.map(track => {
    const kind = track.payment_kind === 'reward' ? 'reward' : 'ogd';
    const period = String(track.period_start).slice(0, 7);
    const clarificationOpen = store.exists(
      `SELECT id FROM task
        WHERE case_id=? AND kind='clarify_finance' AND status='open'
          AND (trigger_ref LIKE ? OR trigger_ref=?)`,
      caseId, `demo-finance:${kind}:${period}:%`, `demo-finance-unknown:${kind}:${period}`,
    );
    return {
      kind,
      periodStart: String(track.period_start),
      periodEnd: String(track.period_end),
      status: String(track.current_status) as FinanceStatus,
      reason: String(track.reason_code),
      decisionConfirmed: Boolean(track.decision_ref),
      executionConfirmed: Boolean(track.execution_ref),
      source: track.source_system ? sourceCode(String(track.source_system)) : 'seed',
      clarificationOpen,
    };
  });
}

/* ───────────── Журнал подій ───────────── */

const SOURCE_CODES: Readonly<Record<string, SourceCode>> = {
  'demo-mis': 'medical',
  'demo-civil-mis': 'civil_medical',
  'demo-sedo': 'documents',
  'demo-vlk': 'vlk',
  'demo-finance': 'finance',
  'demo-service': 'service',
  'demo-user': 'user',
};

/** Технічний ключ джерела не залишає сервер: у відповіді лише узагальнений код. */
export function sourceCode(sourceRef: string): SourceCode {
  return SOURCE_CODES[sourceRef] ?? 'seed';
}

const COMMAND_CATEGORIES: Readonly<Record<string, TimelineCategory>> = {
  'command.issue_certificate': 'documents',
  'command.copy': 'documents',
  'command.verify_copy': 'documents',
  'command.refer_vlk': 'vlk',
  'command.gap': 'sync',
  'command.resolve_review': 'sync',
  'command.close_review': 'sync',
};

export function timelineCategory(type: string): TimelineCategory {
  if (type.startsWith('command.')) return COMMAND_CATEGORIES[type] ?? 'requests';
  if (type.startsWith('medical.') || type.startsWith('care.')) return 'medical';
  if (type.startsWith('document.')) return 'documents';
  if (type.startsWith('finance.')) return 'finance';
  if (type.startsWith('source.')) return 'sync';
  return 'vlk';
}

function timelineOf(store: Store, caseId: string): {entries: TimelineEntryView[]; total: number} {
  const rows = store.rows(
    `SELECT e.id,e.event_type,e.occurred_at,e.recorded_at,e.source_ref,e.assurance,
            json_extract(i.minimal_envelope,'$.recorded_at') AS source_recorded_at
       FROM case_event e LEFT JOIN inbox_event i ON i.id=e.inbox_event_id
      WHERE e.case_id=? ORDER BY e.recorded_at DESC,e.rowid DESC LIMIT ?`,
    caseId, TIMELINE_LIMIT,
  );
  const followUps = followUpsByEvent(store, caseId);
  return {
    entries: rows.map(event => timelineEntry(event, followUps.get(String(event.id)) ?? [])),
    total: store.count('SELECT COUNT(*) AS n FROM case_event WHERE case_id=?', caseId),
  };
}

/** Задачі, згруповані за подією, яка їх відкрила: власник і стан наступної дії — з БД. */
function followUpsByEvent(store: Store, caseId: string): Map<string, TimelineFollowUp[]> {
  const tasks = store.rows(
    `SELECT opened_by_event,kind,owner_role,status FROM task
      WHERE case_id=? AND opened_by_event IS NOT NULL ORDER BY rowid`,
    caseId,
  );
  const grouped = new Map<string, TimelineFollowUp[]>();
  for (const task of tasks) {
    const eventId = String(task.opened_by_event);
    const list = grouped.get(eventId) ?? [];
    list.push({
      kind: String(task.kind) as TaskKind,
      ownerRole: String(task.owner_role) as OwnerRole,
      open: task.status === 'open',
    });
    grouped.set(eventId, list);
  }
  return grouped;
}

function timelineEntry(event: Row, followUps: TimelineFollowUp[]): TimelineEntryView {
  const type = String(event.event_type);
  const assurance = String(event.assurance);
  const seeded = assurance.startsWith('synthetic');
  return {
    id: String(event.id),
    type,
    category: timelineCategory(type),
    occurredAt: nullableText(event.occurred_at),
    sourceRecordedAt: nullableText(event.source_recorded_at),
    recordedAt: String(event.recorded_at),
    source: seeded ? 'seed' : sourceCode(String(event.source_ref)),
    assurance: seeded ? 'synthetic_seed' : assurance === 'demo_command' ? 'demo_command' : 'simulated_source',
    followUps,
  };
}
