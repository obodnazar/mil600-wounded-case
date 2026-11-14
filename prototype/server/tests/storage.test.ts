import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../db/store.js';
import {NOW, withHarness} from './harness.js';

test('БД: міграції та seed повторювані; 30 кейсів, 3 групи, 9 закладів; файл приватний', () =>
  withHarness(async h => {
    const again = new Store(h.path, h.auditKey);
    assert.equal(again.count('SELECT COUNT(*) AS n FROM wound_case'), 30);
    assert.equal(again.count('SELECT COUNT(*) AS n FROM schema_migration'), 4);
    again.close();

    assert.equal(h.count('SELECT COUNT(*) AS n FROM demo_unit'), 3);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM demo_provider'), 9);
    assert.equal((await stat(h.path)).mode & 0o777, 0o600);
    assert.deepEqual(h.store.rows('PRAGMA foreign_key_check'), []);
    // Строк не існує без підтвердженого початку відліку.
    assert.equal(h.count("SELECT COUNT(*) AS n FROM deadline WHERE anchor_status!='confirmed' AND due_date IS NOT NULL"), 0);
    assert.equal(
      h.count(
        `SELECT COUNT(DISTINCT c.lifecycle_state) AS n FROM wound_case c
           JOIN unit_assignment u ON u.subject_id=c.subject_id WHERE u.unit_ref='demo-unit-1'`,
      ),
      6,
    );
    // Підтверджений якір ніколи не передує внесенню первинного запису.
    assert.equal(
      h.count(
        `SELECT COUNT(*) AS n FROM deadline d
           JOIN case_event a ON a.id=d.anchor_event_id
           JOIN case_event p ON p.case_id=d.case_id AND p.event_type='medical.primary_recorded'
          WHERE d.anchor_status='confirmed' AND a.occurred_at<p.recorded_at`,
      ),
      0,
    );
  }, {file: true}));

test('БД: сесія не зберігає CSRF-токен; задача пам’ятає подію, що її відкрила', () =>
  withHarness(async h => {
    const sessionColumns = h.store.rows("SELECT name FROM pragma_table_info('demo_session')").map(row => row.name);
    assert.deepEqual(sessionColumns, ['token_hash', 'actor_id', 'profile', 'expires_at']);
    await h.login('patient');
    const stored = JSON.stringify(h.store.rows('SELECT * FROM demo_session'));
    assert(!stored.includes(h.csrf));
    assert(!stored.includes(h.cookie.split('=')[1] ?? 'missing'));
    const taskColumns = h.store.rows("SELECT name FROM pragma_table_info('task')").map(row => row.name);
    assert(taskColumns.includes('opened_by_event'));
  }));

test('БД: чужі докази, непідтверджений строк, невиконана виплата, зміна аудиту й пакета заблоковані', () =>
  withHarness(async h => {
    const {store} = h;
    assert.throws(() => store.run(
      `INSERT INTO requirement_evidence VALUES
       ('demo-bad','demo-case-01','demo-req-primary_medical_card-01','demo-doc-primary_medical_card-02','technical_match','demo-proof')`,
    ));
    assert.throws(() => store.run("UPDATE deadline SET due_date='2026-11-15' WHERE id='demo-deadline-01'"));
    assert.throws(() => store.run("UPDATE deadline SET anchor_event_id='demo-receipt-anchor-02' WHERE id='demo-deadline-01'"));
    assert.throws(() => store.run("UPDATE task SET deadline_id='demo-deadline-02' WHERE id='demo-task-01'"));
    assert.throws(() => store.run("UPDATE financial_track SET current_status='executed' WHERE id='demo-finance-reward-01'"));
    store.audit('case_read', 'allowed', 'demo-actor', 'demo-case', NOW);
    assert.throws(() => store.run("UPDATE audit_entry SET result_code='allowed'"));
    assert.throws(() => store.run('DELETE FROM audit_entry'));
    assert.throws(() => store.run("UPDATE case_requirement SET packet_revision='v2' WHERE id='demo-req-primary_medical_card-01'"));
    assert.throws(() => store.run("UPDATE case_event SET event_type='changed'"), /append_only_events/);
  }));

test('БД: перетин перевірених прив’язок особи чи призначень відхиляється; різні випадки однієї особи дозволені', () =>
  withHarness(async h => {
    const {store} = h;
    assert.throws(() => store.run(
      "INSERT INTO identity_link VALUES ('demo-bad','demo-person-02','demo-mis','demo-person-01','verified','demo-proof','2026-11-01',NULL)",
    ));
    assert.throws(() => store.run(
      "INSERT INTO unit_assignment VALUES ('demo-bad','demo-person-01','demo-unit-2','2026-11-01',NULL,'demo-proof','verified')",
    ));
    store.run(
      "INSERT INTO identity_link VALUES ('demo-pending','demo-person-02','demo-mis','demo-person-01','pending','demo-proof','2026-11-01',NULL)",
    );
    assert.throws(() => store.run("UPDATE identity_link SET verification_state='verified' WHERE id='demo-pending'"));
    store.run(
      "INSERT INTO unit_assignment VALUES ('demo-pending-assignment','demo-person-01','demo-unit-2','2026-11-01',NULL,'demo-proof','pending')",
    );
    assert.throws(() => store.run("UPDATE unit_assignment SET verification_state='verified' WHERE id='demo-pending-assignment'"));
    store.run(
      `INSERT INTO wound_case(id,subject_id,incident_namespace,incident_ref,origin,injury_date,injury_date_assurance,lifecycle_state,revision)
       VALUES ('demo-new','demo-person-01','demo-mis','demo-another-incident','administrative_request',NULL,'unknown','administrative_open',1)`,
    );
    assert.equal(h.count("SELECT COUNT(*) AS n FROM wound_case WHERE subject_id='demo-person-01'"), 2);
  }));

test('БД: чужа база відхиляється до будь-якої зміни схеми чи даних', () =>
  withHarness(async h => {
    assert(h.dir);
    const path = join(h.dir, 'foreign.sqlite');
    const foreign = new DatabaseSync(path);
    foreign.exec("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('keep')");
    foreign.close();
    assert.throws(() => new Store(path, h.auditKey), /foreign_database_refused/);
    const check = new DatabaseSync(path, {readOnly: true});
    assert.equal(check.prepare('SELECT value FROM sentinel').get()?.value, 'keep');
    assert.equal(check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get()?.n, 1);
    check.close();
  }, {file: true}));

test('БД: аналітичні зрізи незмінні', () =>
  withHarness(async h => {
    assert.throws(() => h.store.run("UPDATE analytics_snapshot SET payload='{}'"), /immutable_snapshot/);
    assert.throws(() => h.store.run('DELETE FROM analytics_snapshot'), /immutable_snapshot/);
  }));
