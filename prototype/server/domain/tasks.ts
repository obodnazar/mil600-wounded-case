import type {OwnerRole, TaskKind} from '../../shared/api.js';
import type {Store} from '../db/store.js';
import {newId} from './model.js';

const UNASSIGNED_SCOPE = 'demo-source-review';

/** Чинна перевірена область (навчальна група) особи кейсу або черга розбору джерел. */
export function ownerScope(store: Store, caseId: string): string {
  const assignment = store.row(
    `SELECT u.unit_ref FROM wound_case c
       JOIN unit_assignment u ON u.subject_id=c.subject_id
      WHERE c.id=? AND u.verification_state='verified' AND u.valid_to IS NULL`,
    caseId,
  );
  return assignment ? String(assignment.unit_ref) : UNASSIGNED_SCOPE;
}

/**
 * Відкриває адресну задачу людині. Той самий тригер не створює другої задачі:
 * повтор події чи команди лишає одну задачу (у тому числі вже закриту).
 */
export function openTask(
  store: Store, caseId: string, kind: TaskKind, owner: OwnerRole, trigger: string, openedByEvent: string | null = null,
): void {
  // Унікальність у схемі включає область; після переведення особи той самий тригер
  // не має відкривати другу задачу в новій області.
  const known = store.exists(
    'SELECT id FROM task WHERE case_id=? AND trigger_ref=? AND kind=? AND owner_role=?',
    caseId, trigger, kind, owner,
  );
  if (known) return;
  store.run(
    `INSERT OR IGNORE INTO task(id,case_id,kind,owner_role,owner_scope,status,trigger_ref,opened_by_event)
     VALUES (?,?,?,?,?,'open',?,?)`,
    newId(), caseId, kind, owner, ownerScope(store, caseId), trigger, openedByEvent,
  );
}

/**
 * Відкриває задачу знову, якщо така сама вже була закрита: для сигналів, що можуть
 * повторюватися (новий невідомий стан після рішення), задача має бути видимою щоразу.
 */
export function openOrReopenTask(
  store: Store, caseId: string, kind: TaskKind, owner: OwnerRole, trigger: string, openedByEvent: string,
): void {
  store.run(
    `UPDATE task SET status='open',resolution_code=NULL,opened_by_event=?
      WHERE case_id=? AND trigger_ref=? AND kind=? AND owner_role=? AND status='resolved'`,
    openedByEvent, caseId, trigger, kind, owner,
  );
  openTask(store, caseId, kind, owner, trigger, openedByEvent);
}

/** Закриває відкриті задачі цього виду в кейсі з кодом результату. */
export function resolveTasks(store: Store, caseId: string, kind: TaskKind, resolution: string): void {
  store.run(
    "UPDATE task SET status='resolved',resolution_code=? WHERE case_id=? AND kind=? AND status='open'",
    resolution, caseId, kind,
  );
}

/** Запит командира подано, а джерело його ще не підтвердило. */
export function hasPendingRequest(store: Store, caseId: string, action: 'issue_certificate' | 'refer_vlk'): boolean {
  return pendingRequestAt(store, caseId, action) !== null;
}

/** Коли записано ще не підтверджений запит командира (ISO) або null, якщо такого запиту немає. */
export function pendingRequestAt(store: Store, caseId: string, action: 'issue_certificate' | 'refer_vlk'): string | null {
  const request = store.row(
    `SELECT e.recorded_at FROM task t
       JOIN case_event e ON e.command_id=t.trigger_ref AND e.case_id=t.case_id
      WHERE t.case_id=? AND t.kind='await_source_confirmation' AND t.status='open' AND e.event_type=?
      ORDER BY e.rowid DESC LIMIT 1`,
    caseId, `command.${action}`,
  );
  return request ? String(request.recorded_at) : null;
}

/** Закриває лише відкриті задачі виду з певним тригером або префіксом тригера. */
export function resolveOpenTasksByTrigger(
  store: Store, caseId: string, kind: TaskKind, triggerPattern: string, resolution: string,
): void {
  store.run(
    `UPDATE task SET status='resolved',resolution_code=?
      WHERE case_id=? AND kind=? AND status='open' AND trigger_ref LIKE ?`,
    resolution, caseId, kind, triggerPattern,
  );
}

/** Задача очікування підтвердження джерела для запиту командира певного типу. */
export function resolveAwaitedCommand(store: Store, caseId: string, commandEventType: string): void {
  store.run(
    `UPDATE task SET status='resolved',resolution_code='source_confirmation'
      WHERE case_id=? AND kind='await_source_confirmation'
        AND status='open'
        AND trigger_ref IN (SELECT command_id FROM case_event WHERE case_id=? AND event_type=?)`,
    caseId, caseId, commandEventType,
  );
}

export function hasOpenTask(store: Store, caseId: string, kind: TaskKind): boolean {
  return store.exists("SELECT id FROM task WHERE case_id=? AND kind=? AND status='open'", caseId, kind);
}
