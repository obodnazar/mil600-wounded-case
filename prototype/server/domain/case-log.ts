import type {Store} from '../db/store.js';
import {isoTime, newId, type Payload} from './model.js';

export interface CaseEventInput {
  caseId: string;
  type: string;
  payload: Payload;
  now: number;
  /** Для джерельної події — запис inbox; для дії користувача — null. */
  inboxId?: string | null;
  source?: string;
  version?: string;
  occurredAt?: string | null;
  commandId?: string | null;
}

/** Додає запис у незмінний журнал кейсу (append-only на рівні тригерів БД). */
export function appendCaseEvent(store: Store, input: CaseEventInput): string {
  const id = newId();
  const inboxId = input.inboxId ?? null;
  store.insert('case_event', {
    id,
    case_id: input.caseId,
    inbox_event_id: inboxId,
    command_id: input.commandId ?? null,
    event_type: input.type,
    occurred_at: input.occurredAt ?? null,
    recorded_at: isoTime(input.now),
    source_ref: input.source ?? 'demo-user',
    source_version: input.version ?? 'command',
    assurance: inboxId ? 'simulated_source' : 'demo_command',
    minimal_payload: JSON.stringify(input.payload),
  });
  return id;
}

/**
 * Ставить локальне повідомлення про оновлення проєкції в outbox тієї самої транзакції.
 * Ключ ідемпотентності унікальний, тож повтор не створює другого повідомлення.
 */
export function enqueueProjection(store: Store, caseId: string, caseEventId: string, idempotencyKey: string): void {
  store.insert('outbox', {
    id: newId(),
    case_event_id: caseEventId,
    action_type: 'project_case',
    destination_ref: 'demo-local-projection',
    idempotency_key: idempotencyKey,
    minimal_payload: JSON.stringify({case_id: caseId}),
    attempt_count: 0,
    next_attempt_at: null,
    state: 'pending',
  });
}
