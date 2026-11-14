import type {DatabaseSync} from 'node:sqlite';
import {SEED_DEFINITION, SEED_ID} from './migrations.js';

/**
 * Вигаданий початковий стан: 30 навчальних кейсів, 3 умовні групи, 9 умовних закладів.
 *
 * Це інженерні fixtures для показу різних стадій і невідомих дат,
 * а не baseline чи відомості про реальних військових.
 * Зміст seed зафіксовано маркером `seed-1`; змінювати його без нової версії не можна.
 */
export const DEMO_AS_OF = '2026-11-13T12:00:00.000Z';

const GRANT_FROM = '2026-01-01T00:00:00.000Z';
const GRANT_TO = '2027-01-01T00:00:00.000Z';
const STAGES = ['care', 'documents', 'vlk', 'service_action', 'finance', 'completed'] as const;
const UNIT_LETTERS = ['А', 'Б', 'В'] as const;

type SeedValue = string | number | null;
type Insert = (table: string, values: Record<string, SeedValue>) => void;

export function seed(db: DatabaseSync): void {
  if (db.prepare('SELECT id FROM seed_snapshot').get()) return;
  const insert: Insert = (table, values) => {
    const names = Object.keys(values);
    const sql = `INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`;
    db.prepare(sql).run(...Object.values(values));
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    seedReferenceData(insert);
    seedStaffRoles(insert);
    seedRules(insert);
    for (let index = 1; index <= 30; index++) seedCase(insert, index);
    seedSupportContext(insert);
    insert('seed_snapshot', {id: SEED_ID, definition_version: SEED_DEFINITION, as_of: DEMO_AS_OF, patient_count: 30});
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function seedReferenceData(insert: Insert): void {
  UNIT_LETTERS.forEach((letter, i) => {
    insert('demo_unit', {id: `demo-unit-${i + 1}`, label: `Навчальна група ${letter}`});
  });
  for (let i = 1; i <= 9; i++) {
    insert('demo_provider', {id: `demo-provider-${i}`, label: `Умовний заклад ${String(i).padStart(2, '0')}`});
  }
}

function seedStaffRoles(insert: Insert): void {
  for (const profile of ['commander', 'support', 'analyst', 'dev']) {
    const scoped = profile === 'commander' || profile === 'support';
    insert('subject', {id: `demo-${profile}`, demo_label: `Навчальна роль ${profile}`, state: 'active'});
    insert('access_grant', {
      id: `demo-grant-${profile}`,
      actor_subject_id: `demo-${profile}`,
      role: profile,
      case_id: null,
      unit_ref: scoped ? 'demo-unit-1' : null,
      purposes: 'demo',
      valid_from: GRANT_FROM,
      valid_to: GRANT_TO,
      revoked_at: null,
      authority_ref: 'demo-authority',
    });
  }
}

function seedRules(insert: Insert): void {
  insert('rule_version', {
    id: 'demo-rule-certificate',
    rule_key: 'certificate-enemy-action',
    version: 'demo-1',
    route: 'certificate',
    applicability: 'enemy_action_only',
    anchor_type: 'servicemember_document_received',
    calendar_unit: 'day',
    interval_value: 5,
    legal_ref: 'N16-art260',
    effective_from: '2026-01-01',
    effective_to: null,
    approval_state: 'demo_fixture',
  });
  insert('rule_version', {
    id: 'demo-rule-checklist',
    rule_key: 'technical-checklist',
    version: 'demo-1',
    route: 'vlk',
    applicability: 'synthetic_packet_only',
    anchor_type: 'packet_snapshot',
    calendar_unit: 'none',
    interval_value: 1,
    legal_ref: 'demo-not-legal-completeness',
    effective_from: '2026-01-01',
    effective_to: null,
    approval_state: 'demo_fixture',
  });
}

function seedCase(insert: Insert, index: number): void {
  const n = String(index).padStart(2, '0');
  const person = `demo-person-${n}`;
  const caseId = `demo-case-${n}`;
  const unit = `demo-unit-${1 + Math.floor((index - 1) / 10)}`;
  const stage = STAGES[(index - 1) % STAGES.length] ?? 'care';
  const dateUnknown = index % 7 === 0;

  insert('subject', {id: person, demo_label: `Навчальний учасник ${n}`, state: 'active'});
  insert('identity_link', {
    id: `demo-link-${n}`,
    subject_id: person,
    source_namespace: 'demo-mis',
    source_subject_token: person,
    verification_state: 'verified',
    proof_ref: `demo-proof-${n}`,
    valid_from: GRANT_FROM,
    valid_to: null,
  });
  insert('unit_assignment', {
    id: `demo-assignment-${n}`,
    subject_id: person,
    unit_ref: unit,
    valid_from: GRANT_FROM,
    valid_to: null,
    source_event_ref: `demo-assignment-proof-${n}`,
    verification_state: 'verified',
  });
  insert('wound_case', {
    id: caseId,
    subject_id: person,
    incident_namespace: 'demo-mis',
    incident_ref: `demo-incident-${n}`,
    origin: 'medical_event',
    injury_date: dateUnknown ? null : '2026-10-20',
    injury_date_assurance: dateUnknown ? 'unknown' : 'confirmed',
    lifecycle_state: stage,
    revision: 1,
  });
  // Лише перший учасник має демо-вхід; супровід інших працює незалежно від входу бійця.
  if (index === 1) {
    insert('access_grant', {
      id: 'demo-grant-patient',
      actor_subject_id: person,
      role: 'patient',
      case_id: caseId,
      unit_ref: null,
      purposes: 'demo',
      valid_from: GRANT_FROM,
      valid_to: GRANT_TO,
      revoked_at: null,
      authority_ref: 'demo-authority',
    });
  }
  insert('treatment_episode', {
    id: `demo-episode-${n}`,
    case_id: caseId,
    source_system: 'demo-mis',
    source_episode_ref: `demo-episode-ref-${n}`,
    provider_ref: `demo-provider-${1 + ((index - 1) % 9)}`,
    start_date: dateUnknown ? null : '2026-10-21',
    end_date: stage === 'completed' ? '2026-11-10' : null,
    evidence_ref: `demo-care-proof-${n}`,
    assurance: dateUnknown ? 'unknown' : 'confirmed',
  });
  seedCertificateClock(insert, {index, n, caseId, unit});
  seedVlkChecklist(insert, {index, n, caseId});
  seedFinance(insert, {index, n, caseId});
  if (index % 4 === 0) {
    insert('review_item', {
      id: `demo-review-${n}`,
      case_id: caseId,
      inbox_event_id: null,
      reason_code: 'packet_returned',
      assigned_scope: unit,
      state: 'open',
      resolution_event_ref: null,
    });
  }
}

interface CaseSeed {index: number; n: string; caseId: string}

/** Три варіанти початку відліку: орієнтир за внесенням еПМК, підтверджене отримання, невідомо. */
function seedCertificateClock(insert: Insert, {index, n, caseId, unit}: CaseSeed & {unit: string}): void {
  const estimated = index % 3 === 1;
  const confirmed = index % 3 === 2;
  insert('case_event', {
    id: `demo-seed-event-${n}`,
    case_id: caseId,
    inbox_event_id: null,
    command_id: null,
    event_type: 'medical.primary_recorded',
    occurred_at: '2026-10-21T09:00:00.000Z',
    recorded_at: estimated ? '2026-11-10T09:05:00.000Z' : '2026-10-21T09:05:00.000Z',
    source_ref: 'demo-mis',
    source_version: 'seed-v1',
    assurance: 'synthetic_seed',
    supersedes_id: null,
  });
  if (confirmed) {
    insert('case_event', {
      id: `demo-receipt-anchor-${n}`,
      case_id: caseId,
      inbox_event_id: null,
      command_id: null,
      event_type: 'document.received',
      occurred_at: '2026-11-01T09:00:00.000Z',
      recorded_at: '2026-11-01T09:05:00.000Z',
      source_ref: 'demo-service',
      source_version: 'seed-v1',
      assurance: 'synthetic_patient_receipt_fixture',
      supersedes_id: null,
    });
  }
  const anchorEvent = confirmed ? `demo-receipt-anchor-${n}` : estimated ? `demo-seed-event-${n}` : null;
  insert('deadline', {
    id: `demo-deadline-${n}`,
    case_id: caseId,
    rule_version_id: 'demo-rule-certificate',
    anchor_event_id: anchorEvent,
    anchor_date: confirmed ? '2026-11-01' : null,
    due_date: confirmed ? '2026-11-06' : null,
    applicability_state: index % 3 === 0 ? 'unknown' : 'applicable',
    anchor_status: estimated ? 'estimated' : confirmed ? 'confirmed' : 'unknown',
    provisional_follow_up_date: estimated ? '2026-11-15' : null,
    status: confirmed ? 'review_needed' : 'clarify',
    calculation_revision: 1,
  });
  insert('task', {
    id: `demo-task-${n}`,
    case_id: caseId,
    kind: confirmed ? 'certificate_status_check' : 'confirm_receipt_date',
    owner_role: 'support',
    owner_scope: unit,
    status: 'open',
    deadline_id: `demo-deadline-${n}`,
    trigger_ref: `demo-seed-trigger-${n}`,
    resolution_code: null,
  });
}

function seedVlkChecklist(insert: Insert, {index, n, caseId}: CaseSeed): void {
  for (const kind of ['primary_medical_card', 'trauma_certificate']) {
    const requirement = `demo-req-${kind}-${n}`;
    const document = `demo-doc-${kind}-${n}`;
    const certificateMissing = kind === 'trauma_certificate' && index % 4 === 1;
    insert('case_requirement', {
      id: requirement,
      case_id: caseId,
      route: 'vlk',
      packet_ref: `demo-packet-${n}`,
      packet_revision: 'v1',
      rule_version_id: 'demo-rule-checklist',
      document_kind: kind,
      instance_scope: `demo-episode-${n}`,
      applicability_state: kind === 'trauma_certificate' && index % 5 === 0 ? 'unknown' : 'applicable',
      status: certificateMissing ? 'missing' : 'present',
    });
    if (certificateMissing) continue;
    const received = index % 4 === 0;
    insert('document_ref', {
      id: document,
      case_id: caseId,
      source_system: kind === 'primary_medical_card' ? 'demo-mis' : 'demo-sedo',
      source_record_ref: `demo-record-${kind}-${n}`,
      document_version: 'v1',
      kind,
      provenance: index % 8 === 0 ? 'manual_demo_copy' : 'source_reference',
      validation_state: 'technical_checked',
      classification: kind === 'primary_medical_card' ? 'clinical_ref' : 'administrative',
      supersedes_id: null,
    });
    insert('requirement_evidence', {
      id: `demo-evidence-${kind}-${n}`,
      case_id: caseId,
      case_requirement_id: requirement,
      document_ref_id: document,
      evaluation_state: 'technical_match',
      evidence_event_ref: `demo-seed-proof-${n}`,
    });
    insert('delivery', {
      id: `demo-delivery-${kind}-${n}`,
      document_ref_id: document,
      recipient_ref: 'demo-vlk',
      delivery_kind: 'electronic',
      sent_at: '2026-11-10T10:00:00.000Z',
      received_at: received ? '2026-11-10T10:05:00.000Z' : null,
      receipt_ref: received ? `demo-receipt-${kind}-${n}` : null,
      state: received ? 'received' : 'sent',
    });
  }
}

function seedFinance(insert: Insert, {index, n, caseId}: CaseSeed): void {
  for (const kind of ['reward', 'ogd']) {
    const returned = kind === 'ogd' && index % 4 === 0;
    insert('financial_track', {
      id: `demo-finance-${kind}-${n}`,
      case_id: caseId,
      payment_kind: kind,
      period_start: '2026-11-01',
      period_end: '2026-11-30',
      current_status: kind === 'reward' ? 'under_review' : returned ? 'returned' : 'unknown',
      reason_code: kind === 'reward' || returned ? 'documents_needed' : 'not_available',
      decision_ref: null,
      execution_ref: null,
      source_version: 'seed-v1',
    });
  }
}

function seedSupportContext(insert: Insert): void {
  insert('support_request', {
    id: 'demo-support-request',
    case_id: 'demo-case-01',
    category: 'next_step',
    owner_scope: 'demo-unit-1',
    state: 'open',
    result_code: null,
    authority_checked: 1,
  });
  insert('staff_capacity', {
    id: 'demo-capacity',
    staff_subject_id: 'demo-support',
    reporting_scope: 'demo-unit-1',
    period: '2026-11',
    fte: 1,
    source_ref: 'demo-capacity-proof',
  });
  insert('work_log', {
    id: 'demo-work-log',
    case_id: 'demo-case-01',
    staff_subject_id: 'demo-support',
    work_date: '2026-11-12',
    minutes: 15,
    activity_code: 'document_coordination',
    source_ref: 'demo-work-proof',
  });
}
