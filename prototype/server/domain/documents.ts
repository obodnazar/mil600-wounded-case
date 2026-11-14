import type {DocumentKind} from '../../shared/api.js';
import type {Store} from '../db/store.js';
import {ReviewRequired, RULE, newId, type Route} from './model.js';

/**
 * Мінімальні технічні переліки маршрутів навчального прототипу.
 * Вони показують правила та версії, але не є юридичною повнотою пакета
 * й не оцінюють медичний зміст.
 */
const ROUTE_DOCUMENTS: Record<Route, readonly DocumentKind[]> = {
  vlk: ['primary_medical_card', 'trauma_certificate'],
  reward: ['primary_medical_card', 'trauma_certificate'],
  ogd: ['trauma_certificate', 'vlk_decision'],
};

const CLINICAL_KINDS: ReadonlySet<string> = new Set([
  'primary_medical_card',
  'medical_summary',
  'hospital_stay_certificate',
  'vlk_decision',
]);

const ruleFor = (route: Route): string => (route === 'vlk' ? RULE.vlkChecklist : `demo-rule-${route}`);

/** Створює рядки переліку для ревізії пакета, якщо їх ще немає, і підв’язує чинні документи. */
export function ensureRequirements(store: Store, caseId: string, route: Route, packet: string, revision = 'v1'): void {
  for (const kind of ROUTE_DOCUMENTS[route]) {
    const present = store.exists(
      `SELECT id FROM case_requirement
        WHERE case_id=? AND route=? AND packet_ref=? AND packet_revision=? AND document_kind=?`,
      caseId, route, packet, revision, kind,
    );
    if (present) continue;
    const requirementId = newId();
    store.insert('case_requirement', {
      id: requirementId,
      case_id: caseId,
      route,
      packet_ref: packet,
      packet_revision: revision,
      rule_version_id: ruleFor(route),
      document_kind: kind,
      instance_scope: 'demo-case',
      applicability_state: 'applicable',
      status: 'missing',
    });
    const active = store.rows('SELECT id FROM document_ref WHERE case_id=? AND kind=? AND active=1', caseId, kind);
    for (const document of active) {
      linkEvidence(store, caseId, requirementId, String(document.id), 'demo-existing-document');
    }
  }
}

function linkEvidence(store: Store, caseId: string, requirementId: string, documentId: string, proof: string): void {
  store.run(
    'INSERT OR IGNORE INTO requirement_evidence VALUES (?,?,?,?,?,?)',
    newId(), caseId, requirementId, documentId, 'technical_match', proof,
  );
}

/** Підв’язує документ до всіх рядків переліків кейсу, які очікують цей вид. */
export function attachEvidence(store: Store, caseId: string, documentId: string, kind: string, proof: string): void {
  const requirements = store.rows('SELECT id FROM case_requirement WHERE case_id=? AND document_kind=?', caseId, kind);
  for (const requirement of requirements) linkEvidence(store, caseId, String(requirement.id), documentId, proof);
}

export interface SourceDocument {
  caseId: string;
  source: string;
  recordRef: string;
  version: string;
  kind: string;
  state: 'recorded' | 'prepared' | 'issued' | 'corrected';
  /** Запис попередньої версії, яку замінює ця. */
  supersedesId?: string | null;
}

/**
 * Реєструє посилання на версію документа від джерела.
 * Та сама версія лише змінює стан уперед; зміна виду, повернення з «видано»
 * до «складено» чи робота з неактивною версією йдуть на розбір.
 */
export function recordSourceDocument(store: Store, document: SourceDocument): string {
  const existing = store.row(
    `SELECT id,kind,active,state FROM document_ref
      WHERE case_id=? AND source_system=? AND source_record_ref=? AND document_version=?`,
    document.caseId, document.source, document.recordRef, document.version,
  );
  if (existing) {
    const regressed = ['issued', 'corrected'].includes(String(existing.state)) && document.state === 'prepared';
    if (existing.kind !== document.kind || existing.active !== 1 || regressed) {
      throw new ReviewRequired('document_regression_or_kind_mismatch');
    }
    store.run('UPDATE document_ref SET state=? WHERE id=?', document.state, existing.id);
    return String(existing.id);
  }
  const id = newId();
  store.insert('document_ref', {
    id,
    case_id: document.caseId,
    source_system: document.source,
    source_record_ref: document.recordRef,
    document_version: document.version,
    kind: document.kind,
    provenance: 'source_reference',
    validation_state: 'source_confirmed',
    classification: CLINICAL_KINDS.has(document.kind) ? 'clinical_ref' : 'administrative',
    supersedes_id: document.supersedesId ?? null,
    state: document.state,
    active: 1,
  });
  attachEvidence(store, document.caseId, id, document.kind, 'demo-source-document');
  return id;
}

/** Чинна довідка про обставини травми, видачу якої підтвердило джерело. */
export function hasIssuedCertificate(store: Store, caseId: string): boolean {
  return store.exists(
    `SELECT id FROM document_ref
      WHERE case_id=? AND kind='trauma_certificate' AND active=1
        AND state IN ('issued','corrected') AND provenance='source_reference'`,
    caseId,
  );
}

/**
 * Чинна позитивна постанова ВЛК: остання оформлена постанова не є запитом на уточнення.
 * Без неї ОГД не розглядається (ADR 0011).
 */
export function hasCurrentVlkDecision(store: Store, caseId: string): boolean {
  return currentVlkDecisionAt(store, caseId) !== null;
}

/** Момент чинної позитивної постанови ВЛК (мс) або null, якщо її немає чи останнє слово ВЛК — уточнення. */
export function currentVlkDecisionAt(store: Store, caseId: string): number | null {
  const latest = store.row(
    `SELECT json_extract(minimal_payload,'$.service_code') AS code,occurred_at FROM case_event
      WHERE case_id=? AND event_type='vlk.decision_recorded' ORDER BY rowid DESC LIMIT 1`,
    caseId,
  );
  if (!latest || latest.code === 'clarification_needed') return null;
  const at = Date.parse(String(latest.occurred_at));
  return Number.isFinite(at) ? at : null;
}

/**
 * ОГД розглядається лише після чинної постанови ВЛК (ADR 0011): подія ОГД без постанови або
 * датована раніше за неї (затримана чи повторна доставка) не застосовується — вона йде на розбір.
 */
export function assertOgdAfterDecision(store: Store, caseId: string, eventTimes: readonly string[]): void {
  const decidedAt = currentVlkDecisionAt(store, caseId);
  const earlier = eventTimes.some(time => Date.parse(time) < (decidedAt ?? Infinity));
  if (decidedAt === null || earlier) throw new ReviewRequired('ogd_before_vlk_decision');
}

/** Довідку склала медслужба, але видачу ще не підтверджено. */
export function hasPreparedCertificate(store: Store, caseId: string): boolean {
  return store.exists(
    `SELECT id FROM document_ref
      WHERE case_id=? AND kind='trauma_certificate' AND active=1
        AND state='prepared' AND source_system='demo-mis'`,
    caseId,
  );
}
