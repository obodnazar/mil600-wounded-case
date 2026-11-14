import type {IncomingMessage} from 'node:http';
import {Denied, checkCase, type AuditAction, type Session} from '../../security/core.js';
import {readJsonBody} from '../../security/protocol.js';
import type {DemoProfile} from '../../shared/api.js';
import type {Store} from '../db/store.js';
import {asCommandError, executeCommand} from '../domain/commands.js';
import type {IngestOutcome} from '../ingest/gateway.js';
import {publishedAnalytics, selectSnapshot} from '../read/analytics.js';
import {patientCaseView} from '../read/case-view.js';
import {GUIDE, devView} from '../read/dev-view.js';
import {staffCaseView, staffView} from '../read/staff-view.js';
import {fixtureById, primaryFixture} from '../simulator/fixtures.js';
import type {EventEnvelope} from '../../security/core.js';
import {actorOf, findSession, issueSession, sessionToken, sessionView} from './browser-session.js';
import {parseCommand, parseJson, parseProfileChange, parseSimulatorRequest, parseSnapshotChoice} from './validation.js';

/**
 * Декларативна таблиця API: шлях → метод → хто має право → обробник.
 * Порядок перевірок для кожного маршруту однаковий і живе в app.ts:
 * локальність → Origin → ліміт → (POST: сесія й CSRF) → роль → тіло → обробник → аудит.
 */

export interface Reply {
  status: number;
  body: unknown;
  /** Нова cookie сесії, якщо обробник її видав. */
  cookie?: string;
  /** Обробник сам записав аудит у своїй транзакції. */
  audited?: boolean;
}

export interface RouteContext {
  store: Store;
  request: IncomingMessage;
  now: number;
  /** Збіг шаблону шляху (для маршрутів із параметрами). */
  params: RegExpExecArray;
  /** Чинний контекст доступу; відсутній для маршрутів без ролі. */
  session: Session | undefined;
  /** Надсилає фіксовану подію симулятора через спільний шлюз із серверним підписом. */
  simulate(event: EventEnvelope): IngestOutcome;
}

/**
 * `public` — без сесії; `cookie` — чинна cookie-сесія без вимоги ролі (вибір ролі);
 * `authorized` — будь-яка роль із чинним грантом; масив — лише перелічені ролі.
 */
export type Access = 'public' | 'cookie' | 'authorized' | readonly DemoProfile[];

export interface Route {
  method: 'GET' | 'POST';
  pattern: RegExp;
  action: AuditAction;
  access: Access;
  /** Що записати в аудит як ресурс; типово — шлях. */
  resource?(params: RegExpExecArray): string;
  handle(context: RouteContext): Reply | Promise<Reply>;
}

const STAFF: readonly DemoProfile[] = ['commander', 'support'];
const CASE_ROLES: readonly DemoProfile[] = ['patient', 'commander', 'support'];
const CASE_ID = 'demo-[a-z0-9-]{1,60}';

const ok = (body: unknown): Reply => ({status: 200, body});

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  return parseJson(await readJsonBody(request));
}

function requireSessionContext(context: RouteContext): Session {
  if (!context.session) throw new Denied(401, 'authentication_required');
  return context.session;
}

/* ───────────── Сесія ───────────── */

const readSession: Route = {
  method: 'GET',
  pattern: /^\/api\/session$/,
  action: 'session_read',
  access: 'public',
  handle({store, request, now}) {
    const token = sessionToken(request);
    const existing = findSession(store, request, now);
    return store.transaction(() => {
      store.audit('session_read', 'allowed', 'anonymous', '/api/session', now, 'anonymous');
      if (existing && token) return {status: 200, body: sessionView(existing, token), audited: true};
      const issued = issueSession(store, null, token, now);
      return {status: 200, body: issued.view, cookie: issued.cookie, audited: true};
    });
  },
};

/** Навчальний вибір ролі. Нова сесія анулює попередню разом із її CSRF-токеном. */
const changeProfile: Route = {
  method: 'POST',
  pattern: /^\/api\/demo\/session$/,
  action: 'session_change',
  access: 'cookie',
  async handle({store, request, now}) {
    const profile = parseProfileChange(await jsonBody(request));
    return store.transaction(() => {
      const issued = issueSession(store, profile, sessionToken(request), now);
      const actor = profile ? actorOf(profile) : 'anonymous';
      store.audit('session_change', 'allowed', actor, '/api/demo/session', now, profile ?? 'anonymous');
      return {status: 200, body: issued.view, cookie: issued.cookie, audited: true};
    });
  },
};

/* ───────────── Читання ───────────── */

const readGuide: Route = {
  method: 'GET',
  pattern: /^\/api\/guide$/,
  action: 'case_read',
  access: 'public',
  resource: () => 'public-guide',
  handle: () => ok(GUIDE),
};

const readOwnCase: Route = {
  method: 'GET',
  pattern: /^\/api\/patient$/,
  action: 'case_read',
  access: ['patient'],
  handle(context) {
    const session = requireSessionContext(context);
    const caseId = [...session.caseIds][0];
    if (!caseId) throw new Denied(404, 'not_found');
    checkCase(session, caseId);
    return ok(patientCaseView(context.store, caseId));
  },
};

const readStaff: Route = {
  method: 'GET',
  pattern: /^\/api\/staff$/,
  action: 'case_read',
  access: STAFF,
  handle: context => ok(staffView(context.store, requireSessionContext(context))),
};

/** Кейс за ідентифікатором: чужий і відсутній кейс дають однакову 404. */
const readCase: Route = {
  method: 'GET',
  pattern: new RegExp(`^/api/cases/(${CASE_ID})$`),
  action: 'case_read',
  access: 'authorized',
  resource: params => params[1] ?? 'unknown',
  handle(context) {
    const session = requireSessionContext(context);
    const caseId = context.params[1] ?? '';
    checkCase(session, caseId);
    if (session.role === 'patient') return ok(patientCaseView(context.store, caseId));
    if (session.role === 'commander' || session.role === 'support') {
      return ok(staffCaseView(context.store, session.role, caseId));
    }
    throw new Denied(403, 'forbidden');
  },
};

/** Захищений клінічний ресурс: лише сам військовослужбовець; службовим ролям — 403. */
const readClinicalDocument: Route = {
  method: 'GET',
  pattern: new RegExp(`^/api/cases/(${CASE_ID})/clinical-document$`),
  action: 'clinical_read',
  access: 'authorized',
  resource: params => params[1] ?? 'unknown',
  handle(context) {
    checkCase(requireSessionContext(context), context.params[1] ?? '', true);
    return ok({status: 'synthetic_document', sample: 'Вигаданий навчальний зразок; медичного змісту немає'});
  },
};

const readAnalytics: Route = {
  method: 'GET',
  pattern: /^\/api\/analytics$/,
  action: 'analytics_read',
  access: ['analyst'],
  handle: ({store}) => ok(publishedAnalytics(store)),
};

const readDev: Route = {
  method: 'GET',
  pattern: /^\/api\/dev$/,
  action: 'case_read',
  access: ['dev'],
  handle: ({store}) => ok(devView(store)),
};

/* ───────────── Дії ───────────── */

const postCommand: Route = {
  method: 'POST',
  pattern: /^\/api\/commands$/,
  action: 'command',
  access: CASE_ROLES,
  async handle(context) {
    const command = parseCommand(await jsonBody(context.request));
    try {
      const result = executeCommand(context.store, requireSessionContext(context), command, context.now);
      return {status: 200, body: result, audited: true};
    } catch (error) {
      throw asCommandError(error);
    }
  },
};

function ingestReply(outcome: IngestOutcome): Reply {
  return {status: outcome.http, body: {status: outcome.status, business_applied: outcome.business_applied}, audited: true};
}

/** Конфлікт демонструється тією самою подією зі зміненим змістом під тим самим ключем. */
const CONFLICT_RECORDED_AT = '2026-11-12T10:00:00.000Z';

const simulateEvent: Route = {
  method: 'POST',
  pattern: /^\/api\/demo\/events$/,
  action: 'simulator_run',
  access: ['dev'],
  resource: () => 'fixed-fixture',
  async handle(context) {
    const {fixture: fixtureId, mode} = parseSimulatorRequest(await jsonBody(context.request));
    const fixture = fixtureById(fixtureId);
    if (!fixture) throw new Denied(400, 'fixed_fixture_only');
    const event = structuredClone(fixture.event);
    if (mode === 'conflict') event.recorded_at = CONFLICT_RECORDED_AT;
    const session = requireSessionContext(context);
    context.store.audit('simulator_run', 'allowed', session.actorId, 'fixed-fixture', context.now, session.role);
    return ingestReply(context.simulate(event));
  },
};

/** Сумісність із фазою 8а: одна фіксована еПМК без параметрів. */
const simulatePrimary: Route = {
  method: 'POST',
  pattern: /^\/api\/demo\/primary$/,
  action: 'simulator_run',
  access: ['dev'],
  resource: () => 'fixed-primary-fixture',
  async handle(context) {
    const body = await jsonBody(context.request);
    const empty = body !== null && typeof body === 'object' && !Array.isArray(body) && !Object.keys(body).length;
    if (!empty) throw new Denied(400, 'fixed_fixture_only');
    const session = requireSessionContext(context);
    context.store.audit('simulator_run', 'allowed', session.actorId, 'fixed-primary-fixture', context.now, session.role);
    return ingestReply(context.simulate(primaryFixture()));
  },
};

/** Перемикає, який із двох заздалегідь зафіксованих аналітичних зрізів опубліковано. */
const chooseSnapshot: Route = {
  method: 'POST',
  pattern: /^\/api\/demo\/analytics$/,
  action: 'simulator_run',
  access: ['dev'],
  resource: () => 'fixed-snapshot',
  async handle(context) {
    const snapshot = parseSnapshotChoice(await jsonBody(context.request));
    const session = requireSessionContext(context);
    context.store.transaction(() => {
      selectSnapshot(context.store, snapshot);
      context.store.audit('simulator_run', 'allowed', session.actorId, 'fixed-snapshot', context.now, session.role);
    });
    return {status: 200, body: {status: 'fixed_snapshot_selected'}, audited: true};
  },
};

export const ROUTES: readonly Route[] = [
  readSession,
  changeProfile,
  readGuide,
  readOwnCase,
  readStaff,
  readCase,
  readClinicalDocument,
  readAnalytics,
  readDev,
  postCommand,
  simulateEvent,
  simulatePrimary,
  chooseSnapshot,
];
