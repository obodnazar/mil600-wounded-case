import type {
  AnalyticsSnapshotId,
  AnalyticsView,
  CommandRequest,
  CommandResult,
  DemoProfile,
  DevView,
  GuideView,
  IngestResult,
  IngestStatus,
  PatientCaseView,
  SessionView,
  SimulatorMode,
  StaffView,
} from '../../shared/api';

/** Сервер відповів, але відмовив: код помилки з тіла `{error}` і HTTP-статус. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Секунди із заголовка Retry-After або null. */
  readonly retryAfter: number | null;

  constructor(status: number, code: string, retryAfter: number | null) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** Відповіді не було взагалі: невідомо, чи сервер отримав запит. */
export class NetworkError extends Error {
  constructor() {
    super('network_failure');
    this.name = 'NetworkError';
  }
}

const INGEST_STATUSES: readonly IngestStatus[] = ['accepted', 'duplicate', 'pending_review', 'event_conflict'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isIngestResult(value: unknown): value is IngestResult {
  return isRecord(value) && INGEST_STATUSES.some(status => status === value.status);
}

function errorCode(body: unknown): string {
  return isRecord(body) && typeof body.error === 'string' ? body.error : 'unknown_error';
}

function retryAfterSeconds(response: Response): number | null {
  const seconds = Number(response.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, {credentials: 'same-origin', ...init});
  } catch {
    throw new NetworkError();
  }
}

async function readBody(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    return null;
  }
}

function fail(response: Response, body: unknown): never {
  throw new ApiError(response.status, errorCode(body), retryAfterSeconds(response));
}

async function parse<T>(response: Response): Promise<T> {
  const body = await readBody(response);
  if (!response.ok) fail(response, body);
  if (body === null) throw new ApiError(response.status, 'invalid_response', null);
  // Same-origin контракт shared/api.ts: форму відповіді гарантує сервер.
  return body as T;
}

function get<T>(path: string): Promise<T> {
  return send(path, {method: 'GET'}).then(response => parse<T>(response));
}

function postInit(csrf: string, body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf},
    body: JSON.stringify(body),
  };
}

function post<T>(path: string, csrf: string, body: unknown): Promise<T> {
  return send(path, postInit(csrf, body)).then(response => parse<T>(response));
}

/** Результат приймання події разом із HTTP-статусом: 202 — прийнято вперше, 200 — повторна доставка. */
export interface IngestOutcome extends IngestResult {
  httpStatus: number;
}

/** 409 event_conflict приходить із тілом IngestResult: це результат, а не помилка. */
async function postEvent(csrf: string, fixture: string, mode: SimulatorMode): Promise<IngestOutcome> {
  const response = await send('/api/demo/events', postInit(csrf, {fixture, mode}));
  const body = await readBody(response);
  if (isIngestResult(body) && (response.ok || response.status === 409)) {
    return {...body, httpStatus: response.status};
  }
  return fail(response, body);
}

export const api = {
  session: () => get<SessionView>('/api/session'),
  chooseProfile: (csrf: string, profile: DemoProfile | null) =>
    post<SessionView>('/api/demo/session', csrf, {profile}),
  patient: () => get<PatientCaseView>('/api/patient'),
  staff: () => get<StaffView>('/api/staff'),
  analytics: () => get<AnalyticsView>('/api/analytics'),
  dev: () => get<DevView>('/api/dev'),
  guide: () => get<GuideView>('/api/guide'),
  command: (csrf: string, request: CommandRequest) => post<CommandResult>('/api/commands', csrf, request),
  sendEvent: postEvent,
  selectSnapshot: (csrf: string, snapshot: AnalyticsSnapshotId) =>
    post<{status: 'fixed_snapshot_selected'}>('/api/demo/analytics', csrf, {snapshot}),
};
