import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {signature, type EventEnvelope, type SourceKey} from '../../security/core.js';
import type {CommandAction, DemoProfile, IngestResult, SessionView} from '../../shared/api.js';
import {ephemeralSourceKeys} from '../config/keys.js';
import {Store} from '../db/store.js';
import {createApp, type AppOptions} from '../http/app.js';
import {fixtures} from '../simulator/fixtures.js';

/**
 * Тестовий каркас: справжній HTTP-застосунок на випадковому порту loopback і власна
 * SQLite (у пам'яті або в тимчасовому файлі). Користувацьку `.runtime` не чіпає.
 * Поведінка перевіряється через HTTP, а результат — ще й прямим читанням БД.
 */

export const NOW = Date.parse('2026-11-13T12:00:00.000Z');

export interface HarnessOptions {
  /** true — БД у тимчасовому файлі (для перевірок рестарту й прав доступу до файлу). */
  file?: boolean;
  keys?: Map<string, SourceKey>;
  readLimit?: number;
  ingressLimit?: number;
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;

export function fixtureEvent(id: string): EventEnvelope {
  const item = fixtures.find(candidate => candidate.id === id);
  assert(item, `невідома фікстура ${id}`);
  return structuredClone(item.event);
}

/** Копія фікстури з новим ідентифікатором і потоком — «інша доставка» від того самого джерела. */
export function variant(id: string, eventId: string, change: (event: EventEnvelope) => void = () => undefined): EventEnvelope {
  const event = fixtureEvent(id);
  event.event_id = eventId;
  event.source_stream = eventId;
  change(event);
  return event;
}

/** Наступна версія того самого потоку з явним посиланням на попередню. */
export function nextVersion(id: string, eventId: string, version: string, supersedes: string): EventEnvelope {
  const event = fixtureEvent(id);
  event.event_id = eventId;
  event.source_version = version;
  event.supersedes_version = supersedes;
  if ('document_version' in event.payload) event.payload.document_version = version;
  return event;
}

export async function startHarness(options: HarnessOptions = {}) {
  const dir = options.file ? await mkdtemp(join(tmpdir(), 'mil600-test-')) : null;
  const path = dir ? join(dir, 'demo.sqlite') : ':memory:';
  const auditKey = randomBytes(32);
  const keys = options.keys ?? ephemeralSourceKeys();
  const store = new Store(path, auditKey);
  let now = NOW;
  const appOptions: AppOptions = {
    store,
    keys,
    origin: 'http://127.0.0.1:0',
    now: () => now,
    readLimit: options.readLimit ?? 10_000,
    ingressLimit: options.ingressLimit ?? 10_000,
  };
  const server = createApp(appOptions);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  appOptions.origin = `http://127.0.0.1:${address.port}`;
  const origin = appOptions.origin;

  let cookie = '';
  let csrf = '';

  const remember = async (response: Response): Promise<void> => {
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0] ?? '';
    csrf = ((await response.json()) as SessionView).csrf;
  };

  const get = (route: string, extra: Record<string, string> = {}): Promise<Response> =>
    fetch(origin + route, {headers: {cookie, ...extra}});

  const post = (route: string, body: unknown, extra: Record<string, string> = {}): Promise<Response> =>
    fetch(origin + route, {
      method: 'POST',
      headers: {cookie, origin, 'content-type': 'application/json', 'x-csrf-token': csrf, ...extra},
      body: JSON.stringify(body),
    });

  /** Обирає демо-роль так само, як це робить браузер. */
  const login = async (profile: DemoProfile): Promise<void> => {
    await remember(await get('/api/session'));
    const changed = await post('/api/demo/session', {profile});
    assert.equal(changed.status, 200);
    await remember(changed);
  };

  /** Надсилає подію через зовнішній endpoint шлюзу з коректним підписом джерела. */
  const send = (value: string | EventEnvelope, nonce = randomBytes(16).toString('hex')): Promise<Response> => {
    const event = typeof value === 'string' ? fixtureEvent(value) : value;
    const key = keys.get(event.source_system);
    assert(key, `немає ключа джерела ${event.source_system}`);
    const raw = Buffer.from(JSON.stringify(event));
    const signed = {keyId: key.id, timestamp: String(Math.floor(now / 1000)), nonce};
    return fetch(`${origin}/api/integration/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-key-id': signed.keyId,
        'x-timestamp': signed.timestamp,
        'x-nonce': nonce,
        'x-signature': signature(key.secret, signed, raw),
      },
      body: raw,
    });
  };

  const ingest = async (value: string | EventEnvelope): Promise<IngestResult & {http: number}> => {
    const response = await send(value);
    return {...((await response.json()) as IngestResult), http: response.status};
  };

  /** Подія має бути прийнята й застосована. */
  const accepted = async (value: string | EventEnvelope): Promise<void> => {
    const label = typeof value === 'string' ? value : value.event_id;
    const result = await ingest(value);
    assert.deepEqual(result, {status: 'accepted', business_applied: true, http: 202}, label);
  };

  /** Подія має бути збережена на розбір без зміни бізнес-стану. */
  const pending = async (value: string | EventEnvelope): Promise<void> => {
    const label = typeof value === 'string' ? value : value.event_id;
    const result = await ingest(value);
    assert.equal(result.status, 'pending_review', label);
    assert.equal(result.business_applied, false, label);
  };

  const command = (
    action: CommandAction, caseId = 'demo-case-01', option?: string, id = `demo-${randomUUID()}`,
  ): Promise<Response> => post('/api/commands', {id, case_id: caseId, action, ...(option ? {option} : {})});

  const count = (sql: string, ...values: string[]): number => store.count(sql, ...values);

  /** Розміри таблиць, які не мають змінюватися від повтору. */
  const sizes = (): number[] =>
    ['wound_case', 'case_event', 'task', 'outbox', 'document_ref', 'access_grant']
      .map(table => store.count(`SELECT COUNT(*) AS n FROM ${table}`));

  const reviewReasons = (): string[] =>
    store.rows("SELECT reason_code FROM review_item WHERE state='open' AND inbox_event_id IS NOT NULL ORDER BY rowid")
      .map(row => String(row.reason_code));

  const close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
    if (dir) await rm(dir, {recursive: true, force: true});
  };

  return {
    store, server, keys, origin, auditKey, path, dir, appOptions,
    get, post, login, send, ingest, accepted, pending, command, count, sizes, reviewReasons, close,
    setNow(value: number) { now = value; },
    get cookie() { return cookie; },
    get csrf() { return csrf; },
  };
}

/** Запускає тест із власним каркасом і гарантовано його закриває. */
export async function withHarness(work: (harness: Harness) => Promise<void>, options: HarnessOptions = {}): Promise<void> {
  const harness = await startHarness(options);
  try {
    await work(harness);
  } finally {
    await harness.close();
  }
}
