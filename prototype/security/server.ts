import { createServer, type IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import { Denied, Ingress, Limiter, auditRecord, checkCase, checkSession, headers, projectCase, safeAggregate,
  type Session, type CaseRecord, type AuditSink, type AuditAction, type SourceKey } from './core.js';
import schema from './event.schema.json' with {type: 'json'};
import type { Ajv as AjvType } from 'ajv';

const require = createRequire(import.meta.url);
const Ajv = require('ajv') as typeof AjvType;
const addFormats = require('ajv-formats') as (ajv: AjvType) => void;
const ajv = new Ajv({allErrors: false, strict: true}); addFormats(ajv);
const validate = ajv.compile(schema);

export interface ServerOptions {
  sessions: Map<string, Session>; cases: Map<string, CaseRecord>; keys: Map<string, SourceKey>;
  audit: AuditSink; auditKey: Buffer; now?: () => number; readLimit?: number;
  ingressLimit?: number; aggregateCounts?: readonly number[]; environment: 'synthetic-test';
}
function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name]; return typeof value === 'string' ? value : '';
}
async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []; let bytes = 0;
  if (header(req,'content-type') !== 'application/json') throw new Denied(415, 'json_required');
  if (req.headers['content-encoding']) throw new Denied(415, 'encoding_not_supported');
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string); bytes += b.length;
    if (bytes > 16_384) throw new Denied(413, 'body_too_large'); chunks.push(b);
  }
  return Buffer.concat(chunks);
}
export function createSecurityServer(options: ServerOptions) {
  if (options.environment !== 'synthetic-test' || process.env.NODE_ENV === 'production' || options.auditKey.length < 32) throw new Error('synthetic_environment_required');
  for (const [id,key] of options.keys) {
    if (id !== key.id || key.secret.length < 32 || key.secret.equals(options.auditKey)) throw new Error('invalid_key_configuration');
  }
  if (new Set([...options.keys.values()].map(k=>k.secret.toString('hex'))).size !== options.keys.size) throw new Error('separate_keys_required');
  const now = options.now ?? Date.now;
  const reads = new Limiter(options.readLimit ?? 60, 60_000);
  const ingressRate = new Limiter(options.ingressLimit ?? 30, 60_000);
  const ingress = new Ingress(options.keys, x => Boolean(validate(x)));
  const server = createServer(async (req,res) => {
    for (const [name,value] of Object.entries(headers)) res.setHeader(name,value);
    let action: AuditAction | undefined; let actor = 'anonymous'; let resource = 'unknown';
    const reply = (status: number, data: Record<string, unknown>) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const clinical = /^\/api\/cases\/[^/]+\/clinical-document$/.test(url.pathname);
      const match = /^\/api\/cases\/(demo-[a-z0-9-]{1,60})(?:\/clinical-document)?$/.exec(url.pathname);
      if (url.pathname.startsWith('/api/cases/')) { action = clinical ? 'clinical_read':'case_read'; resource = match?.[1] ?? 'unknown'; }
      else if (url.pathname === '/api/analytics') { action = 'analytics_read'; resource = 'fixed-cohort'; }
      else if (url.pathname === '/api/integration/events') action = 'event_validate';
      if (url.search) throw new Denied(400, 'query_not_supported');
      // Цей адаптер не приймає браузерних cross-origin запитів і не довіряє proxy headers.
      if (req.headers.origin) throw new Denied(403, 'origin_not_supported');
      const peer = req.socket.remoteAddress ?? 'unknown';
      if (url.pathname === '/api/integration/events') {
        action = 'event_validate'; ingressRate.take(peer, now());
        if (req.method !== 'POST') throw new Denied(405, 'method_not_allowed');
        const verified = ingress.verify(await body(req), {keyId: header(req,'x-key-id'), timestamp: header(req,'x-timestamp'), nonce: header(req,'x-nonce'), signature: header(req,'x-signature')}, now());
        actor = verified.event.source_system; resource = verified.event.event_id;
        await options.audit.write(auditRecord(options.auditKey,action,verified.duplicate ? 'duplicate':'validated_only',actor,resource,now()));
        // Це security-harness: немає стійкого inbox / застосування домену, не видаємо 202 accepted.
        reply(200,{status: verified.duplicate ? 'duplicate':'validated_only', business_applied: false}); return;
      }
      reads.take(peer, now());
      const token = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(header(req,'authorization'))?.[1];
      const session = checkSession(token ? options.sessions.get(token) : undefined, now()); actor = session.actorId;
      if (req.method !== 'GET') throw new Denied(405,'method_not_allowed');
      if (match) {
        checkCase(session,resource,clinical);
        const c = options.cases.get(resource); if (!c) throw new Denied(404,'not_found');
        await options.audit.write(auditRecord(options.auditKey,action ?? 'case_read','allowed',actor,resource,now()));
        reply(200,clinical ? {status:'synthetic_document',sample:'Вигаданий навчальний зразок'} : projectCase(c)); return;
      }
      if (url.pathname === '/api/analytics') {
        if (session.role !== 'analyst') throw new Denied(403,'forbidden');
        const data = safeAggregate(options.aggregateCounts ?? [3,7]);
        await options.audit.write(auditRecord(options.auditKey,'analytics_read','allowed',actor,resource,now()));
        reply(200,data); return;
      }
      throw new Denied(404,'not_found');
    } catch (error) {
      const failure = error instanceof Denied ? error : new Denied(503,'service_unavailable');
      if (action) {
        try { await options.audit.write(auditRecord(options.auditKey,action,'denied',actor,resource,now())); }
        catch { reply(503,{error:'audit_unavailable'}); return; }
      }
      // Не повертаємо Error.message / input / headers / URL / stack і не пишемо їх у console.
      reply(failure.status,{error:failure.code});
    }
  });
  server.requestTimeout = 5000; server.headersTimeout = 3000; server.keepAliveTimeout = 1000;
  return server;
}
