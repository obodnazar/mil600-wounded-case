import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {StaffView} from '../../shared/api.js';
import {applyEvent} from '../domain/events/apply.js';
import {ReviewRequired} from '../domain/model.js';
import {caseSummary, patientCaseView} from '../read/case-view.js';
import {NOW, fixtureEvent, nextVersion, variant, withHarness, type Harness} from './harness.js';

/**
 * Регресії знахідок незалежного фінального рев’ю 2026-11-14 (FR-01…FR-13) і перевірки,
 * які мутаційний прохід рецензента показав неприкритими.
 */

const CASE = 'demo-case-01';
const openTasks = (h: Harness, kind: string, caseId = CASE): number =>
  h.count("SELECT COUNT(*) AS n FROM task WHERE case_id=? AND kind=? AND status='open'", caseId, kind);
const milestones = (h: Harness) => patientCaseView(h.store, CASE).milestones;
const lastReason = (h: Harness): string | undefined => h.reviewReasons().at(-1);

async function issueCertificate(h: Harness): Promise<void> {
  await h.accepted('primary');
  await h.accepted('certificate-prepared');
  await h.login('commander');
  assert.equal((await h.command('issue_certificate')).status, 200);
  await h.accepted('certificate-issued');
}

test('FR-01: складати довідку може лише медслужба; виправлення складеної довідки не підробляє її видачу', () =>
  withHarness(async h => {
    await h.accepted('primary');
    // Джерело документообігу не може «скласти» довідку про обставини травми.
    const forged = variant('certificate-prepared', 'demo-sedo-prepared', event => {
      event.source_system = 'demo-sedo';
    });
    assert.equal((await h.send(forged)).status, 403);

    await h.accepted('certificate-prepared');
    // Навіть оминувши політику джерела, виправлення ще не виданої довідки — лише на розбір.
    const correction = variant('certificate-corrected', 'demo-correct-prepared', event => {
      event.source_system = 'demo-mis';
    });
    h.store.run(
      "INSERT INTO inbox_event VALUES ('demo-inbox-direct','demo-mis','demo-correct-prepared','s','v1',NULL,'document.corrected','d',?,?,'pending_review')",
      new Date(NOW).toISOString(), JSON.stringify(correction),
    );
    assert.throws(
      () => h.store.transaction(() => applyEvent(h.store, correction, 'demo-inbox-direct', NOW)),
      (error: unknown) => error instanceof ReviewRequired && error.reason === 'correction_before_issue',
    );
    assert.equal(milestones(h).certificate, 'prepared');
    await h.login('commander');
    const view = (await (await h.get('/api/staff')).json()) as StaffView;
    const action = view.cases.find(item => item.id === CASE)?.actions.find(item => item.action === 'issue_certificate');
    assert.deepEqual([action?.available, action?.reason], [true, null]);
  }));

test('FR-01: виправлена видана довідка лишається виданою; складена — складеною', () =>
  withHarness(async h => {
    await issueCertificate(h);
    await h.accepted('certificate-corrected');
    assert.equal(milestones(h).certificate, 'issued');
    const states = h.store.rows(
      "SELECT document_version,state,active FROM document_ref WHERE case_id=? AND kind='trauma_certificate' AND source_system='demo-sedo' ORDER BY rowid",
      CASE,
    );
    assert.deepEqual(states.map(row => [row.document_version, row.state, row.active]), [['v1', 'issued', 0], ['v2', 'corrected', 1]]);
  }));

test('FR-02: підтверджена застосовність контролю лікування не знижується; суперечність — розбір', () =>
  withHarness(async h => {
    await h.accepted('care-start');
    const careDeadline = () => patientCaseView(h.store, CASE).care.deadline;
    assert.deepEqual([careDeadline().applicability, careDeadline().dueDate], ['applicable', '2027-02-21']);
    await h.accepted(variant('care-start', 'demo-care-without-applicability', event => {
      delete event.payload.care_applicable;
    }));
    assert.deepEqual([careDeadline().applicability, careDeadline().dueDate], ['applicable', '2027-02-21']);
    assert.equal(openTasks(h, 'clarify_care_start'), 0);
    await h.pending(variant('care-start', 'demo-care-not-applicable', event => {
      event.payload.care_applicable = false;
    }));
    assert.equal(lastReason(h), 'care_applicability_change_unproven');
    assert.deepEqual([careDeadline().applicability, careDeadline().dueDate], ['applicable', '2027-02-21']);
  }));

test('FR-03: чинна постанова — найпізніша за часом; затримана старіша постанова не стає чинною', () =>
  withHarness(async h => {
    await h.accepted('vlk-received');
    await h.accepted(variant('vlk-decision', 'demo-decision-clarify-12', event => {
      event.occurred_at = '2026-11-12T10:00:00.000Z';
      event.payload.document_ref = 'demo-vlk-decision-b';
      event.payload.service_code = 'clarification_needed';
    }));
    await h.pending(variant('vlk-decision', 'demo-decision-positive-05', event => {
      event.occurred_at = '2026-11-05T10:00:00.000Z';
      event.payload.document_ref = 'demo-vlk-decision-a';
    }));
    assert.equal(lastReason(h), 'decision_older_than_current');
    assert.deepEqual([milestones(h).vlkDecision, milestones(h).serviceAction], ['clarification_needed', 'none']);
    await h.pending(variant('service-executed', 'demo-execute-old-decision'));
  }));

test('FR-04: перший невідомий фінансовий сигнал не є рішенням і позначає дані неоновленими', () =>
  withHarness(async h => {
    await h.accepted('reward-packet');
    await h.accepted('reward-unknown');
    const reward = () => patientCaseView(h.store, CASE).finances.find(track => track.kind === 'reward');
    assert.deepEqual([reward()?.status, reward()?.decisionConfirmed, reward()?.clarificationOpen], ['under_review', false, true]);
    assert.equal(caseSummary(h.store, CASE, {staff: true}).freshness, 'stale');
    // Наступне справжнє рішення приймається й закриває уточнення.
    await h.accepted('reward-approved');
    assert.deepEqual([reward()?.status, reward()?.decisionConfirmed, reward()?.clarificationOpen], ['approved', true, false]);
    assert.equal(caseSummary(h.store, CASE, {staff: true}).freshness, 'fresh');
  }));

test('FR-04: невідомий сигнал для нового періоду створює рядок «стан невідомий» без рішення', () =>
  withHarness(async h => {
    await h.accepted('reward-oct-packet');
    await h.accepted(variant('reward-unknown', 'demo-reward-oct-unknown', event => {
      event.payload.period = '2026-10';
      event.payload.packet_ref = 'demo-reward-oct-01';
    }));
    const october = h.store.row(
      "SELECT current_status,decision_ref FROM financial_track WHERE case_id=? AND payment_kind='reward' AND period_start='2026-10-01'",
      CASE,
    );
    assert.deepEqual([october?.current_status, october?.decision_ref], ['unknown', null]);
  }));

test('FR-05: після відкликання виданої довідки маршрут починається знову', () =>
  withHarness(async h => {
    await issueCertificate(h);
    assert.equal(openTasks(h, 'await_recipient_receipt'), 1);
    await h.accepted(variant('certificate-withdrawn', 'demo-withdraw-issued-v1', event => {
      event.payload.document_version = 'v1';
    }));
    assert.equal(openTasks(h, 'await_recipient_receipt'), 0);
    assert.equal(openTasks(h, 'prepare_certificate'), 1);
    const owner = caseSummary(h.store, CASE, {staff: true}).tasks.find(task => task.kind === 'prepare_certificate');
    assert.equal(owner?.ownerRole, 'medical_service');

    await h.accepted(variant('certificate-prepared', 'demo-prepare-v2', event => {
      event.payload.document_version = 'v2';
    }));
    assert.deepEqual([openTasks(h, 'prepare_certificate'), openTasks(h, 'issue_certificate')], [0, 1]);
    assert.equal((await h.command('issue_certificate')).status, 200);
    await h.accepted(variant('certificate-issued', 'demo-issue-v2', event => {
      event.payload.document_version = 'v2';
    }));
    assert.deepEqual([milestones(h).certificate, openTasks(h, 'await_recipient_receipt')], ['issued', 1]);
  }));

test('FR-06: квитанція ВЛК на інший документ не закриває очікування квитанції довідки', () =>
  withHarness(async h => {
    await issueCertificate(h);
    await h.accepted(variant('certificate-received', 'demo-vlk-receipt-primary', event => {
      event.payload.document_ref = 'demo-primary-d1';
    }));
    assert.equal(openTasks(h, 'await_recipient_receipt'), 1);
    await h.accepted('certificate-received');
    assert.equal(openTasks(h, 'await_recipient_receipt'), 0);
  }));

test('FR-07: підтвердження, що надійшло раніше за запит командира, цього запиту не підтверджує', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted('certificate-prepared');
    await h.pending('certificate-issued');
    h.setNow(NOW + 60 * 60 * 1000);
    await h.login('commander');
    assert.equal((await h.command('issue_certificate')).status, 200);
    const redelivered = await h.ingest('certificate-issued');
    assert.deepEqual([redelivered.http, redelivered.status], [200, 'pending_review']);
    assert.equal(milestones(h).certificate, 'requested');
    // Нове підтвердження, що надійшло після запиту, приймається.
    await h.accepted(variant('certificate-issued', 'demo-issue-after-request'));
    assert.equal(milestones(h).certificate, 'issued');

    // Те саме для направлення на ВЛК.
    await h.pending('referral');
    h.setNow(NOW + 2 * 60 * 60 * 1000);
    await h.login('commander');
    assert.equal((await h.command('refer_vlk')).status, 200);
    assert.equal((await h.ingest('referral')).status, 'pending_review');
    assert.equal(milestones(h).referral, 'requested');
  }));

test('FR-08: подія лікування не відкочує стадію кейсу назад', () =>
  withHarness(async h => {
    await h.accepted('vlk-received');
    await h.accepted('vlk-decision');
    assert.equal(patientCaseView(h.store, CASE).stage, 'service_action');
    await h.accepted('admit');
    assert.equal(patientCaseView(h.store, CASE).stage, 'service_action');
    assert.equal(patientCaseView(h.store, CASE).care.facility, 'Умовний заклад 01');
  }));

test('FR-09: командир не бачить і не закриває розборів та задач про виплати й лікування; супровід — так', () =>
  withHarness(async h => {
    await h.accepted('reward-packet');
    await h.pending('reward-execution_partial');
    await h.accepted(variant('reward-returned', 'demo-reward-returned-09'));
    const view = async () => {
      const staff = (await (await h.get('/api/staff')).json()) as StaffView;
      const item = staff.cases.find(entry => entry.id === CASE);
      assert(item);
      return item;
    };
    await h.login('support');
    const support = await view();
    const review = support.reviews.find(entry => entry.reason === 'execution_without_approval');
    assert.equal(review?.closable, true);
    assert(support.tasks.some(task => task.kind === 'clarify_finance'));

    await h.login('commander');
    const commander = await view();
    assert(!commander.reviews.some(entry => entry.reason === 'execution_without_approval'));
    assert(!commander.tasks.some(task => task.kind === 'clarify_finance'));
    assert.equal((await h.command('close_review', CASE, review?.id)).status, 403);
    await h.login('support');
    assert.equal((await h.command('close_review', CASE, review?.id)).status, 200);
  }));

test('FR-10: нова версія еПМК не змінює підтверджену дату поранення мовчки', () =>
  withHarness(async h => {
    await h.accepted('primary');
    const changed = nextVersion('primary', 'demo-primary-v2-date', 'v2', 'v1');
    changed.payload.injury_date = '2026-11-11';
    await h.pending(changed);
    assert.equal(lastReason(h), 'injury_date_change_unproven');
    assert.equal(h.store.row('SELECT injury_date FROM wound_case WHERE id=?', CASE)?.injury_date, '2026-10-20');
  }));

test('FR-11: переведення в інший підрозділ не дублює задачі з тим самим тригером', () =>
  withHarness(async h => {
    await h.accepted('primary');
    h.store.run("UPDATE unit_assignment SET valid_to='2026-11-13T00:00:00.000Z' WHERE id='demo-assignment-01'");
    h.store.run(
      "INSERT INTO unit_assignment VALUES ('demo-assignment-01b','demo-person-01','demo-unit-2','2026-11-13T00:00:00.000Z',NULL,'demo-proof','verified')",
    );
    await h.accepted(nextVersion('primary', 'demo-primary-v2-moved', 'v2', 'v1'));
    assert.equal(openTasks(h, 'prepare_certificate'), 1);
  }));

test('FR-13: повторне виконання тієї самої дії й віха виконання за чинного уточнення', () =>
  withHarness(async h => {
    await h.accepted('vlk-received');
    await h.accepted('vlk-decision');
    await h.accepted('service-executed');
    assert.equal(milestones(h).serviceAction, 'confirmed');
    await h.pending(variant('service-executed', 'demo-execute-twice'));
    assert.equal(lastReason(h), 'service_without_open_action');
    const clarification = nextVersion('vlk-decision', 'demo-vlk-clarify-after', 'v2', 'v1');
    clarification.payload.service_code = 'clarification_needed';
    await h.accepted(clarification);
    assert.equal(milestones(h).serviceAction, 'none');
  }));

test('FR-12: помилка даних (обмеження БД) лишає подію на розборі; помилки програми не перехоплюються (див. reviewReason)', () =>
  withHarness(async h => {
    await h.accepted('primary');
    // Помилку програми (TypeError) через HTTP не відтворити без зміни коду; її відкат до 503
    // забезпечує reviewReason у gateway.ts. Тут — що помилка даних і далі лишає подію на розборі.
    h.store.db.exec("CREATE TRIGGER reject_episode BEFORE INSERT ON treatment_episode BEGIN SELECT RAISE(ABORT,'demo'); END;");
    await h.pending('admit');
    assert.equal(lastReason(h), 'unprocessable_event');
  }));

test('мутації: попередник переведення, конфлікт надходження, чужий епізод виписки, доказ застосовності в довідці', () =>
  withHarness(async h => {
    await h.pending('transfer');
    assert.equal(lastReason(h), 'transfer_predecessor_missing');
    await h.accepted('admit');
    await h.pending(variant('admit', 'demo-admit-other-episode', event => {
      event.episode_ref = 'demo-other-episode';
    }));
    assert.equal(lastReason(h), 'admission_conflict');
    await h.pending('discharge');
    assert.equal(lastReason(h), 'episode_mismatch');
    const withoutProof = fixtureEvent('reserve-hospital');
    withoutProof.event_id = 'demo-hospital-without-proof';
    withoutProof.source_stream = withoutProof.event_id;
    withoutProof.subject_ref = 'demo-person-01';
    withoutProof.incident_ref = 'demo-incident-01';
    withoutProof.payload.document_kind = 'medical_summary';
    await h.pending(withoutProof);
    assert.equal(lastReason(h), 'hospital_context_proof_missing');
  }));
