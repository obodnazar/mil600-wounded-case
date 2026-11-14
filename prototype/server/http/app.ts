import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {resolve} from 'node:path';
import {
  Denied, Ingress, Limiter, headers as securityHeaders, signature,
  type AuditAction, type EventEnvelope, type Session, type SignatureHeaders, type SourceKey,
} from '../../security/core.js';
import {readJsonBody, requestHeader, validateEvent} from '../../security/protocol.js';
import type {DemoProfile} from '../../shared/api.js';
import type {Store} from '../db/store.js';
import {acceptEvent, type IngestOutcome} from '../ingest/gateway.js';
import {assertCsrf, authorize, requireSession} from './browser-session.js';
import {ROUTES, type Access, type Reply, type Route} from './routes.js';

export interface AppOptions {
  store: Store;
  /** Ключі mock-джерел; живуть лише на сервері. */
  keys: Map<string, SourceKey>;
  /** Точний origin застосунку; дозволено лише loopback. */
  origin: string;
  now?: () => number;
  /** Читань на хвилину з однієї адреси. */
  readLimit?: number;
  /** Мутацій на хвилину з однієї адреси та подій на хвилину з одного джерела. */
  ingressLimit?: number;
  /** Каталог зібраного інтерфейсу. */
  publicDir?: string;
}

const INTEGRATION_PATH = '/api/integration/events';
const LOOPBACK = ['127.0.0.1', '::ffff:127.0.0.1', '::1'];
const WINDOW_MS = 60_000;
const PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; " +
  "object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/** Хто й що робив — для запису аудиту; заповнюється в міру проходження перевірок. */
interface Trail {
  action: AuditAction;
  actor: string;
  resource: string;
  role: string;
}

function assertSafeConfiguration(options: AppOptions): void {
  if (process.env.NODE_ENV === 'production' || !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(options.origin)) {
    throw new Error('loopback_demo_only');
  }
  for (const [keyId, key] of options.keys) {
    const weak = keyId !== key.id || key.secret.length < 32 || key.secret.equals(options.store.auditKey);
    if (weak) throw new Error('invalid_key_configuration');
  }
  const distinct = new Set([...options.keys.values()].map(key => key.secret.toString('hex')));
  if (distinct.size !== options.keys.size) throw new Error('separate_keys_required');
}

/**
 * HTTP-застосунок навчального прототипу. Слухає лише loopback.
 *
 * Порядок перевірок однаковий для всіх запитів:
 * заголовки безпеки → Host і loopback → без query → Origin → ліміт частоти →
 * (POST: точний Origin, сесія, CSRF) → маршрут і метод → роль → тіло → обробник → аудит.
 * Помилка завжди має вигляд `{error: код}` без деталей, тексту винятку чи вхідних значень.
 */
export function createApp(options: AppOptions): Server {
  assertSafeConfiguration(options);
  const {store} = options;
  const now = options.now ?? Date.now;
  const publicDir = options.publicDir ?? resolve('public');
  const reads = new Limiter(options.readLimit ?? 60, WINDOW_MS);
  const writes = new Limiter(options.ingressLimit ?? 30, WINDOW_MS);
  const sources = new Limiter(options.ingressLimit ?? 30, WINDOW_MS);
  const ingress = new Ingress(options.keys, event => Boolean(validateEvent(event)));

  /** Єдиний вхід для подій: і зовнішній endpoint, і dev-симулятор проходять тут. */
  const gateway = (raw: Buffer, signed: SignatureHeaders): IngestOutcome => {
    const event = ingress.authenticate(raw, signed, now());
    sources.take(`source:${signed.keyId}`, now());
    return acceptEvent(store, event, signed, now());
  };

  /** Симулятор підписує фіксовану подію серверним ключем джерела; ключ не залишає сервер. */
  const simulate = (event: EventEnvelope): IngestOutcome => {
    const key = [...options.keys.values()].find(item => item.source === event.source_system);
    if (!key) throw new Denied(503, 'source_unavailable');
    const raw = Buffer.from(JSON.stringify(event));
    const unsigned = {keyId: key.id, timestamp: String(Math.floor(now() / 1000)), nonce: randomBytes(16).toString('hex')};
    return gateway(raw, {...unsigned, signature: signature(key.secret, unsigned, raw)});
  };

  const receiveIntegrationEvent = async (request: IncomingMessage, peer: string): Promise<Reply> => {
    if (request.method !== 'POST') throw new Denied(405, 'method_not_allowed');
    writes.take(`gateway:${peer}`, now());
    const outcome = gateway(await readJsonBody(request), {
      keyId: requestHeader(request, 'x-key-id'),
      timestamp: requestHeader(request, 'x-timestamp'),
      nonce: requestHeader(request, 'x-nonce'),
      signature: requestHeader(request, 'x-signature'),
    });
    return {status: outcome.http, body: {status: outcome.status, business_applied: outcome.business_applied}, audited: true};
  };

  const serveStatic = (request: IncomingMessage, response: ServerResponse, path: string): void => {
    if (request.method !== 'GET') throw new Denied(405, 'method_not_allowed');
    const asset = /^\/assets\/[A-Za-z0-9._-]+\.(js|css)$/.exec(path);
    if (path !== '/' && !asset) throw new Denied(404, 'not_found');
    let file: Buffer;
    try {
      file = readFileSync(resolve(publicDir, asset ? path.slice(1) : 'index.html'));
    } catch {
      throw new Denied(404, 'not_found');
    }
    const type = asset ? (asset[1] === 'css' ? 'text/css' : 'text/javascript') : 'text/html';
    response.setHeader('Content-Type', `${type}; charset=utf-8`);
    response.setHeader('Content-Security-Policy', PAGE_CSP);
    response.writeHead(200);
    response.end(file);
  };

  const assertLocal = (request: IncomingMessage): void => {
    const hostMatches = requestHeader(request, 'host') === new URL(options.origin).host;
    if (!hostMatches || !LOOPBACK.includes(request.socket.remoteAddress ?? '')) throw new Denied(403, 'loopback_required');
  };

  const assertSameOrigin = (request: IncomingMessage): void => {
    const origin = requestHeader(request, 'origin');
    if ((origin && origin !== options.origin) || requestHeader(request, 'sec-fetch-site') === 'cross-site') {
      throw new Denied(403, 'origin_denied');
    }
  };

  /** Мутація з браузера: точний Origin, чинна cookie-сесія та CSRF-токен цієї сесії. */
  const assertBrowserMutation = (request: IncomingMessage): void => {
    if (requestHeader(request, 'origin') !== options.origin) throw new Denied(403, 'origin_required');
    requireSession(store, request, now());
    assertCsrf(request);
  };

  /** Права беруться з БД на момент запиту; роль із query чи тіла не враховується. */
  const resolveAccess = (access: Access, request: IncomingMessage, trail: Trail): Session | undefined => {
    if (access === 'public') return undefined;
    if (access === 'cookie') {
      requireSession(store, request, now());
      return undefined;
    }
    const session = authorize(store, request, now());
    trail.actor = session.actorId;
    trail.role = session.role;
    if (access !== 'authorized' && !access.includes(session.role as DemoProfile)) throw new Denied(403, 'forbidden');
    return session;
  };

  const handleApi = async (
    request: IncomingMessage, matches: RouteMatch[], peer: string, trail: Trail,
  ): Promise<Reply> => {
    reads.take(peer, now());
    const isPost = request.method === 'POST';
    if (isPost) {
      writes.take(peer, now());
      assertBrowserMutation(request);
    }
    const match = matches.find(item => item.route.method === request.method);
    if (!match) {
      // Невідомий шлях не розкривається анонімному запиту; відомий шлях з іншим методом — 405.
      if (!matches.length) authorize(store, request, now());
      throw new Denied(matches.length ? 405 : 404, matches.length ? 'method_not_allowed' : 'not_found');
    }
    const {route, params} = match;
    const session = resolveAccess(route.access, request, trail);
    return route.handle({store, request, now: now(), params, session, simulate});
  };

  const server = createServer(async (request, response) => {
    for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
    const trail: Trail = {action: 'case_read', actor: 'anonymous', resource: 'unknown', role: 'anonymous'};
    const send = (status: number, body: unknown): void => {
      response.writeHead(status);
      response.end(JSON.stringify(body));
    };
    try {
      const url = new URL(request.url ?? '/', options.origin);
      const path = url.pathname;
      const peer = request.socket.remoteAddress ?? 'unknown';
      trail.resource = path;
      if (path === INTEGRATION_PATH) trail.action = 'event_validate';
      const matches = matchRoutes(path, request.method);
      describe(matches, trail);
      assertLocal(request);
      if (url.search) throw new Denied(400, 'query_not_supported');
      assertSameOrigin(request);
      if (!path.startsWith('/api/')) {
        serveStatic(request, response, path);
        return;
      }
      const reply = path === INTEGRATION_PATH
        ? await receiveIntegrationEvent(request, peer)
        : await handleApi(request, matches, peer, trail);
      if (!reply.audited) store.audit(trail.action, 'allowed', trail.actor, trail.resource, now(), trail.role);
      if (reply.cookie) response.setHeader('Set-Cookie', reply.cookie);
      send(reply.status, reply.body);
    } catch (error) {
      const failure = asFailure(error);
      if (failure.status === 429) {
        // Відмова за лімітом не пише аудит на кожен запит: журнал не можна роздути потоком запитів.
        response.setHeader('Retry-After', String(WINDOW_MS / 1000));
      } else {
        try {
          store.audit(trail.action, 'denied', trail.actor, trail.resource, now(), trail.role);
        } catch {
          send(503, {error: 'audit_unavailable'});
          return;
        }
      }
      if (failure.status === 405) response.setHeader('Allow', 'GET, POST');
      send(failure.status, {error: failure.code});
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 3000;
  server.keepAliveTimeout = 1000;
  return server;
}

interface RouteMatch {
  route: Route;
  params: RegExpExecArray;
}

/** Маршрути з відповідним шляхом; той, що збігається й за методом, іде першим. */
function matchRoutes(path: string, method: string | undefined): RouteMatch[] {
  const matches = ROUTES.flatMap(route => {
    const params = route.pattern.exec(path);
    return params ? [{route, params}] : [];
  });
  return matches.sort((a, b) => Number(b.route.method === method) - Number(a.route.method === method));
}

/** Дія й ресурс для аудиту відомі ще до перевірок, тож відмова теж записується точно. */
function describe(matches: RouteMatch[], trail: Trail): void {
  const first = matches[0];
  if (!first) return;
  trail.action = first.route.action;
  if (first.route.resource) trail.resource = first.route.resource(first.params);
}

/** Невідомі помилки не розкривають причини: назовні лише загальний код. */
function asFailure(error: unknown): Denied {
  if (error instanceof Denied) return error;
  return new Denied(503, 'service_unavailable');
}
