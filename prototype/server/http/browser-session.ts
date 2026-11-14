import {randomBytes, timingSafeEqual} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import {Denied, checkSession, type Session} from '../../security/core.js';
import {requestHeader} from '../../security/protocol.js';
import type {DemoProfile, SessionView} from '../../shared/api.js';
import {SESSION_TTL_MS, resolveSession} from '../access/sessions.js';
import {sha256, type Row, type Store} from '../db/store.js';
import {PROFILES} from './validation.js';

/**
 * Навчальна браузерна сесія: випадковий 256-бітний токен у HttpOnly / SameSite=Strict
 * cookie. У БД зберігається лише його хеш. CSRF-токен ніде не зберігається: сервер
 * щоразу виводить його з токена сесії, який сторінка прочитати не може.
 * Це вибір демо-ролі, а не справжня автентифікація.
 */

/** Кожній демо-ролі відповідає один серверний актор із seed; з запиту він не береться. */
const ACTORS: Readonly<Record<DemoProfile, string>> = {
  patient: 'demo-person-01',
  commander: 'demo-commander',
  support: 'demo-support',
  analyst: 'demo-analyst',
  dev: 'demo-dev',
};

const SESSION_CAPACITY = 1000;
const COOKIE_PATTERN = /^(?:.*;\s*)?demo_session=([a-f0-9]{64})(?:;.*)?$/;
const CSRF_PATTERN = /^[a-f0-9]{64}$/;

export const actorOf = (profile: DemoProfile): string => ACTORS[profile];

/** CSRF-токен, прив'язаний до сесії: змінюється разом із нею й не потребує окремого сховища. */
const csrfFor = (sessionToken: string): string => sha256(`demo-csrf\0${sessionToken}`);

export function sessionToken(request: IncomingMessage): string | undefined {
  return COOKIE_PATTERN.exec(requestHeader(request, 'cookie'))?.[1];
}

/** Чинний запис сесії за cookie або undefined. */
export function findSession(store: Store, request: IncomingMessage, now: number): Row | undefined {
  const token = sessionToken(request);
  if (!token) return undefined;
  return store.row('SELECT * FROM demo_session WHERE token_hash=? AND expires_at>?', sha256(token), now);
}

export function requireSession(store: Store, request: IncomingMessage, now: number): Row {
  const session = findSession(store, request, now);
  if (!session) throw new Denied(401, 'authentication_required');
  return session;
}

export function sessionView(session: Row, token: string): SessionView {
  return {
    profile: session.profile ? (String(session.profile) as DemoProfile) : null,
    csrf: csrfFor(token),
    expiresAt: Number(session.expires_at),
    profiles: [...PROFILES],
  };
}

/** Порівняння CSRF-токена із заголовка з очікуваним для цієї сесії — за сталий час. */
export function assertCsrf(request: IncomingMessage): void {
  const provided = requestHeader(request, 'x-csrf-token');
  const token = sessionToken(request);
  const valid = token !== undefined && CSRF_PATTERN.test(provided) &&
    timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(csrfFor(token), 'hex'));
  if (!valid) throw new Denied(403, 'csrf_denied');
}

/**
 * Права обчислюються з БД на кожен запит: відкликаний грант чи завершене
 * призначення діють одразу, навіть якщо cookie ще чинний.
 */
export function authorize(store: Store, request: IncomingMessage, now: number): Session {
  const session = requireSession(store, request, now);
  if (!session.profile || !session.actor_id) throw new Denied(401, 'authentication_required');
  const resolved = resolveSession(store, String(session.profile) as DemoProfile, String(session.actor_id), now);
  return checkSession({...resolved, expiresAt: Number(session.expires_at)}, now);
}

export interface IssuedSession {
  view: SessionView;
  cookie: string;
}

/**
 * Видає нову сесію й анулює попередню: після зміни ролі старий токен і старий
 * CSRF більше не діють. Викликати всередині транзакції разом із записом аудиту.
 */
export function issueSession(
  store: Store, profile: DemoProfile | null, previousToken: string | undefined, now: number,
): IssuedSession {
  const token = randomBytes(32).toString('hex');
  const expiresAt = now + SESSION_TTL_MS;
  store.run('DELETE FROM demo_session WHERE expires_at<=?', now);
  if (store.count('SELECT COUNT(*) AS n FROM demo_session') >= SESSION_CAPACITY) throw new Denied(429, 'session_capacity');
  if (previousToken) store.run('DELETE FROM demo_session WHERE token_hash=?', sha256(previousToken));
  // Роль видається лише за чинного гранта її серверного актора.
  if (profile) resolveSession(store, profile, ACTORS[profile], now);
  store.run(
    'INSERT INTO demo_session(token_hash,actor_id,profile,expires_at) VALUES (?,?,?,?)',
    sha256(token), profile ? ACTORS[profile] : null, profile, expiresAt,
  );
  return {
    view: {profile, csrf: csrfFor(token), expiresAt, profiles: [...PROFILES]},
    cookie: `demo_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
  };
}
