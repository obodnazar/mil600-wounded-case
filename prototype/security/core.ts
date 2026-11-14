import {createHash, createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {mkdir, open} from 'node:fs/promises';
import {dirname} from 'node:path';

/**
 * Захисне ядро навчального прототипу (фаза 7): відмови, сесії, ліміти, аудит,
 * автентифікація джерел і безпечні агрегати. Не залежить від HTTP чи БД.
 */

/** Контрольована відмова: назовні потрапляють лише HTTP-статус і короткий код. */
export class Denied extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export type Role = 'patient' | 'commander' | 'support' | 'analyst' | 'dev';

export interface Session {
  actorId: string;
  role: Role;
  caseIds: Set<string>;
  expiresAt: number;
  revoked: boolean;
  grantExpiresAt: number;
}

export interface CaseRecord {
  id: string;
  status: string;
  nextAction: string;
  freshness: string;
}

export const headers = Object.freeze({
  'Content-Security-Policy':
    "default-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Type': 'application/json; charset=utf-8',
});

export function checkSession(session: Session | undefined, now: number): Session {
  if (!session || session.revoked || session.expiresAt <= now || session.grantExpiresAt <= now) {
    throw new Denied(401, 'authentication_required');
  }
  return session;
}

/**
 * Доступ до кейсу. Клінічний ресурс — лише самому військовослужбовцю.
 * Чужий і відсутній кейс дають однакову нерозкривальну 404.
 */
export function checkCase(session: Session, id: string, clinical = false): void {
  if (clinical && session.role !== 'patient') throw new Denied(403, 'forbidden');
  if (!['patient', 'commander', 'support'].includes(session.role)) throw new Denied(403, 'forbidden');
  if (!session.caseIds.has(id)) throw new Denied(404, 'not_found');
}

export function projectCase(record: CaseRecord): Readonly<Record<string, string>> {
  // Явна проєкція: навіть майбутні поля CaseRecord не потрапляють у DTO автоматично.
  return {case_id: record.id, status: record.status, next_action: record.nextAction, freshness: record.freshness};
}

/** Обмежувач частоти з фіксованим вікном і обмеженою кількістю ключів. */
export class Limiter {
  private readonly buckets = new Map<string, {count: number; until: number}>();

  constructor(readonly limit: number, readonly windowMs: number, readonly capacity = 1000) {}

  take(key: string, now: number): void {
    for (const [name, bucket] of this.buckets) if (bucket.until <= now) this.buckets.delete(name);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      // Нові ключі не можуть витіснити активні, щоб обійти ліміт.
      if (this.buckets.size >= this.capacity) throw new Denied(429, 'rate_limited');
      bucket = {count: 0, until: now + this.windowMs};
      this.buckets.set(key, bucket);
    }
    if (++bucket.count > this.limit) throw new Denied(429, 'rate_limited');
  }
}

/* ───────────── Аудит без змісту ───────────── */

export type AuditAction =
  | 'case_read'
  | 'clinical_read'
  | 'analytics_read'
  | 'event_validate'
  | 'session_read'
  | 'session_change'
  | 'simulator_run'
  | 'command';

export type AuditResult = 'allowed' | 'denied' | 'validated_only' | 'duplicate' | 'accepted' | 'pending';

export interface AuditRecord {
  request_id: string;
  at: string;
  action: AuditAction;
  result: AuditResult;
  actor_tag: string;
  resource_tag: string;
}

export interface AuditSink {
  write(record: AuditRecord): Promise<void>;
}

export class FileAudit implements AuditSink {
  constructor(private readonly path: string) {}

  async write(record: AuditRecord): Promise<void> {
    await mkdir(dirname(this.path), {recursive: true, mode: 0o700});
    const file = await open(this.path, 'a', 0o600);
    try {
      await file.chmod(0o600);
      await file.appendFile(`${JSON.stringify(record)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
  }
}

/** Актор і ресурс потрапляють у журнал лише як HMAC-мітки, не як ідентифікатори. */
export function auditRecord(
  key: Buffer, action: AuditAction, result: AuditResult, actor: string, resource: string, now: number,
): AuditRecord {
  const tag = (namespace: string, id: string): string =>
    createHmac('sha256', key).update(`${namespace}\0${id}`).digest('hex');
  return {
    request_id: randomUUID(),
    at: new Date(now).toISOString(),
    action,
    result,
    actor_tag: tag('actor', actor),
    resource_tag: tag('resource', resource),
  };
}

/* ───────────── Автентифікація джерел ───────────── */

export interface SourceKey {
  id: string;
  secret: Buffer;
  source: string;
  types: ReadonlySet<string>;
  subjects: ReadonlySet<string>;
}

export interface EventEnvelope {
  schema_version: 'case-event/1';
  event_id: string;
  event_type: string;
  source_system: string;
  source_record_ref: string;
  source_stream: string;
  source_version: string;
  source_order: number | null;
  subject_ref: string;
  incident_ref: string | null;
  episode_ref: string | null;
  occurred_at: string;
  recorded_at: string;
  supersedes_version?: string;
  payload: Record<string, unknown>;
}

export interface SignatureHeaders {
  keyId: string;
  timestamp: string;
  nonce: string;
  signature: string;
}

/**
 * Глобальна політика «джерело → типи подій». Вона не залежить від конфігурації
 * ключа: навіть ключ із надто широким переліком типів не дозволить, наприклад,
 * медичному джерелу підтвердити видачу документа.
 */
const SOURCE_TYPES: Readonly<Record<string, readonly string[]>> = {
  'demo-mis': [
    'source.sync_gap', 'medical.primary_recorded', 'care.admitted', 'care.transferred', 'care.discharged',
    'care.start_confirmed', 'document.prepared', 'document.corrected', 'document.withdrawn',
  ],
  'demo-sedo': [
    'document.sent', 'document.prepared', 'document.issued', 'document.corrected', 'document.withdrawn',
    'document.received', 'referral.issued',
  ],
  'demo-vlk': ['vlk.package_received', 'vlk.package_returned', 'vlk.decision_recorded', 'document.received'],
  'demo-finance': ['finance.package_received', 'finance.status_recorded', 'document.received'],
  'demo-service': ['service.action_confirmed', 'document.received'],
  'demo-civil-mis': ['care.admitted', 'care.transferred', 'care.discharged', 'document.prepared'],
};

/** Чиє отримання документа може підтвердити кожне джерело. */
const RECEIPT_RECIPIENTS: Readonly<Record<string, readonly string[]>> = {
  'demo-sedo': ['part'],
  'demo-vlk': ['vlk'],
  'demo-finance': ['finance'],
  'demo-service': ['servicemember', 'part'],
};

/** Які види документів може згадувати джерело в події певного типу. */
function allowedDocumentKinds(source: string, eventType: string): readonly string[] {
  if (source === 'demo-mis') {
    const medical = ['primary_medical_card', 'medical_summary', 'hospital_stay_certificate'];
    return eventType === 'document.prepared' ? [...medical, 'trauma_certificate'] : medical;
  }
  if (source === 'demo-civil-mis') return ['medical_summary', 'hospital_stay_certificate'];
  // Довідку про обставини травми складає лише медслужба (demo-mis); інші джерела її видають чи передають.
  return eventType === 'document.prepared' ? ['referral'] : ['trauma_certificate', 'referral'];
}

export function signature(key: Buffer, signed: Omit<SignatureHeaders, 'signature'>, raw: Buffer): string {
  return createHmac('sha256', key)
    .update(`${signed.keyId}\nPOST\n/api/integration/events\n${signed.timestamp}\n${signed.nonce}\n`)
    .update(raw)
    .digest('hex');
}

/** Канонічний хеш змісту події без `event_id`: порядок ключів не впливає на результат. */
export function semanticDigest(event: EventEnvelope): string {
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en'));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  };
  const withoutId = Object.fromEntries(Object.entries(event).filter(([name]) => name !== 'event_id'));
  return createHash('sha256').update(canonical(withoutId)).digest('hex');
}

export class Ingress {
  private readonly nonces = new Map<string, number>();
  private readonly events = new Map<string, string>();
  private readonly versions = new Map<string, string>();

  constructor(
    private readonly keys: Map<string, SourceKey>,
    private readonly valid: (candidate: unknown) => boolean,
    private readonly windowMs = 300_000,
    private readonly capacity = 1000,
  ) {}

  /**
   * Перевіряє підпис над сирими байтами ДО розбору JSON, вікно часу, повтор nonce,
   * строгу схему та права джерела на тип події, особу, вид документа й адресата.
   */
  authenticate(raw: Buffer, signed: SignatureHeaders, now: number): EventEnvelope {
    const key = this.keys.get(signed.keyId);
    const wellFormed =
      /^\d{10}$/.test(signed.timestamp) &&
      /^[A-Za-z0-9_-]{16,80}$/.test(signed.nonce) &&
      /^[a-f0-9]{64}$/.test(signed.signature);
    if (!key || !wellFormed) throw new Denied(401, 'invalid_signature');
    if (Math.abs(now - Number(signed.timestamp) * 1000) > this.windowMs) throw new Denied(401, 'stale_signature');
    const expected = Buffer.from(signature(key.secret, signed, raw), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(signed.signature, 'hex'))) throw new Denied(401, 'invalid_signature');

    for (const [name, expiry] of this.nonces) if (expiry <= now) this.nonces.delete(name);
    const nonce = `${signed.keyId}:${signed.nonce}`;
    if (this.nonces.has(nonce)) throw new Denied(409, 'transport_replay');
    if (this.nonces.size >= this.capacity) throw new Denied(429, 'ingress_capacity');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new Denied(400, 'invalid_event');
    }
    if (!this.valid(parsed)) throw new Denied(400, 'invalid_event');
    const event = parsed as EventEnvelope;
    this.assertSourceScope(key, event);

    // Покрити включну межу підпису з допустимим майбутнім timestamp.
    this.nonces.set(nonce, now + this.windowMs * 2 + 1000);
    return event;
  }

  private assertSourceScope(key: SourceKey, event: EventEnvelope): void {
    const ownEvent =
      event.source_system === key.source && key.types.has(event.event_type) && key.subjects.has(event.subject_ref);
    if (!ownEvent) throw new Denied(403, 'source_scope_denied');
    if (!SOURCE_TYPES[key.source]?.includes(event.event_type)) throw new Denied(403, 'source_scope_denied');
    const documentKind = event.payload.document_kind;
    if (documentKind !== undefined) {
      const kinds = allowedDocumentKinds(key.source, event.event_type);
      if (!kinds.includes(String(documentKind))) throw new Denied(403, 'source_scope_denied');
    }
    if (event.event_type === 'document.received') {
      const recipients = RECEIPT_RECIPIENTS[key.source];
      if (!recipients?.includes(String(event.payload.recipient_kind))) throw new Denied(403, 'source_scope_denied');
    }
  }

  /** Перевірка з дедуплікацією в пам'яті — для окремого тестового адаптера фази 7. */
  verify(raw: Buffer, signed: SignatureHeaders, now: number): {event: EventEnvelope; duplicate: boolean} {
    const event = this.authenticate(raw, signed, now);
    const source = event.source_system;
    const digest = semanticDigest(event);
    const id = `${source}:${event.event_id}`;
    const version = JSON.stringify([source, event.source_stream, event.source_version, event.event_type]);
    const knownId = this.events.get(id);
    const knownVersion = this.versions.get(version);
    if ((knownId && knownId !== digest) || (knownVersion && knownVersion !== digest)) {
      throw new Denied(409, 'event_conflict');
    }
    if (!knownId && this.events.size >= this.capacity) throw new Denied(429, 'ingress_capacity');
    this.events.set(id, digest);
    this.versions.set(version, digest);
    return {event, duplicate: Boolean(knownId || knownVersion)};
  }
}

/* ───────────── Безпечні агрегати ───────────── */

/**
 * Консервативне комплементарне пригнічення: якщо хоча б одна клітинка менша за
 * поріг, приховуються всі клітинки й підсумок — малу групу не відновити відніманням.
 */
export function safeAggregate(counts: readonly number[], minimum = 5): Record<string, unknown> {
  const invalid = !Number.isInteger(minimum) || minimum < 5 || counts.some(n => !Number.isInteger(n) || n < 0);
  if (invalid) throw new Denied(503, 'analytics_unavailable');
  if (!counts.length || counts.some(n => n < minimum)) return {status: 'suppressed'};
  return {status: 'synthetic_fixed_snapshot', groups: counts, total: counts.reduce((a, b) => a + b, 0)};
}

/* ───────────── Середовище й секрети ───────────── */

const BASE_SECRET_NAMES = [
  'DEMO_MIS_HMAC_KEY',
  'DEMO_SEDO_HMAC_KEY',
  'DEMO_VLK_HMAC_KEY',
  'DEMO_FINANCE_HMAC_KEY',
  'DEMO_AUDIT_HMAC_KEY',
];

/** Лише синтетичний режим і лише окремі 32-байтні ключі; інакше — відмова запуску. */
export function requireDemoEnvironment(env: NodeJS.ProcessEnv, extraNames: readonly string[] = []): Map<string, Buffer> {
  if (env.DEMO_MODE !== 'true' || env.NODE_ENV === 'production') throw new Error('demo_environment_required');
  const result = new Map<string, Buffer>();
  for (const name of [...BASE_SECRET_NAMES, ...extraNames]) {
    const value = env[name];
    if (!value || !/^[a-f0-9]{64}$/.test(value)) throw new Error('invalid_secret_configuration');
    result.set(name, Buffer.from(value, 'hex'));
  }
  const distinct = new Set([...result.values()].map(value => value.toString('hex')));
  if (distinct.size !== result.size) throw new Error('separate_keys_required');
  return result;
}
