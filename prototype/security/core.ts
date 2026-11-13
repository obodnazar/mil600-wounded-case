import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { open, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class Denied extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export type Role = 'patient' | 'commander' | 'support' | 'analyst' | 'dev';
export interface Session {
  actorId: string; role: Role; caseIds: Set<string>; expiresAt: number;
  revoked: boolean; grantExpiresAt: number;
}
export interface CaseRecord {
  id: string; status: string; nextAction: string; freshness: string;
}
export const headers = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Type': 'application/json; charset=utf-8'
});

export function checkSession(s: Session | undefined, now: number): Session {
  if (!s || s.revoked || s.expiresAt <= now || s.grantExpiresAt <= now) throw new Denied(401, 'authentication_required');
  return s;
}
export function checkCase(s: Session, id: string, clinical = false): void {
  if (clinical && s.role !== 'patient') throw new Denied(403, 'forbidden');
  if (!['patient', 'commander', 'support'].includes(s.role)) throw new Denied(403, 'forbidden');
  if (!s.caseIds.has(id)) throw new Denied(404, 'not_found');
}
export function projectCase(c: CaseRecord): Readonly<Record<string, string>> {
  // Явна проєкція: навіть майбутні поля CaseRecord не потрапляють у DTO автоматично.
  return {case_id: c.id, status: c.status, next_action: c.nextAction, freshness: c.freshness};
}

export class Limiter {
  private readonly buckets = new Map<string, {count: number; until: number}>();
  constructor(readonly limit: number, readonly windowMs: number, readonly capacity = 1000) {}
  take(key: string, now: number): void {
    for (const [k, b] of this.buckets) if (b.until <= now) this.buckets.delete(k);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.capacity) throw new Denied(429, 'rate_limited');
      bucket = {count: 0, until: now + this.windowMs}; this.buckets.set(key, bucket);
    }
    if (++bucket.count > this.limit) throw new Denied(429, 'rate_limited');
  }
}

export type AuditAction = 'case_read' | 'clinical_read' | 'analytics_read' | 'event_validate' | 'session_read' | 'session_change' | 'simulator_run';
export type AuditResult = 'allowed' | 'denied' | 'validated_only' | 'duplicate' | 'accepted' | 'pending';
export interface AuditRecord {request_id: string; at: string; action: AuditAction; result: AuditResult; actor_tag: string; resource_tag: string}
export interface AuditSink {write(record: AuditRecord): Promise<void>}
export class FileAudit implements AuditSink {
  constructor(private readonly path: string) {}
  async write(record: AuditRecord): Promise<void> {
    await mkdir(dirname(this.path), {recursive: true, mode: 0o700});
    const file = await open(this.path, 'a', 0o600);
    try { await file.chmod(0o600); await file.appendFile(JSON.stringify(record) + '\n'); await file.sync(); }
    finally { await file.close(); }
  }
}
export function auditRecord(key: Buffer, action: AuditAction, result: AuditResult, actor: string, resource: string, now: number): AuditRecord {
  const tag = (namespace: string, id: string) => createHmac('sha256', key).update(namespace + '\0' + id).digest('hex');
  return {request_id: randomUUID(), at: new Date(now).toISOString(), action, result,
    actor_tag: tag('actor', actor), resource_tag: tag('resource', resource)};
}

export interface SourceKey {id: string; secret: Buffer; source: string; types: ReadonlySet<string>; subjects: ReadonlySet<string>}
export interface EventEnvelope {
  schema_version: 'case-event/1'; event_id: string; event_type: string; source_system: string;
  source_record_ref: string; source_stream: string; source_version: string; source_order: number | null;
  subject_ref: string; incident_ref: string | null; episode_ref: string | null;
  occurred_at: string; recorded_at: string; payload: Record<string, unknown>;
}
export interface SignatureHeaders {keyId: string; timestamp: string; nonce: string; signature: string}
const sourceTypes: Readonly<Record<string, readonly string[]>> = {
  'demo-mis':['medical.primary_recorded','care.admitted','care.transferred','care.discharged','care.start_confirmed','document.prepared','document.corrected','document.withdrawn'],
  'demo-sedo':['document.prepared','document.issued','document.corrected','document.withdrawn','document.received','referral.issued'],
  'demo-vlk':['vlk.package_received','vlk.package_returned','vlk.decision_recorded','document.received'],
  'demo-finance':['finance.package_received','finance.status_recorded','document.received'],
  'demo-service':['service.action_confirmed','document.received']
};
export function signature(key: Buffer, h: Omit<SignatureHeaders, 'signature'>, raw: Buffer): string {
  return createHmac('sha256', key).update(`${h.keyId}\nPOST\n/api/integration/events\n${h.timestamp}\n${h.nonce}\n`).update(raw).digest('hex');
}
export function semanticDigest(event: EventEnvelope): string {
  const canonical = (x: unknown): string => {
    if (x === null || typeof x !== 'object') return JSON.stringify(x);
    if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
    return '{' + Object.entries(x).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
  };
  return createHash('sha256').update(canonical(Object.fromEntries(Object.entries(event).filter(([name])=>name!=='event_id')))).digest('hex');
}
export class Ingress {
  private readonly nonces = new Map<string, number>();
  private readonly events = new Map<string, string>();
  private readonly versions = new Map<string, string>();
  constructor(private readonly keys: Map<string, SourceKey>, private readonly valid: (x: unknown) => boolean,
    private readonly windowMs = 300_000, private readonly capacity = 1000) {}
  authenticate(raw: Buffer, h: SignatureHeaders, now: number): EventEnvelope {
    const key = this.keys.get(h.keyId);
    if (!key || !/^\d{10}$/.test(h.timestamp) || !/^[A-Za-z0-9_-]{16,80}$/.test(h.nonce) || !/^[a-f0-9]{64}$/.test(h.signature)) throw new Denied(401, 'invalid_signature');
    if (Math.abs(now - Number(h.timestamp) * 1000) > this.windowMs) throw new Denied(401, 'stale_signature');
    const expected = Buffer.from(signature(key.secret, h, raw), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(h.signature, 'hex'))) throw new Denied(401, 'invalid_signature');
    for (const [n, expiry] of this.nonces) if (expiry <= now) this.nonces.delete(n);
    const nonce = h.keyId + ':' + h.nonce;
    if (this.nonces.has(nonce)) throw new Denied(409, 'transport_replay');
    if (this.nonces.size >= this.capacity) throw new Denied(429, 'ingress_capacity');
    let parsed: unknown;
    try { parsed = JSON.parse(raw.toString('utf8')); } catch { throw new Denied(400, 'invalid_event'); }
    if (!this.valid(parsed)) throw new Denied(400, 'invalid_event');
    const event = parsed as EventEnvelope;
    if (event.source_system !== key.source || !key.types.has(event.event_type) || !key.subjects.has(event.subject_ref)) throw new Denied(403, 'source_scope_denied');
    if (!sourceTypes[key.source]?.includes(event.event_type)) throw new Denied(403,'source_scope_denied');
    if (event.payload.document_kind !== undefined) {
      const kinds = key.source === 'demo-mis' ? ['primary_medical_card','medical_summary'] : ['trauma_certificate','referral'];
      if (!kinds.includes(String(event.payload.document_kind))) throw new Denied(403,'source_scope_denied');
    }
    if (event.event_type === 'document.received') {
      const recipients: Readonly<Record<string, readonly string[]>> = {'demo-sedo':['part'],'demo-vlk':['vlk'],'demo-finance':['finance'],'demo-service':['servicemember','part']};
      if (!recipients[key.source]?.includes(String(event.payload.recipient_kind))) throw new Denied(403,'source_scope_denied');
    }
    this.nonces.set(nonce, now + this.windowMs * 2 + 1000);
    return event;
  }
  verify(raw: Buffer, h: SignatureHeaders, now: number): {event: EventEnvelope; duplicate: boolean} {
    const event=this.authenticate(raw,h,now);
    const key=this.keys.get(h.keyId)!;
    const digest=semanticDigest(event);
    const id = key.source + ':' + event.event_id;
    const version = JSON.stringify([key.source,event.source_stream,event.source_version,event.event_type]);
    const oldId = this.events.get(id), oldVersion = this.versions.get(version);
    if ((oldId && oldId !== digest) || (oldVersion && oldVersion !== digest)) throw new Denied(409, 'event_conflict');
    if (!oldId && this.events.size >= this.capacity) throw new Denied(429, 'ingress_capacity');
    // Покрити включну межу підпису з допустимим майбутнім timestamp.
    this.events.set(id, digest); this.versions.set(version, digest);
    return {event, duplicate: Boolean(oldId || oldVersion)};
  }
}

export function safeAggregate(counts: readonly number[], minimum = 5): Record<string, unknown> {
  if (!Number.isInteger(minimum) || minimum < 5 || counts.some(n => !Number.isInteger(n) || n < 0)) throw new Denied(503, 'analytics_unavailable');
  // Консервативне комплементарне пригнічення: якщо одна мала — приховати всі й total.
  if (!counts.length || counts.some(n => n < minimum)) return {status: 'suppressed'};
  return {status: 'synthetic_fixed_snapshot', groups: counts, total: counts.reduce((a,b) => a+b, 0)};
}

export function requireDemoEnvironment(env: NodeJS.ProcessEnv): Map<string, Buffer> {
  if (env.DEMO_MODE !== 'true' || env.NODE_ENV === 'production') throw new Error('demo_environment_required');
  const result = new Map<string, Buffer>();
  for (const name of ['DEMO_MIS_HMAC_KEY','DEMO_SEDO_HMAC_KEY','DEMO_VLK_HMAC_KEY','DEMO_FINANCE_HMAC_KEY','DEMO_AUDIT_HMAC_KEY']) {
    const value = env[name];
    if (!value || !/^[a-f0-9]{64}$/.test(value)) throw new Error('invalid_secret_configuration');
    result.set(name, Buffer.from(value, 'hex'));
  }
  if (new Set([...result.values()].map(v => v.toString('hex'))).size !== result.size) throw new Error('separate_keys_required');
  return result;
}
