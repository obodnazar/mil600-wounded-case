import type {
  DocumentItemState,
  DocumentItemView,
  DocumentKind,
  DocumentVersionView,
  RouteChecklistView,
  RouteCode,
} from '../../shared/api.js';
import type {Row, Store} from '../db/store.js';
import {RECIPIENT} from '../domain/model.js';

/**
 * Технічні переліки документів за маршрутами (ВЛК, винагорода, ОГД).
 *
 * Перелік показує наявність, версію, походження та доставку. Він не оцінює
 * медичний зміст, не гарантує юридичної повноти й не блокує направлення.
 */
export function documentChecklists(store: Store, caseId: string): RouteChecklistView[] {
  const requirements = store.rows(
    `SELECT r.id,r.route,r.packet_ref,r.packet_revision,r.document_kind,r.applicability_state,
            v.version AS rule_version,p.revision AS current_revision,p.period
       FROM case_requirement r
       JOIN rule_version v ON v.id=r.rule_version_id
       LEFT JOIN route_packet p ON p.case_id=r.case_id AND p.route=r.route AND p.packet_ref=r.packet_ref
      WHERE r.case_id=?
      ORDER BY r.route,r.packet_ref,r.packet_revision,r.document_kind`,
    caseId,
  );
  const lists = new Map<string, RouteChecklistView>();
  for (const requirement of requirements) {
    // Показуємо лише чинну ревізію пакета; попередні лишаються в БД як історія.
    if (requirement.current_revision && requirement.current_revision !== requirement.packet_revision) continue;
    const route = String(requirement.route) as RouteCode;
    const key = `${route}:${String(requirement.packet_ref)}`;
    let list = lists.get(key);
    if (!list) {
      list = {
        route,
        period: requirement.period ? String(requirement.period) : null,
        packetRevision: String(requirement.packet_revision),
        ruleVersion: String(requirement.rule_version),
        items: [],
      };
      lists.set(key, list);
    }
    list.items.push(documentItem(store, caseId, route, requirement));
  }
  return [...lists.values()];
}

function documentItem(store: Store, caseId: string, route: RouteCode, requirement: Row): DocumentItemView {
  const kind = String(requirement.document_kind) as DocumentKind;
  const recipient = route === 'vlk' ? RECIPIENT.vlk : RECIPIENT.finance;
  // Джерельна видана версія має пріоритет над складеною, а та — над навчальною копією.
  const document = store.row(
    `SELECT d.document_version,d.provenance,d.validation_state,d.state,l.state AS delivery_state
       FROM requirement_evidence e
       JOIN document_ref d ON d.id=e.document_ref_id
       LEFT JOIN delivery l ON l.document_ref_id=d.id AND l.recipient_ref=?
      WHERE e.case_requirement_id=? AND d.active=1
      ORDER BY CASE
                 WHEN d.state IN ('issued','corrected','recorded') AND d.source_system!='demo-gallery' THEN 0
                 WHEN d.provenance='manual_demo_copy' THEN 2
                 ELSE 1
               END, d.rowid DESC
      LIMIT 1`,
    recipient, requirement.id,
  );
  return {
    kind,
    state: itemState(String(requirement.applicability_state), document),
    version: document ? String(document.document_version) : null,
    provenance: document ? (document.provenance === 'manual_demo_copy' ? 'manual_demo_copy' : 'source_reference') : null,
    delivery: document?.delivery_state === 'received' ? 'received' : document?.delivery_state === 'sent' ? 'sent' : 'none',
    history: versionHistory(store, caseId, kind),
  };
}

/** Окремі стани для: «є посилання», «копію додано вручну», «джерело підтвердило», «складено». */
function itemState(applicability: string, document: Row | undefined): DocumentItemState {
  if (applicability === 'not_applicable') return 'not_applicable';
  if (applicability === 'unknown') return 'applicability_unknown';
  if (!document) return 'missing';
  if (document.validation_state === 'wrong_kind') return 'wrong_kind';
  if (document.validation_state === 'pending') return 'copy_pending';
  if (document.provenance === 'manual_demo_copy') return 'copy_checked';
  if (document.state === 'prepared') return 'prepared';
  if (document.state === 'issued') return 'issued';
  return 'source_referenced';
}

/** Попередні версії джерельного документа: замінені виправленням або відкликані. */
function versionHistory(store: Store, caseId: string, kind: DocumentKind): DocumentVersionView[] {
  const rows = store.rows(
    `SELECT d.document_version,d.state,
            EXISTS(SELECT 1 FROM document_ref n WHERE n.supersedes_id=d.id) AS superseded
       FROM document_ref d
      WHERE d.case_id=? AND d.kind=? AND d.active=0 AND d.provenance='source_reference'
      ORDER BY d.rowid`,
    caseId, kind,
  );
  const history: DocumentVersionView[] = [];
  for (const row of rows) {
    const state = row.state === 'withdrawn' ? 'withdrawn' : row.superseded === 1 ? 'superseded' : null;
    if (state) history.push({version: String(row.document_version), state});
  }
  return history;
}
