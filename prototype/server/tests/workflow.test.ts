import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {AnalyticsView, DocumentItemView, FinanceTrackView, PatientCaseView} from '../../shared/api.js';
import {reviewOverdueDeadlines} from '../domain/deadlines.js';
import {caseSummary, patientCaseView} from '../read/case-view.js';
import {fixtureEvent, variant, withHarness, type Harness} from './harness.js';

const CASE = 'demo-case-01';
const RESERVE = 'demo-reserve-case';

const patient = (h: Harness, caseId = CASE): PatientCaseView => patientCaseView(h.store, caseId);
const freshness = (h: Harness, caseId = CASE): string => caseSummary(h.store, caseId, {staff: true}).freshness;

/** Усі рядки переліків певного виду документа в усіх маршрутах. */
const documentItems = (h: Harness, kind: string, caseId = CASE): DocumentItemView[] =>
  patient(h, caseId).documents.flatMap(list => list.items).filter(item => item.kind === kind);

const finance = (h: Harness, kind: 'reward' | 'ogd', periodStart = '2026-11-01'): FinanceTrackView => {
  const track = patient(h).finances.find(item => item.kind === kind && item.periodStart === periodStart);
  assert(track, `немає маршруту ${kind} ${periodStart}`);
  return track;
};

async function acceptAll(h: Harness, ids: string[]): Promise<void> {
  for (const id of ids) await h.accepted(id);
}

test('D1: повний шлях — винагорода до ВЛК, ОГД окремо, інший період лишається незакритим', () =>
  withHarness(async h => {
    await acceptAll(h, ['primary', 'admit', 'care-start', 'transfer', 'patient-receipt', 'certificate-prepared']);
    await h.login('commander');
    assert.equal((await h.command('issue_certificate')).status, 200);
    await acceptAll(h, [
      'certificate-issued', 'certificate-sent', 'certificate-received',
      'reward-packet', 'reward-approved', 'reward-execution_partial', 'reward-execution_confirmed',
    ]);
    // Винагорода дійшла до підтвердженого виконання, а постанови ВЛК ще немає.
    assert.equal(h.count("SELECT COUNT(*) AS n FROM case_event WHERE case_id=? AND event_type='vlk.decision_recorded'", CASE), 0);
    assert.equal(finance(h, 'reward').status, 'execution_confirmed');

    assert.equal((await h.command('refer_vlk')).status, 200);
    await acceptAll(h, [
      'referral', 'vlk-received', 'vlk-decision', 'service-executed',
      'ogd-packet', 'ogd-returned', 'ogd-approved-after-returned', 'ogd-execution_partial', 'ogd-execution_confirmed',
      'ogd-oct-packet', 'ogd-oct-approved',
    ]);
    const tracks = h.store.rows(
      'SELECT payment_kind,period_start,current_status FROM financial_track WHERE case_id=? ORDER BY payment_kind,period_start',
      CASE,
    );
    assert.deepEqual(tracks.map(row => [row.payment_kind, row.period_start, row.current_status]), [
      ['ogd', '2026-10-01', 'approved'],
      ['ogd', '2026-11-01', 'execution_confirmed'],
      ['reward', '2026-11-01', 'execution_confirmed'],
    ]);
    // Схвалений інший період не має доказу виконання.
    assert.equal(finance(h, 'ogd', '2026-10-01').executionConfirmed, false);

    // Повтор першої події не додає кейс, подію, задачу, outbox чи документ.
    const before = h.sizes();
    assert.equal((await h.send('primary')).status, 200);
    assert.deepEqual(h.sizes(), before);

    // Чотири календарні місяці від підтвердженого початку; переведення відлік не скинуло.
    assert.equal(h.store.row("SELECT due_date FROM deadline WHERE case_id=? AND rule_version_id='demo-rule-care'", CASE)?.due_date, '2027-02-21');

    await h.login('patient');
    const view = (await (await h.get('/api/patient')).json()) as PatientCaseView;
    assert(view.timeline.some(entry => entry.type === 'service.action_confirmed'));
    assert(view.documents.some(list => list.route === 'ogd' && list.items.some(item => item.version === 'v1')));
    assert.equal(view.care.facility, 'Умовний заклад 02');
    assert.equal(view.stage, 'service_action');
    assert.deepEqual(view.milestones, {
      certificate: 'issued', referral: 'issued', vlkPacket: 'received', vlkDecision: 'recorded', serviceAction: 'confirmed',
    });
    assert.equal(h.count("SELECT COUNT(*) AS n FROM task WHERE case_id=? AND kind='next_service_action' AND status='open'", CASE), 0);
    assert.deepEqual(h.store.rows('PRAGMA foreign_key_check'), []);
  }));

test('AC02: кожен крок таймлайна має джерело, час і реального власника наступної дії або явну її відсутність', () =>
  withHarness(async h => {
    await acceptAll(h, ['primary', 'admit', 'certificate-prepared']);
    await h.login('commander');
    assert.equal((await h.command('issue_certificate')).status, 200);
    await h.accepted('certificate-issued');
    const {timeline, timelineTotal} = patient(h);
    assert.equal(timelineTotal, timeline.length);
    for (const entry of timeline) {
      assert(entry.source, entry.type);
      assert(entry.recordedAt, entry.type);
      assert(Array.isArray(entry.followUps), entry.type);
    }
    const byType = (type: string) => {
      const entry = timeline.find(item => item.type === type && item.assurance !== 'synthetic_seed');
      assert(entry, type);
      return entry;
    };
    // еПМК відкрила задачу медслужбі; її вже виконано (довідку складено).
    const primary = byType('medical.primary_recorded');
    assert.equal(primary.source, 'medical');
    assert.equal(primary.sourceRecordedAt, '2026-11-09T10:00:00Z');
    assert(primary.followUps.some(task => task.kind === 'prepare_certificate' && task.ownerRole === 'medical_service' && !task.open));
    // Складена довідка відкрила задачу командиру; видачу підтверджено.
    const prepared = byType('document.prepared');
    assert.deepEqual(prepared.followUps, [{kind: 'issue_certificate', ownerRole: 'commander', open: false}]);
    // Запит командира чекав на джерело; підтвердження закрило очікування.
    const request = byType('command.issue_certificate');
    assert.equal(request.source, 'user');
    assert.equal(request.assurance, 'demo_command');
    assert.deepEqual(request.followUps, [{kind: 'await_source_confirmation', ownerRole: 'support', open: false}]);
    // Видача відкрила очікування квитанції адресата — воно ще відкрите.
    const issued = byType('document.issued');
    assert.equal(issued.source, 'documents');
    assert.deepEqual(issued.followUps, [{kind: 'await_recipient_receipt', ownerRole: 'support', open: true}]);
    // Надходження до закладу — лише підтвердження факту.
    assert.deepEqual(byType('care.admitted').followUps, []);
  }));

test('AC01/07: резерв без входу бійця; пізня еПМК долучається до того самого кейсу; нових грантів немає', () =>
  withHarness(async h => {
    const grants = h.count('SELECT COUNT(*) AS n FROM access_grant');
    await h.login('support');
    assert.equal((await h.command('admin_open', 'demo-case-02', 'primary_unavailable')).status, 200);
    // Адміністративний запит не створює медичного факту.
    const reserve = h.store.row('SELECT source_linked,injury_date,origin,lifecycle_state FROM wound_case WHERE id=?', RESERVE);
    assert.deepEqual([reserve?.source_linked, reserve?.injury_date, reserve?.origin], [0, null, 'administrative_request']);
    assert.equal(caseSummary(h.store, RESERVE, {staff: true}).sourceLinked, false);
    // Другий резерв для того самого учасника не створюється.
    const again = await h.command('admin_open', 'demo-case-02', 'primary_unavailable');
    assert.equal(again.status, 409);
    assert.equal(((await again.json()) as {error: string}).error, 'reserve_exists');
    assert.equal((await h.command('admin_open', 'demo-case-03', 'primary_unavailable')).status, 400);

    await h.accepted('reserve-primary');
    assert.equal(h.count('SELECT COUNT(*) AS n FROM wound_case'), 31);
    assert.equal(h.store.row('SELECT source_linked FROM wound_case WHERE id=?', RESERVE)?.source_linked, 1);
    assert.equal(h.count("SELECT COUNT(*) AS n FROM task WHERE case_id=? AND kind='await_primary_source' AND status='open'", RESERVE), 0);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM access_grant'), grants);

    // Звернення родини фіксується, але доступу, сесії чи гранта не створює.
    const sessions = h.count('SELECT COUNT(*) AS n FROM demo_session');
    assert.equal((await h.command('support_request', RESERVE, 'relative')).status, 200);
    assert.equal(h.store.row('SELECT category,authority_checked FROM support_request WHERE case_id=?', RESERVE)?.category, 'relative_contact_without_access');
    assert.equal((await h.command('resolve_support', RESERVE)).status, 200);
    assert.equal((await h.command('resolve_support', RESERVE)).status, 409);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM access_grant'), grants);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM demo_session'), sessions);
    assert.equal((await h.get('/api/guide')).status, 200);
  }));

test('AC01/10: невизначений випадок не зливається автоматично; розбір закривається лише явною звіркою в своїй області', () =>
  withHarness(async h => {
    await h.pending('uncertain');
    await h.login('patient');
    const own = (await (await h.get('/api/patient')).json()) as PatientCaseView;
    assert.equal(own.reviews.length, 0);

    await h.login('support');
    const review = String(h.store.row("SELECT id FROM review_item WHERE reason_code='missing_incident'")?.id);
    // Кейс іншої особи — відмова; кейс поза областю — нерозкривальна 404.
    assert.equal((await h.command('resolve_review', 'demo-case-02', review)).status, 409);
    assert.equal((await h.command('resolve_review', 'demo-case-11', review)).status, 404);
    // Невизначений випадок не можна просто «закрити» без підтвердження.
    assert.equal((await h.command('close_review', CASE, review)).status, 409);
    assert.equal((await h.command('resolve_review', CASE, review)).status, 200);
    assert.equal(h.store.row('SELECT state FROM review_item WHERE id=?', review)?.state, 'resolved');
    assert.equal(h.count('SELECT COUNT(*) AS n FROM wound_case'), 30);
    assert.equal(h.count("SELECT COUNT(*) AS n FROM inbox_event WHERE processing_state='applied'"), 1);
  }));

test('AC04: п’ять днів лише після підтвердженого отримання й лише для дій противника', () =>
  withHarness(async h => {
    await h.accepted('primary');
    let deadline = patient(h).certificateDeadline;
    assert.deepEqual([deadline.anchorStatus, deadline.dueDate, deadline.followUpDate], ['estimated', null, '2026-11-14']);
    await h.accepted('patient-receipt');
    deadline = patient(h).certificateDeadline;
    assert.deepEqual([deadline.anchorStatus, deadline.anchorDate, deadline.dueDate, deadline.followUpDate], ['confirmed', '2026-11-10', '2026-11-15', null]);

    for (const [number, enemyAction] of [[2, 'no'], [3, 'unknown']] as const) {
      const event = variant('primary', `demo-enemy-${number}`, item => {
        item.subject_ref = `demo-person-0${number}`;
        item.incident_ref = `demo-incident-0${number}`;
        item.payload.enemy_action = enemyAction;
      });
      await h.accepted(event);
      const other = caseSummary(h.store, `demo-case-0${number}`, {staff: true}).certificateDeadline;
      assert.deepEqual([other.dueDate, other.followUpDate], [null, null], enemyAction);
      assert.equal(other.applicability, enemyAction === 'no' ? 'not_applicable' : 'unknown');
    }
    // Квитанція іншої особи не запускає чужий строк.
    await h.pending(variant('patient-receipt', 'demo-wrong-person', item => {
      item.payload.recipient_ref = 'demo-person-02';
    }));
    assert.equal(h.store.row("SELECT patient_received_at FROM wound_case WHERE id='demo-case-02'")?.patient_received_at, null);
  }));

test('AC04: без дати немає строку; переведення не скидає початок; суперечлива дата йде на розбір', () =>
  withHarness(async h => {
    await h.accepted('care-unknown');
    const unknown = patient(h, 'demo-case-03').care.deadline;
    assert.deepEqual([unknown.startDate, unknown.dueDate], [null, null]);
    assert.equal(h.count("SELECT COUNT(*) AS n FROM task WHERE case_id='demo-case-03' AND kind='clarify_care_start' AND status='open'"), 1);

    await acceptAll(h, ['primary', 'admit', 'care-start', 'transfer', 'civil', 'civil-summary', 'discharge']);
    assert.equal(patient(h).care.deadline.dueDate, '2027-02-21');
    // Після виписки поточний заклад не вигадується.
    assert.equal(patient(h).care.facility, null);

    await h.pending(variant('care-start', 'demo-conflicting-anchor', item => {
      item.payload.date = '2026-11-12';
    }));
    assert.equal(patient(h).care.deadline.startDate, '2026-10-21');
    assert.equal(patient(h).care.deadline.dueDate, '2027-02-21');
  }));

test('AC04: без еПМК відлік може початися від отримання довідки про перебування в закладі', () =>
  withHarness(async h => {
    await h.login('support');
    assert.equal((await h.command('admin_open', 'demo-case-02', 'primary_unavailable')).status, 200);
    await h.accepted('reserve-hospital');
    assert.equal(caseSummary(h.store, RESERVE, {staff: true}).certificateDeadline.dueDate, null);
    await h.accepted('reserve-hospital-receipt');
    assert.equal(caseSummary(h.store, RESERVE, {staff: true}).certificateDeadline.dueDate, '2026-11-18');
    // Довідка про перебування не робить медичний документ підтвердженим.
    assert.equal(h.store.row('SELECT source_linked FROM wound_case WHERE id=?', RESERVE)?.source_linked, 0);
  }));

test('AC04: календарний worker створює лише задачу людині, без дублів і без зміни виплат чи стадії', () =>
  withHarness(async h => {
    await acceptAll(h, ['primary', 'patient-receipt', 'care-start']);
    const finances = h.store.rows('SELECT payment_kind,current_status FROM financial_track WHERE case_id=?', CASE);
    const stage = h.store.row('SELECT lifecycle_state FROM wound_case WHERE id=?', CASE)?.lifecycle_state;
    const later = Date.parse('2027-03-01T12:00:00Z');
    reviewOverdueDeadlines(h.store, later);
    const reminders = h.count("SELECT COUNT(*) AS n FROM task WHERE kind='review_deadline'");
    assert(reminders > 0);
    reviewOverdueDeadlines(h.store, later);
    assert.equal(h.count("SELECT COUNT(*) AS n FROM task WHERE kind='review_deadline'"), reminders);
    assert.deepEqual(h.store.rows('SELECT payment_kind,current_status FROM financial_track WHERE case_id=?', CASE), finances);
    assert.equal(h.store.row('SELECT lifecycle_state FROM wound_case WHERE id=?', CASE)?.lifecycle_state, stage);
    assert.equal(patient(h).certificateDeadline.reviewOpen, true);
  }));

test('AC03/05: складено ≠ видано ≠ надіслано ≠ отримано; нова версія не успадковує квитанцію; історія зберігається', () =>
  withHarness(async h => {
    assert.deepEqual(patient(h).milestones, {
      certificate: 'none', referral: 'none', vlkPacket: 'none', vlkDecision: 'none', serviceAction: 'none',
    });
    await h.accepted('primary');
    await h.accepted('certificate-prepared');
    assert.equal(patient(h).milestones.certificate, 'prepared');
    assert(documentItems(h, 'trauma_certificate').every(item => item.state === 'prepared' && item.delivery === 'none'));
    await h.pending('certificate-received');

    await h.login('commander');
    assert.equal((await h.command('issue_certificate')).status, 200);
    // Запит командира — ще не видача.
    assert.equal(patient(h).milestones.certificate, 'requested');
    await h.accepted('certificate-issued');
    assert.equal(patient(h).milestones.certificate, 'issued');
    const vlkItem = () => {
      const list = patient(h).documents.find(item => item.route === 'vlk');
      const item = list?.items.find(candidate => candidate.kind === 'trauma_certificate');
      assert(item);
      return item;
    };
    assert.deepEqual([vlkItem().state, vlkItem().delivery, vlkItem().version], ['issued', 'none', 'v1']);
    await h.accepted('certificate-sent');
    assert.equal(vlkItem().delivery, 'sent');
    await h.accepted(variant('certificate-received', 'demo-later-receipt'));
    assert.equal(vlkItem().delivery, 'received');

    await h.accepted('certificate-corrected');
    const corrected = documentItems(h, 'trauma_certificate');
    assert(corrected.every(item => item.version === 'v2' && item.delivery === 'none'));
    assert(corrected.every(item => item.history.some(old => old.version === 'v1' && old.state === 'superseded')));
    // Запис попередньої версії та її квитанція лишилися в БД.
    assert.equal(h.count("SELECT COUNT(*) AS n FROM document_ref WHERE case_id=? AND kind='trauma_certificate' AND document_version='v1'", CASE), 2);
    assert.equal(h.count("SELECT COUNT(*) AS n FROM delivery WHERE state='received' AND recipient_ref='demo-vlk' AND receipt_ref='demo-source-proof'"), 1);

    await h.accepted('certificate-withdrawn');
    const withdrawn = documentItems(h, 'trauma_certificate');
    assert(withdrawn.every(item => item.state === 'missing' && item.version === null));
    assert(withdrawn.every(item => item.history.some(old => old.version === 'v2' && old.state === 'withdrawn')));
  }));

test('AC03: галерея лише фіксована; помилковий зразок, копія й оригінал — різні стани', () =>
  withHarness(async h => {
    await h.login('patient');
    assert.equal((await h.command('copy', CASE, 'arbitrary')).status, 400);
    assert.equal((await h.command('copy', CASE, 'wrong_kind')).status, 200);
    assert(documentItems(h, 'trauma_certificate').some(item => item.state === 'wrong_kind'));
    assert.equal((await h.command('copy', CASE, 'trauma_certificate')).status, 200);
    assert(documentItems(h, 'trauma_certificate').some(item => item.state === 'copy_pending'));
    // Боєць не може сам перевірити свою копію.
    assert.equal((await h.command('verify_copy')).status, 403);

    await h.login('support');
    assert.equal((await h.command('verify_copy')).status, 200);
    assert(documentItems(h, 'trauma_certificate').some(item => item.state === 'copy_checked' && item.provenance === 'manual_demo_copy'));
    assert.equal((await h.command('verify_copy')).status, 409);
    // Копія не стала джерельним оригіналом.
    assert.equal(h.count("SELECT COUNT(*) AS n FROM document_ref WHERE case_id=? AND source_system='demo-gallery' AND provenance='source_reference'", CASE), 0);
  }));

test('AC03: переліки розділено за маршрутом і пакетом; видно версію правила, а не внутрішній ідентифікатор', () =>
  withHarness(async h => {
    await acceptAll(h, ['primary', 'reward-packet', 'reward-oct-packet']);
    const lists = patient(h).documents;
    assert.deepEqual([...new Set(lists.map(list => list.route))].sort(), ['ogd', 'reward', 'vlk']);
    assert.deepEqual(lists.filter(list => list.route === 'reward').map(list => list.period).sort(), ['2026-10', '2026-11']);
    assert(lists.every(list => list.ruleVersion === 'demo-1'));
    const ogd = lists.find(list => list.route === 'ogd');
    assert.deepEqual(ogd?.items.map(item => item.kind).sort(), ['trauma_certificate', 'vlk_decision']);
  }));

test('AC05/10: різні дії ролей; неповний перелік не блокує направлення; область і відкликання перевіряються перед повтором', () =>
  withHarness(async h => {
    await h.login('support');
    assert.equal((await h.command('issue_certificate')).status, 403);
    assert.equal((await h.command('refer_vlk')).status, 403);

    await h.login('commander');
    // У кейсі бракує довідки, але направлення не блокується технічним переліком.
    assert(documentItems(h, 'trauma_certificate').some(item => item.state === 'missing'));
    const id = 'demo-retry-command';
    assert.equal((await h.command('refer_vlk', CASE, undefined, id)).status, 200);
    const before = h.sizes();
    const repeat = await h.command('refer_vlk', CASE, undefined, id);
    assert.equal(repeat.status, 200);
    assert.equal(((await repeat.json()) as {duplicate?: boolean}).duplicate, true);
    assert.deepEqual(h.sizes(), before);
    // Той самий ключ з іншим змістом — конфлікт, а не друга дія.
    assert.equal((await h.command('clarify', CASE, undefined, id)).status, 409);
    // Новий запит, поки джерело не підтвердило попередній, не створює другої задачі.
    assert.equal((await h.command('refer_vlk')).status, 409);

    await h.accepted('referral');
    assert.equal(h.count("SELECT COUNT(*) AS n FROM case_event WHERE event_type='vlk.decision_recorded'"), 0);
    assert.equal((await h.command('refer_vlk')).status, 409);

    h.store.run("UPDATE unit_assignment SET valid_to='2026-11-12T12:00:00Z' WHERE id='demo-assignment-01'");
    assert.equal((await h.command('refer_vlk', CASE, undefined, id)).status, 404);
    h.store.run("UPDATE access_grant SET revoked_at='2026-11-13T00:00:00Z' WHERE id='demo-grant-commander'");
    assert.equal((await h.command('refer_vlk', 'demo-case-02')).status, 401);
  }));

test('AC05: повернений пакет уточнюється новою ревізією; зауваження не є виконаною службовою дією', () =>
  withHarness(async h => {
    await acceptAll(h, ['vlk-received', 'vlk-returned']);
    assert.equal(h.store.row("SELECT state FROM route_packet WHERE case_id=? AND route='vlk'", CASE)?.state, 'returned');
    assert.equal(h.count("SELECT COUNT(*) AS n FROM task WHERE case_id=? AND kind='clarify_author' AND status='open'", CASE), 1);
    // Постанова не приймається, поки пакет повернуто.
    await h.pending(variant('vlk-decision', 'demo-decision-while-returned'));
    await h.accepted('vlk-resubmitted');
    assert.equal(h.store.row("SELECT revision FROM route_packet WHERE case_id=? AND route='vlk'", CASE)?.revision, 'v2');

    const clarification = fixtureEvent('vlk-decision');
    clarification.payload.service_code = 'clarification_needed';
    await h.accepted(clarification);
    assert.deepEqual(
      [patient(h).milestones.vlkPacket, patient(h).milestones.vlkDecision, patient(h).milestones.serviceAction],
      ['received', 'clarification_needed', 'none'],
    );
    await h.pending('service-executed');
    assert.equal(h.store.row('SELECT lifecycle_state FROM wound_case WHERE id=?', CASE)?.lifecycle_state, 'vlk');
  }));

test('AC06: повернення, відмова, схвалення, часткове й повне виконання не зливаються', () =>
  withHarness(async h => {
    await acceptAll(h, ['ogd-packet', 'ogd-returned']);
    assert.deepEqual([finance(h, 'ogd').status, finance(h, 'ogd').clarificationOpen], ['returned', true]);
    await h.accepted('ogd-denied');
    assert.equal(finance(h, 'ogd').status, 'denied');
    await h.accepted('ogd-approved-after-denied');
    assert.deepEqual(
      [finance(h, 'ogd').status, finance(h, 'ogd').decisionConfirmed, finance(h, 'ogd').executionConfirmed, finance(h, 'ogd').clarificationOpen],
      ['approved', true, false, false],
    );
    await h.accepted('ogd-execution_partial');
    assert.deepEqual([finance(h, 'ogd').status, finance(h, 'ogd').executionConfirmed], ['execution_partial', true]);

    // Невідомий сигнал не стирає підтверджене часткове виконання.
    await h.accepted('ogd-unknown');
    assert.equal(finance(h, 'ogd').status, 'execution_partial');
    assert.equal(finance(h, 'ogd').clarificationOpen, true);
    assert.equal(freshness(h), 'stale');
    await h.accepted('ogd-execution_confirmed');
    assert.equal(finance(h, 'ogd').status, 'execution_confirmed');
    assert.equal(freshness(h), 'fresh');

    // Подія винагороди з пакетом ОГД не змішує маршрути.
    const mixed = fixtureEvent('reward-approved');
    mixed.payload.packet_ref = 'demo-ogd-packet-01';
    await h.pending(mixed);
    assert.equal(finance(h, 'reward').status, 'under_review');
  }));

test('AC06: виконання без рішення та рішення з недоведеним попередником не перезаписують підтверджене', () =>
  withHarness(async h => {
    await h.accepted('reward-packet');
    await h.pending('reward-execution_partial');
    await h.accepted('reward-approved');
    const wrong = fixtureEvent('reward-denied');
    wrong.event_id = 'demo-wrong-predecessor';
    await h.pending(wrong);
    assert.equal(finance(h, 'reward').status, 'approved');
    // Статус без отриманого пакета не приймається.
    await h.pending('ogd-approved');
    // Винагорода не чекає на постанову ВЛК: постанови в кейсі немає.
    assert.equal(h.count("SELECT COUNT(*) AS n FROM case_event WHERE event_type='vlk.decision_recorded'"), 0);
  }));

test('AC09: прогалина зберігає підтвердження; чужий сигнал її не закриває, потрібний — відновлює', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted('gap');
    assert.equal(freshness(h), 'stale');
    assert.equal(patient(h).sourceLinked, true);
    await h.accepted('care-start');
    assert.equal(freshness(h), 'stale');
    await h.accepted('gap-recovered');
    assert.equal(freshness(h), 'fresh');

    await h.login('dev');
    const conflict = await h.post('/api/demo/events', {fixture: 'primary', mode: 'conflict'});
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), {status: 'event_conflict', business_applied: false});
    assert.equal(freshness(h), 'conflict');
    // Попереднє підтвердження не перезаписано.
    assert.equal(h.store.row('SELECT source_recorded_at FROM wound_case WHERE id=?', CASE)?.source_recorded_at, '2026-11-09T10:00:00Z');
  }));

test('AC09: симулятор справді проходить підпис, схему й політику джерела; інших ролей і довільного JSON немає', () =>
  withHarness(async h => {
    await h.login('support');
    assert.equal((await h.post('/api/demo/events', {fixture: 'primary'})).status, 403);
    await h.login('dev');
    assert.equal((await h.post('/api/demo/events', {fixture: 'primary', payload: {}})).status, 400);
    const sent = await h.post('/api/demo/events', {fixture: 'primary'});
    assert.equal(sent.status, 202);
    assert.equal(h.count("SELECT COUNT(*) AS n FROM audit_entry WHERE action_code='event_validate' AND result_code='accepted'"), 1);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM transport_nonce'), 1);
    assert.equal((await h.post('/api/demo/events', {fixture: 'primary', mode: 'repeat'})).status, 200);
    // Видачу документа не може підтвердити медичне джерело.
    const forged = fixtureEvent('certificate-issued');
    forged.source_system = 'demo-mis';
    assert.equal((await h.send(forged)).status, 403);
  }));

test('AC10: збій аудиту відкочує команду разом з усіма доменними змінами', () =>
  withHarness(async h => {
    await h.login('support');
    const before = h.sizes();
    h.store.db.exec(
      "CREATE TRIGGER reject_command BEFORE INSERT ON audit_entry " +
      "WHEN NEW.action_code='command' AND NEW.result_code='allowed' BEGIN SELECT RAISE(ABORT,'demo_failure'); END;",
    );
    assert.equal((await h.command('admin_open', 'demo-case-02', 'primary_unavailable')).status, 503);
    assert.deepEqual(h.sizes(), before);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM demo_command'), 0);
    assert.equal(h.count('SELECT COUNT(*) AS n FROM incident_link WHERE case_id=?', RESERVE), 0);
  }));

test('AC08/10: фіксований зріз не рухається від D1; аналітик не має рядків і фільтрів', () =>
  withHarness(async h => {
    await h.login('analyst');
    const before = await (await h.get('/api/analytics')).json();
    await h.accepted('primary');
    assert.deepEqual(await (await h.get('/api/analytics')).json(), before);
    assert.equal((await h.get('/api/cases/demo-case-01')).status, 403);
    assert.equal((await h.get('/api/staff')).status, 403);
    assert.equal((await h.get('/api/analytics?unit=demo-unit-1')).status, 400);

    await h.login('dev');
    assert.equal((await h.post('/api/demo/analytics', {snapshot: 'demo-live'})).status, 400);
    assert.equal((await h.post('/api/demo/analytics', {snapshot: 'demo-small'})).status, 200);
    await h.login('analyst');
    const small = (await (await h.get('/api/analytics')).json()) as AnalyticsView;
    const computed = small.metrics.filter(metric => metric.id !== 'BO-4');
    assert(computed.every(metric => metric.value === 'Приховано' && metric.state === 'suppressed'));
    assert.equal(small.metrics.find(metric => metric.id === 'BO-4')?.state, 'context');
  }));
