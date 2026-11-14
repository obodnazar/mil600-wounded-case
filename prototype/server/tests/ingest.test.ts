import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {signature, type SourceKey} from '../../security/core.js';
import {validateEvent} from '../../security/protocol.js';
import type {AnalyticsView} from '../../shared/api.js';
import {Store} from '../db/store.js';
import {createApp, type AppOptions} from '../http/app.js';
import {fixtures, primaryFixture} from '../simulator/fixtures.js';
import {dispatchLocalOutbox} from '../workers.js';
import {NOW, fixtureEvent, variant, withHarness} from './harness.js';

/** Одне джерело з вузькими правами — як у перевірках фази 8а. */
function singleSource(): Map<string, SourceKey> {
  const key: SourceKey = {
    id: 'demo-mis',
    source: 'demo-mis',
    secret: randomBytes(32),
    types: new Set(['medical.primary_recorded', 'care.admitted']),
    subjects: new Set(['demo-person-01']),
  };
  return new Map([[key.id, key]]);
}

test('шлюз: усі фікстури відповідають строгим схемам; довільне медичне поле відхиляється', () => {
  for (const item of fixtures) assert(validateEvent(item.event), `${item.id}: ${JSON.stringify(validateEvent.errors)}`);
  const withDiagnosis = fixtureEvent('primary');
  withDiagnosis.payload.diagnosis = 'SYNTHETIC_FORBIDDEN';
  assert.equal(validateEvent(withDiagnosis), false);
  const withoutChannel = fixtureEvent('civil');
  delete withoutChannel.payload.source_channel;
  assert.equal(validateEvent(withoutChannel), false);
});

test('шлюз: підпис і схема перед стійким записом; nonce та обидва ключі дедуплікації переживають рестарт', () =>
  withHarness(async h => {
    const nonce = randomBytes(16).toString('hex');
    const first = await h.send(primaryFixture(), nonce);
    assert.equal(first.status, 202);
    assert.deepEqual(await first.json(), {status: 'accepted', business_applied: true});

    // Новий Store і новий застосунок над тим самим файлом: жодної спільної пам'яті.
    const store = new Store(h.path, h.auditKey);
    const events = store.count('SELECT COUNT(*) AS n FROM case_event');
    const options: AppOptions = {...h.appOptions, store, origin: 'http://127.0.0.1:0'};
    const second = createApp(options);
    second.listen(0, '127.0.0.1');
    await once(second, 'listening');
    const address = second.address();
    assert(address && typeof address !== 'string');
    options.origin = `http://127.0.0.1:${address.port}`;
    const key = h.keys.get('demo-mis');
    assert(key);
    const deliver = (body: Buffer, requestNonce: string): Promise<Response> => {
      const signed = {keyId: key.id, timestamp: String(NOW / 1000), nonce: requestNonce};
      return fetch(`${options.origin}/api/integration/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-key-id': signed.keyId,
          'x-timestamp': signed.timestamp,
          'x-nonce': signed.nonce,
          'x-signature': signature(key.secret, signed, body),
        },
        body: body.toString('utf8'),
      });
    };
    try {
      // Та сама ревізія потоку з новим event_id — дублікат за другим ключем.
      const sameRevision = Buffer.from(JSON.stringify({...primaryFixture(), event_id: 'demo-new-id-same-revision'}));
      const duplicate = await deliver(sameRevision, randomBytes(16).toString('hex'));
      assert.equal(duplicate.status, 200);
      assert.equal(((await duplicate.json()) as {status: string}).status, 'duplicate');
      // Той самий nonce після рестарту — повтор транспорту.
      assert.equal((await deliver(Buffer.from(JSON.stringify(primaryFixture())), nonce)).status, 409);
      assert.equal(store.count('SELECT COUNT(*) AS n FROM case_event'), events);
      assert.equal(store.count('SELECT COUNT(*) AS n FROM outbox'), 1);
    } finally {
      second.closeAllConnections();
      await new Promise<void>(resolve => second.close(() => resolve()));
      store.close();
    }
  }, {file: true, keys: singleSource()}));

test('шлюз: конфлікт створює один розбір без перезапису; непрозора версія не змінює порядок мовчки', () =>
  withHarness(async h => {
    assert.equal((await h.send(primaryFixture())).status, 202);
    const events = h.count('SELECT COUNT(*) AS n FROM case_event');
    const changed = {...primaryFixture(), payload: {document_kind: 'primary_medical_card', document_version: 'v2'}};
    for (let attempt = 0; attempt < 3; attempt++) assert.equal((await h.send(changed)).status, 409);
    const later = await h.ingest({...primaryFixture(), event_id: 'demo-later', source_version: 'v0'});
    assert.equal(later.http, 202);
    assert.equal(later.status, 'pending_review');
    assert.equal(h.count('SELECT COUNT(*) AS n FROM case_event'), events);
    // Три повтори суперечливої версії — один відкритий розбір.
    assert.equal(h.count("SELECT COUNT(*) AS n FROM review_item WHERE reason_code='event_conflict'"), 1);
    assert.equal(h.store.row("SELECT freshness_state FROM wound_case WHERE id='demo-case-01'")?.freshness_state, 'conflict');
  }, {keys: singleSource()}));

test('шлюз: збій аудиту відкочує inbox, домен, задачу й outbox; повтор із новим nonce проходить', () =>
  withHarness(async h => {
    const before = h.count('SELECT COUNT(*) AS n FROM case_event');
    h.store.db.exec(
      "CREATE TRIGGER reject_accept BEFORE INSERT ON audit_entry WHEN NEW.result_code='accepted' " +
      "BEGIN SELECT RAISE(ABORT,'synthetic_audit_failure'); END;",
    );
    assert.equal((await h.send(primaryFixture())).status, 503);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM inbox_event'), 0);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM case_event'), before);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM outbox'), 0);
    h.store.db.exec('DROP TRIGGER reject_accept');
    assert.equal((await h.send(primaryFixture())).status, 202);

    dispatchLocalOutbox(h.store);
    assert.equal(h.store.row('SELECT state FROM outbox')?.state, 'delivered_local');
    dispatchLocalOutbox(h.store);
    assert.equal(h.store.row('SELECT attempt_count FROM outbox')?.attempt_count, 1);
  }, {keys: singleSource()}));

test('шлюз: dev-симулятор іде тим самим шляхом; без довільного payload і без нових грантів', () =>
  withHarness(async h => {
    await h.login('commander');
    assert.equal((await h.post('/api/demo/primary', {})).status, 403);
    assert.equal((await h.post('/api/demo/events', {fixture: 'primary'})).status, 403);
    await h.login('dev');
    assert.equal((await h.post('/api/demo/primary', {subject_ref: 'demo-person-02'})).status, 400);
    assert.equal((await h.post('/api/demo/events', {fixture: 'primary', payload: {}})).status, 400);
    assert.equal((await h.post('/api/demo/events', {fixture: 'no-such-fixture'})).status, 400);
    const grants = h.count('SELECT COUNT(*) AS n FROM access_grant');
    assert.equal((await h.post('/api/demo/primary', {})).status, 202);
    assert.equal((await h.post('/api/demo/primary', {})).status, 200);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM inbox_event'), 1);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM access_grant'), grants);
    // Відповідь dev-панелі не містить ключів чи технічних назв джерел.
    const dev = await (await h.get('/api/dev')).text();
    for (const key of h.keys.values()) assert(!dev.includes(key.secret.toString('hex')));
    assert(!dev.includes('demo-mis'));
  }));

test('шлюз: чуже джерело, тип чи особа — 403; зайве клінічне поле — 400; аналітика без рядків', () =>
  withHarness(async h => {
    const withDiagnosis = {...primaryFixture(), payload: {...primaryFixture().payload, diagnosis: 'TEST_PRIVATE_SENTINEL'}};
    assert.equal((await h.send(withDiagnosis)).status, 400);
    assert.equal((await h.send({...primaryFixture(), subject_ref: 'demo-person-02'})).status, 403);
    const foreignSource = {...primaryFixture(), source_system: 'demo-finance'};
    const key = h.keys.get('demo-mis');
    assert(key);
    const raw = Buffer.from(JSON.stringify(foreignSource));
    const signed = {keyId: key.id, timestamp: String(NOW / 1000), nonce: randomBytes(16).toString('hex')};
    const forged = await fetch(`${h.origin}/api/integration/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-key-id': signed.keyId,
        'x-timestamp': signed.timestamp,
        'x-nonce': signed.nonce,
        'x-signature': signature(key.secret, signed, raw),
      },
      body: raw,
    });
    assert.equal(forged.status, 403);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM inbox_event'), 0);
    assert(!JSON.stringify(h.store.rows('SELECT * FROM audit_entry')).includes('TEST_PRIVATE_SENTINEL'));

    await h.login('analyst');
    const response = await h.get('/api/analytics');
    assert.equal(response.status, 200);
    const report = (await response.json()) as AnalyticsView;
    assert.equal(report.metrics.length, 6);
    assert(!JSON.stringify(report).includes('demo-person-'));
    assert(!('total' in report));
    assert.equal((await h.get('/api/analytics?unit=demo-unit-1')).status, 400);
    assert.equal((await h.get('/api/cases/demo-case-01')).status, 403);
  }, {keys: singleSource()}));

test('шлюз: неправильний підпис, змінене тіло, застарілий час і невідомий ключ — 401 без запису', () =>
  withHarness(async h => {
    const key = h.keys.get('demo-mis');
    assert(key);
    const raw = Buffer.from(JSON.stringify(primaryFixture()));
    const request = (headers: Record<string, string>, body: Buffer = raw): Promise<Response> =>
      fetch(`${h.origin}/api/integration/events`, {
        method: 'POST',
        headers: {'content-type': 'application/json', ...headers},
        body: body.toString('utf8'),
      });
    const signed = (timestamp: number, secret = key.secret, keyId = key.id): Record<string, string> => {
      const base = {keyId, timestamp: String(Math.floor(timestamp / 1000)), nonce: randomBytes(16).toString('hex')};
      return {
        'x-key-id': base.keyId,
        'x-timestamp': base.timestamp,
        'x-nonce': base.nonce,
        'x-signature': signature(secret, base, raw),
      };
    };
    assert.equal((await request(signed(NOW, randomBytes(32)))).status, 401);
    assert.equal((await request(signed(NOW), Buffer.from(JSON.stringify({...primaryFixture(), subject_ref: 'demo-person-02'})))).status, 401);
    assert.equal((await request(signed(NOW - 301_000))).status, 401);
    assert.equal((await request(signed(NOW, key.secret, 'demo-unknown'))).status, 401);
    assert.equal((await request({})).status, 401);
    assert.equal((await fetch(`${h.origin}/api/integration/events`)).status, 405);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM inbox_event'), 0);
  }, {keys: singleSource()}));

test('шлюз: новий перевірений випадок відкриває кейс без вигаданої дати й без гранта; невідома особа чекає', () =>
  withHarness(async h => {
    const grants = h.count('SELECT COUNT(*) AS n FROM access_grant');
    const second = {...primaryFixture(), event_id: 'demo-second-incident-event', source_stream: 'demo-second-incident-stream', incident_ref: 'demo-second-incident'};
    assert.equal((await h.send(second)).status, 202);
    const added = h.store.row("SELECT id,injury_date,injury_date_assurance FROM wound_case WHERE incident_ref='demo-second-incident'");
    assert(added);
    assert.equal(added.injury_date, null);
    assert.equal(added.injury_date_assurance, 'unknown');
    assert.equal(h.count('SELECT COUNT(*) AS n FROM access_grant'), grants);
    await h.login('patient');
    assert.equal((await h.get(`/api/cases/${String(added.id)}`)).status, 404);

    const key = h.keys.get('demo-mis');
    assert(key);
    (key.subjects as Set<string>).add('demo-unmapped');
    const unknown = await h.ingest({...primaryFixture(), event_id: 'demo-unmapped-event', source_stream: 'demo-unmapped-stream', subject_ref: 'demo-unmapped'});
    assert.equal(unknown.http, 202);
    assert.equal(unknown.status, 'pending_review');
    assert.equal(h.count('SELECT COUNT(*) AS n FROM wound_case'), 31);
  }, {keys: singleSource()}));

test('шлюз: одночасні доставки дають один стійкий ефект', () =>
  withHarness(async h => {
    const results = await Promise.all(Array.from({length: 5}, () => h.send(primaryFixture())));
    assert.deepEqual(results.map(response => response.status).sort(), [200, 200, 200, 200, 202]);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM inbox_event'), 1);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM outbox'), 1);
  }, {keys: singleSource()}));

test('шлюз: подія раніше за попередника чекає; повторна доставка застосовує її рівно один раз', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted('certificate-prepared');
    // Квитанція ВЛК надійшла раніше за видачу — на розбір, кейс позначено суперечністю.
    await h.pending('certificate-received');
    assert.deepEqual(h.reviewReasons(), ['receipt_before_issue']);
    assert.equal(h.store.row("SELECT freshness_state FROM wound_case WHERE id='demo-case-01'")?.freshness_state, 'conflict');
    // Повтор, поки попередника немає: стан той самий, другого розбору немає.
    const still = await h.ingest('certificate-received');
    assert.deepEqual([still.http, still.status], [200, 'pending_review']);
    assert.equal(h.reviewReasons().length, 1);

    await h.login('commander');
    assert.equal((await h.command('issue_certificate')).status, 200);
    await h.accepted('certificate-issued');
    const before = h.sizes();
    // Тепер попередник є: та сама подія застосовується.
    const applied = await h.ingest('certificate-received');
    assert.deepEqual([applied.http, applied.status, applied.business_applied], [202, 'accepted', true]);
    assert.deepEqual(h.reviewReasons(), []);
    assert.equal(h.store.row("SELECT freshness_state FROM wound_case WHERE id='demo-case-01'")?.freshness_state, 'fresh');
    assert.equal(h.count("SELECT COUNT(*) AS n FROM delivery WHERE state='received' AND recipient_ref='demo-vlk' AND receipt_ref='demo-source-proof'"), 1);
    assert.equal(h.sizes()[1], (before[1] ?? 0) + 1);
    // Ще одна доставка — уже звичайний дублікат без ефекту.
    const after = h.sizes();
    const duplicate = await h.ingest('certificate-received');
    assert.deepEqual([duplicate.http, duplicate.status], [200, 'duplicate']);
    assert.deepEqual(h.sizes(), after);
  }));

test('шлюз: відмова домену не губить подію — вона лишається в inbox на розборі, а не дає 5xx', () =>
  withHarness(async h => {
    await h.accepted('primary');
    // Порушення обмеження БД усередині застосування події (імітація дефекту домену).
    h.store.db.exec("CREATE TRIGGER reject_episode BEFORE INSERT ON treatment_episode BEGIN SELECT RAISE(ABORT,'demo_domain_failure'); END;");
    const result = await h.ingest('admit');
    assert.deepEqual([result.http, result.status, result.business_applied], [202, 'pending_review', false]);
    assert.deepEqual(h.reviewReasons(), ['unprocessable_event']);
    assert.equal(h.count("SELECT COUNT(*) AS n FROM inbox_event WHERE processing_state='pending_review'"), 1);
    assert.equal(h.count("SELECT COUNT(*) AS n FROM case_event WHERE event_type='care.admitted'"), 0);
    h.store.db.exec('DROP TRIGGER reject_episode');
    await h.accepted('admit');
    assert.deepEqual(h.reviewReasons(), []);
  }));

test('шлюз: нова доставка іншої події після рестарту не дублює і не губить попередні підтвердження', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted('patient-receipt');
    const reopened = new Store(h.path, h.auditKey);
    try {
      assert.equal(reopened.row("SELECT due_date FROM deadline WHERE case_id='demo-case-01' AND rule_version_id='demo-rule-certificate'")?.due_date, '2026-11-15');
      assert.equal(reopened.count('SELECT COUNT(*) AS n FROM inbox_event'), 2);
    } finally {
      reopened.close();
    }
    const again = await h.ingest(variant('patient-receipt', 'demo-receipt-redelivered', event => {
      event.source_stream = 'demo-stream-patient-receipt';
    }));
    assert.equal(again.status, 'duplicate');
  }, {file: true}));
