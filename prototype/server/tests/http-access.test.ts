import {test} from 'node:test';
import assert from 'node:assert/strict';
import {get as httpGet} from 'node:http';
import type {GuideView, PatientCaseView, SessionView, StaffView} from '../../shared/api.js';
import {createApp} from '../http/app.js';
import {withHarness} from './harness.js';

const errorCode = async (response: Response): Promise<string> => ((await response.json()) as {error: string}).error;

test('доступ: без сесії, чужий кейс, відкликаний грант діє на наступний запит, власний документ бійця', () =>
  withHarness(async h => {
    assert.equal((await h.get('/api/patient')).status, 401);
    await h.login('patient');
    assert.equal((await h.get('/api/cases/demo-case-02')).status, 404);
    assert.equal((await h.get('/api/cases/demo-case-01/clinical-document')).status, 200);
    h.store.run("UPDATE access_grant SET revoked_at='2026-11-13T00:00:00.000Z' WHERE id='demo-grant-patient'");
    assert.equal((await h.get('/api/patient')).status, 401);
  }));

test('доступ: проєкція командира й супроводу не має клінічних посилань, закладу, документів і виплат', () =>
  withHarness(async h => {
    for (const profile of ['commander', 'support'] as const) {
      await h.login(profile);
      assert.equal((await h.get('/api/cases/demo-case-01/clinical-document')).status, 403);
      const response = await h.get('/api/staff');
      assert.equal(response.status, 200);
      const body = (await response.json()) as StaffView;
      assert.equal(body.profile, profile);
      assert.equal(body.cases.length, 10);
      for (const item of body.cases) {
        for (const forbidden of ['care', 'timeline', 'documents', 'finances', 'timelineTotal']) {
          assert(!(forbidden in item), `${forbidden} не має бути в службовій проєкції`);
        }
      }
      const serialized = JSON.stringify(body);
      for (const marker of ['demo-record-', 'demo-provider-', 'demo-mis', 'demo-sedo', 'Умовний заклад']) {
        assert(!serialized.includes(marker), marker);
      }
      const single = await h.get('/api/cases/demo-case-01');
      assert.equal(single.status, 200);
      assert(!('finances' in ((await single.json()) as object)));
      assert.equal((await h.get('/api/cases/demo-case-11')).status, 404);
    }
  }));

test('доступ: командир і супровід мають різні доступні дії; причина недоступності названа', () =>
  withHarness(async h => {
    const actions = async () => {
      const view = (await (await h.get('/api/staff')).json()) as StaffView;
      const first = view.cases.find(item => item.id === 'demo-case-01');
      assert(first);
      return Object.fromEntries(first.actions.map(item => [item.action, item.reason]));
    };
    await h.login('support');
    assert.equal((await actions()).issue_certificate, 'commander_only');
    assert.equal((await actions()).refer_vlk, 'commander_only');
    await h.login('commander');
    const commander = await actions();
    assert.equal(commander.issue_certificate, 'certificate_not_prepared');
    assert.equal(commander.refer_vlk, null);
    assert.equal(commander.verify_copy, 'no_pending_copy');
  }));

test('доступ: зміна ролі анулює старий токен; CSRF, Origin, Host, метод і query тримають межі', () =>
  withHarness(async h => {
    await h.login('patient');
    const oldCookie = h.cookie;
    const oldCsrf = h.csrf;
    assert.equal((await h.post('/api/demo/session', {profile: 'dev'}, {'x-csrf-token': '0'.repeat(64)})).status, 403);
    assert.equal((await h.post('/api/demo/session', {profile: 'dev'}, {origin: 'https://example.invalid'})).status, 403);
    const wrongHost = await new Promise<number>(resolve => {
      httpGet(`${h.origin}/api/patient`, {headers: {host: 'example.invalid', cookie: h.cookie}}, response => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      });
    });
    assert.equal(wrongHost, 403);
    assert.equal((await h.get('/api/patient?role=dev')).status, 400);
    assert.equal((await h.post('/api/demo/session', {profile: 'dev', actor: 'demo-dev'})).status, 400);
    assert.equal((await h.post('/api/demo/session', {profile: 'admin'})).status, 400);

    await h.login('dev');
    assert.notEqual(h.cookie, oldCookie);
    assert.notEqual(h.csrf, oldCsrf);
    assert.equal((await h.get('/api/dev', {cookie: oldCookie})).status, 401);
    assert.equal((await h.get('/api/patient')).status, 403);
    assert.equal((await h.get('/api/analytics')).status, 403);
    // Старий CSRF-токен із новою сесією не працює.
    assert.equal((await h.post('/api/demo/session', {profile: 'patient'}, {'x-csrf-token': oldCsrf})).status, 403);
  }));

test('доступ: метод, тип і розмір тіла, невідомий шлях — єдиний формат помилок', () =>
  withHarness(async h => {
    await h.login('support');
    const wrongMethod = await h.post('/api/staff', {});
    assert.equal(wrongMethod.status, 405);
    assert.equal(await errorCode(wrongMethod), 'method_not_allowed');
    assert.equal((await h.get('/api/commands')).status, 405);
    assert.equal((await h.get('/api/unknown')).status, 404);

    const notJson = await h.post('/api/commands', {}, {'content-type': 'text/plain'});
    assert.equal(notJson.status, 415);
    const tooLarge = await h.post('/api/commands', {id: 'demo-x', case_id: 'demo-case-01', action: 'clarify', pad: 'x'.repeat(20_000)});
    assert.equal(tooLarge.status, 413);
    const broken = await fetch(`${h.origin}/api/commands`, {
      method: 'POST',
      headers: {cookie: h.cookie, origin: h.origin, 'content-type': 'application/json', 'x-csrf-token': h.csrf},
      body: '{not json',
    });
    assert.equal(broken.status, 400);
    assert.equal(await errorCode(broken), 'invalid_json');
    const unknownAction = await h.post('/api/commands', {id: 'demo-a', case_id: 'demo-case-01', action: 'delete_case'});
    assert.equal(unknownAction.status, 400);
    assert.equal((await h.post('/api/commands', {id: 'demo-a', case_id: 'demo-case-01', action: 'clarify', role: 'commander'})).status, 400);
    // Анонімний запит не дізнається, чи існує шлях.
    assert.equal((await fetch(`${h.origin}/api/unknown`)).status, 401);
  }));

test('доступ: заголовки безпеки є на успішних відповідях, помилках і статиці', () =>
  withHarness(async h => {
    const expectHeaders = (response: Response): void => {
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert(response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
    };
    const denied = await h.get('/api/patient');
    assert.equal(denied.status, 401);
    expectHeaders(denied);
    assert.equal(denied.headers.get('content-security-policy')?.startsWith("default-src 'none'"), true);
    await h.login('analyst');
    expectHeaders(await h.get('/api/analytics'));
    const home = await h.get('/');
    assert.equal(home.status, 200);
    expectHeaders(home);
    const csp = home.headers.get('content-security-policy') ?? '';
    assert(csp.includes("script-src 'self'"));
    assert(!csp.includes('unsafe-inline'));
    assert.equal((await h.get('/assets/../server/main.ts')).status, 404);
    assert.equal((await h.get('/.env')).status, 404);
  }));

test('доступ: ліміт частоти дає 429 з Retry-After, не довіряє X-Forwarded-For і не роздуває аудит', () =>
  withHarness(async h => {
    await h.login('support');
    const before = h.count('SELECT COUNT(*) AS n FROM audit_entry');
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const response = await h.get('/api/staff', {'x-forwarded-for': `10.0.0.${i}`});
      statuses.push(response.status);
      if (response.status === 429) {
        assert.equal(response.headers.get('retry-after'), '60');
        assert.equal(await errorCode(response), 'rate_limited');
      } else {
        await response.arrayBuffer();
      }
    }
    assert(statuses.includes(200));
    assert.equal(statuses.at(-1), 429);
    const limited = statuses.filter(status => status === 429).length;
    assert(limited >= 3);
    // Аудит записано лише для дозволених читань, не для кожної відмови за лімітом.
    assert.equal(h.count('SELECT COUNT(*) AS n FROM audit_entry') - before, statuses.length - limited);
  }, {readLimit: 8}));

test('доступ: кожна відмова лишає запис аудиту без ідентифікаторів і секретів', () =>
  withHarness(async h => {
    await h.login('commander');
    const denied = () => h.count("SELECT COUNT(*) AS n FROM audit_entry WHERE result_code='denied'");
    const before = denied();
    assert.equal((await h.get('/api/cases/demo-case-11')).status, 404);
    assert.equal((await h.get('/api/cases/demo-case-01/clinical-document')).status, 403);
    assert.equal((await h.get('/api/analytics')).status, 403);
    assert.equal(denied(), before + 3);
    const clinical = h.store.row("SELECT action_code,role FROM audit_entry WHERE action_code='clinical_read' AND result_code='denied'");
    assert.equal(clinical?.role, 'commander');
    const all = JSON.stringify(h.store.rows('SELECT * FROM audit_entry'));
    for (const secret of ['demo-commander', 'demo-case-11', 'demo-case-01', h.cookie.split('=')[1] ?? 'missing', h.csrf]) {
      assert(!all.includes(secret), secret);
    }
  }));

test('доступ: збій аудиту забороняє читання', () =>
  withHarness(async h => {
    await h.login('patient');
    h.store.db.exec("CREATE TRIGGER reject_all BEFORE INSERT ON audit_entry BEGIN SELECT RAISE(ABORT,'demo_failure'); END;");
    const response = await h.get('/api/patient');
    assert.equal(response.status, 503);
    assert.equal(await errorCode(response), 'audit_unavailable');
  }));

test('доступ: застосунок відмовляється від production і не-loopback; cookie та аудит не розкривають секретів', () =>
  withHarness(async h => {
    assert.throws(() => createApp({...h.appOptions, origin: 'http://0.0.0.0:4317'}));
    assert.throws(() => createApp({...h.appOptions, origin: 'https://127.0.0.1:4317'}));
    const session = await fetch(`${h.origin}/api/session`);
    const cookie = session.headers.get('set-cookie') ?? '';
    assert(cookie.includes('HttpOnly') && cookie.includes('SameSite=Strict') && cookie.includes('Max-Age=900'));
    const view = (await session.json()) as SessionView;
    assert.equal(view.profile, null);
    assert.equal(view.expiresAt - Date.parse('2026-11-13T12:00:00.000Z'), 900_000);

    await h.login('patient');
    const all = JSON.stringify(h.store.rows('SELECT * FROM audit_entry'));
    const sourceSecret = [...h.keys.values()][0]?.secret.toString('hex') ?? 'missing';
    for (const sentinel of [h.cookie.split('=')[1] ?? 'missing', sourceSecret, 'demo-person-01']) {
      assert(!all.includes(sentinel));
    }
  }));

test('доступ: загальний гайд доступний без сесії й без ролі', () =>
  withHarness(async h => {
    const response = await fetch(`${h.origin}/api/guide`);
    assert.equal(response.status, 200);
    const guide = (await response.json()) as GuideView;
    assert(guide.steps.length >= 3);
    assert(guide.steps.some(step => step.includes('Споріднення')));
  }));

test('доступ: відповідь бійця не містить технічних ключів джерел, правил чи записів', () =>
  withHarness(async h => {
    for (const id of ['primary', 'admit', 'patient-receipt', 'certificate-prepared', 'reward-packet', 'reward-approved']) {
      await h.accepted(id);
    }
    await h.login('patient');
    const response = await h.get('/api/patient');
    const text = await response.text();
    for (const marker of ['demo-mis', 'demo-sedo', 'demo-finance', 'demo-record-', 'demo-primary-d1', 'demo-source-proof', 'demo-provider-']) {
      assert(!text.includes(marker), marker);
    }
    const view = JSON.parse(text) as PatientCaseView;
    assert.equal(view.id, 'demo-case-01');
    assert.equal(view.care.facility, 'Умовний заклад 01');
  }));
