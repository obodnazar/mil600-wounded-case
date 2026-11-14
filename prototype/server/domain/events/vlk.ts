import {ensureRequirements, recordSourceDocument} from '../documents.js';
import {RECIPIENT, ReviewRequired, optionalText, text, type EventContext, type Route} from '../model.js';
import {packetProblem} from '../rules.js';
import {hasPendingRequest, openTask, resolveAwaitedCommand, resolveOpenTasksByTrigger, resolveTasks} from '../tasks.js';

/**
 * Маршрут ВЛК: направлення → прийняття пакета → постанова → виконання.
 * Це чотири різні стани з різними джерелами підтвердження.
 */

const CLARIFY_TRIGGER = 'demo-vlk-decision-clarify:';

/**
 * Джерело підтвердило направлення. Без ще не підтвердженого запиту належного командира
 * воно не приймається: один запит — одне підтвердження.
 */
export function applyReferralIssued({store, event, payload, caseId, caseEventId}: EventContext): void {
  const requested = hasPendingRequest(store, caseId, 'refer_vlk');
  if (payload.issuer_ref !== 'demo-commander' || !requested) throw new ReviewRequired('referral_needs_command');
  resolveAwaitedCommand(store, caseId, 'command.refer_vlk');
  recordSourceDocument(store, {
    caseId,
    source: event.source_system,
    recordRef: text(payload, 'document_ref'),
    version: text(payload, 'document_version'),
    kind: 'referral',
    state: 'issued',
  });
  store.run("UPDATE wound_case SET lifecycle_state='vlk' WHERE id=?", caseId);
  openTask(store, caseId, 'await_vlk_receipt', 'support', `demo-vlk-receipt:${caseId}`, caseEventId);
}

/**
 * Адресат (ВЛК або фінансовий орган) отримав пакет чи повернув його авторові.
 * Нова ревізія мусить посилатися на попередню; період пакета не змінюється.
 * Повернення адресується автору документа й не є виконаною службовою дією.
 */
export function applyPackageSignal({store, event, payload, caseId, caseEventId}: EventContext): void {
  const route = routeOf(event.source_system, payload);
  const packet = text(payload, 'packet_ref');
  const revision = text(payload, 'packet_revision');
  const returned = event.event_type.endsWith('returned');
  const prior = store.row(
    'SELECT revision,period FROM route_packet WHERE case_id=? AND route=? AND packet_ref=?',
    caseId, route, packet,
  );
  const problem = packetProblem(
    prior ? {revision: String(prior.revision), period: prior.period ? String(prior.period) : null} : null,
    {
      returned,
      revision,
      period: optionalText(payload, 'period'),
      supersedesRevision: optionalText(payload, 'supersedes_revision'),
      recipientRef: text(payload, 'recipient_ref'),
      expectedRecipient: route === 'vlk' ? RECIPIENT.vlk : RECIPIENT.finance,
    },
  );
  if (problem) throw new ReviewRequired(problem);
  store.run(
    `INSERT INTO route_packet(case_id,route,packet_ref,revision,received_at,reason,state,period)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(case_id,route,packet_ref) DO UPDATE SET
       revision=excluded.revision,
       received_at=COALESCE(route_packet.received_at,excluded.received_at),
       reason=excluded.reason,
       state=excluded.state`,
    caseId, route, packet, revision, text(payload, 'confirmed_at'),
    text(payload, 'reason_code') || 'received', returned ? 'returned' : 'received',
    optionalText(payload, 'period'),
  );
  ensureRequirements(store, caseId, route, packet, revision);
  if (route === 'vlk' && !returned) resolveTasks(store, caseId, 'await_vlk_receipt', 'packet_received');
  if (returned) {
    openTask(store, caseId, 'clarify_author', 'support', `demo-return:${route}:${packet}:${revision}`, caseEventId);
  }
}

function routeOf(source: string, payload: Record<string, unknown>): Route {
  if (source === 'demo-vlk') return 'vlk';
  const kind = text(payload, 'kind');
  if (kind !== 'reward' && kind !== 'ogd') throw new ReviewRequired('unknown_finance_route');
  return kind;
}

/**
 * Постанову ВЛК оформлено — це ще не виконання. Чинною є лише остання постанова:
 * запит на уточнення скасовує відкриту дію за попередньою позитивною постановою;
 * нова позитивна постанова закриває уточнення та дію за попередньою постановою
 * й відкриває рівно одну нову дію.
 */
export function applyVlkDecision({store, event, payload, caseId, caseEventId}: EventContext): void {
  const accepted = store.exists(
    "SELECT packet_ref FROM route_packet WHERE case_id=? AND route='vlk' AND state='received'",
    caseId,
  );
  if (!accepted) throw new ReviewRequired('decision_without_packet_receipt');
  recordSourceDocument(store, {
    caseId,
    source: event.source_system,
    recordRef: text(payload, 'document_ref'),
    version: text(payload, 'document_version'),
    kind: 'vlk_decision',
    state: 'recorded',
  });
  if (payload.service_code === 'clarification_needed') {
    resolveOpenTasksByTrigger(store, caseId, 'next_service_action', '%', 'superseded_by_clarification');
    store.run("UPDATE wound_case SET lifecycle_state='vlk' WHERE id=?", caseId);
    openTask(store, caseId, 'clarify_author', 'support', `${CLARIFY_TRIGGER}${event.event_id}`, caseEventId);
    return;
  }
  resolveOpenTasksByTrigger(store, caseId, 'clarify_author', `${CLARIFY_TRIGGER}%`, 'current_decision_confirmed');
  resolveOpenTasksByTrigger(store, caseId, 'next_service_action', '%', 'superseded_by_new_decision');
  store.run("UPDATE wound_case SET lifecycle_state='service_action' WHERE id=?", caseId);
  openTask(store, caseId, 'next_service_action', 'commander', `demo-service-action:${caseEventId}`, caseEventId);
}

/**
 * Виконання адміністративної дії приймається лише за чинною позитивною постановою:
 * якщо останнє слово ВЛК — запит на уточнення, стара постанова вже не є підставою.
 * Виконання, датоване раніше за чинну постанову, не може бути її виконанням —
 * таке підтвердження стосується попередньої постанови й іде на розбір.
 */
export function applyServiceActionConfirmed({store, event, caseId}: EventContext): void {
  const latest = store.row(
    `SELECT minimal_payload,occurred_at FROM case_event
      WHERE case_id=? AND event_type='vlk.decision_recorded'
      ORDER BY rowid DESC LIMIT 1`,
    caseId,
  );
  const current = latest ? JSON.parse(String(latest.minimal_payload)).service_code : undefined;
  if (current !== 'next_service_action') throw new ReviewRequired('service_without_current_decision');
  if (latest?.occurred_at && Date.parse(event.occurred_at) < Date.parse(String(latest.occurred_at))) {
    throw new ReviewRequired('service_before_current_decision');
  }
  resolveTasks(store, caseId, 'next_service_action', 'source_execution_confirmed');
}
