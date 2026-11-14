import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveSession} from '../access/sessions.js';
import {Store} from '../db/store.js';
import {executeCommand} from '../domain/commands.js';
import {reviewOverdueDeadlines} from '../domain/deadlines.js';
import {caseSummary, patientCaseView} from '../read/case-view.js';
import {primaryFixture} from '../simulator/fixtures.js';
import {NOW, fixtureEvent, nextVersion, variant, withHarness, type Harness} from './harness.js';

/**
 * Регресії попереднього аудиту (docs/reviews/recheck-2026-11-13.md) і споріднені
 * послідовності з аудиту 2026-11-14: інший порядок подій, кілька версій поспіль,
 * старе підтвердження після нового рішення, відкликання, повтор після розбору, рестарт.
 */

const CASE = 'demo-case-01';
const due = (h: Harness, caseId = CASE): string | null => caseSummary(h.store, caseId, {staff: true}).certificateDeadline.dueDate;
const freshness = (h: Harness, caseId = CASE): string => caseSummary(h.store, caseId, {staff: true}).freshness;
const openTasks = (h: Harness, kind: string, caseId = CASE): number =>
  h.count("SELECT COUNT(*) AS n FROM task WHERE case_id=? AND kind=? AND status='open'", caseId, kind);
const certificateReminders = (h: Harness, caseId = CASE): number =>
  h.count(
    `SELECT COUNT(*) AS n FROM task t JOIN deadline d ON d.case_id=t.case_id
      WHERE d.case_id=? AND d.rule_version_id='demo-rule-certificate' AND t.kind='review_deadline'
        AND t.trigger_ref LIKE 'demo-deadline:'||d.id||':%' AND t.status='open'`,
    caseId,
  );

/* ───────────── Регресії recheck-2026-11-13 ───────────── */

test('RCHK-01: ручна звірка випадку не приховує іншу незакриту прогалину даних', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted('gap');
    await h.pending('uncertain');
    await h.login('support');
    const review = String(h.store.row("SELECT id FROM review_item WHERE reason_code='missing_incident'")?.id);
    assert.equal((await h.command('resolve_review', CASE, review)).status, 200);
    assert.equal(freshness(h), 'stale');
    await h.accepted('gap-recovered');
    assert.equal(freshness(h), 'fresh');
  }));

test('RCHK-02: новіше уточнення ВЛК забороняє дію за старою постановою; нове рішення продовжує маршрут', () =>
  withHarness(async h => {
    await h.accepted('vlk-received');
    await h.accepted('vlk-decision');
    const clarification = nextVersion('vlk-decision', 'demo-vlk-clarification-v2', 'v2', 'v1');
    clarification.payload.service_code = 'clarification_needed';
    await h.accepted(clarification);
    await h.pending('service-executed');
    assert.equal(h.count("SELECT COUNT(*) AS n FROM case_event WHERE event_type='service.action_confirmed'"), 0);

    await h.accepted(nextVersion('vlk-decision', 'demo-vlk-final-v3', 'v3', 'v2'));
    assert.equal(openTasks(h, 'next_service_action'), 1);
    assert.equal(h.count("SELECT COUNT(*) AS n FROM task WHERE case_id=? AND trigger_ref LIKE 'demo-vlk-decision-clarify:%' AND status='open'", CASE), 0);
    await h.accepted(variant('service-executed', 'demo-execute-current-decision'));
    assert.equal(openTasks(h, 'next_service_action'), 0);
  }));

test('RCHK-03: підтверджена видача закриває нагадування; worker не створює його знову', () =>
  withHarness(async h => {
    for (const id of ['primary', 'patient-receipt', 'certificate-prepared']) await h.accepted(id);
    reviewOverdueDeadlines(h.store, Date.parse('2026-11-20T12:00:00Z'));
    assert.equal(certificateReminders(h), 1);
    await h.login('commander');
    assert.equal((await h.command('issue_certificate')).status, 200);
    await h.accepted('certificate-issued');
    assert.equal(certificateReminders(h), 0);
    reviewOverdueDeadlines(h.store, Date.parse('2026-11-21T12:00:00Z'));
    assert.equal(certificateReminders(h), 0);
  }));

test('RCHK-04: суперечлива квитанція не пересуває підтверджену дату отримання', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted('patient-receipt');
    await h.pending(variant('patient-receipt', 'demo-changed-receipt', event => {
      event.payload.received_at = '2026-11-12T12:00:00Z';
    }));
    assert.deepEqual(h.reviewReasons(), ['receipt_date_conflict']);
    assert.equal(due(h), '2026-11-15');
  }));

test('RCHK-04: нова версія еПМК не починає підтверджений строк заново', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted('patient-receipt');
    await h.accepted(nextVersion('primary', 'demo-primary-v2', 'v2', 'v1'));
    await h.accepted(variant('patient-receipt', 'demo-receipt-v2', event => {
      event.payload.document_version = 'v2';
      event.payload.received_at = '2026-11-12T12:00:00Z';
    }));
    assert.equal(due(h), '2026-11-15');
    assert.equal(h.store.row('SELECT calculation_revision FROM deadline WHERE case_id=? AND rule_version_id=?', CASE, 'demo-rule-certificate')?.calculation_revision, 3);
  }));

/* ───────────── Споріднені послідовності (аудит 2026-11-14) ───────────── */

test('строк: нова версія еПМК з невідомою застосовністю не стирає підтверджений строк', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted('patient-receipt');
    assert.equal(due(h), '2026-11-15');
    const withoutApplicability = nextVersion('primary', 'demo-primary-v2-unknown', 'v2', 'v1');
    withoutApplicability.payload.enemy_action = 'unknown';
    delete withoutApplicability.payload.applicability_evidence_ref;
    await h.accepted(withoutApplicability);
    assert.equal(due(h), '2026-11-15');
    assert.equal(h.store.row('SELECT enemy_action FROM wound_case WHERE id=?', CASE)?.enemy_action, 'yes');
  }));

test('строк: подія без фактів про застосовність і отримання не стирає вже підтверджений строк', () =>
  withHarness(async h => {
    // Кейс 02 у seed має підтверджене отримання й строк 06.11.
    assert.equal(due(h, 'demo-case-02'), '2026-11-06');
    await h.accepted(variant('primary', 'demo-primary-02-bare', event => {
      event.subject_ref = 'demo-person-02';
      event.incident_ref = 'demo-incident-02';
      event.payload = {document_kind: 'primary_medical_card', document_version: 'v1'};
    }));
    assert.equal(due(h, 'demo-case-02'), '2026-11-06');
    // Підтверджена незастосовність правила строк скасовує — це вже рішення джерела.
    await h.accepted(variant('primary', 'demo-primary-02-not-applicable', event => {
      event.subject_ref = 'demo-person-02';
      event.incident_ref = 'demo-incident-02';
      event.source_record_ref = 'demo-primary-02-second';
      event.payload.enemy_action = 'no';
    }));
    assert.equal(due(h, 'demo-case-02'), null);
    assert.equal(caseSummary(h.store, 'demo-case-02', {staff: true}).certificateDeadline.applicability, 'not_applicable');
  }));

test('строк: суперечлива застосовність «так → ні» йде на розбір, а не скасовує строк мовчки', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted('patient-receipt');
    const denied = nextVersion('primary', 'demo-primary-v2-no', 'v2', 'v1');
    denied.payload.enemy_action = 'no';
    await h.pending(denied);
    assert.deepEqual(h.reviewReasons(), ['applicability_change_unproven']);
    assert.equal(due(h), '2026-11-15');
    // Те саме для резервного документа: довідка про перебування не перекреслює еПМК.
    const hospital = variant('reserve-hospital', 'demo-hospital-contradiction', event => {
      event.subject_ref = 'demo-person-01';
      event.incident_ref = 'demo-incident-01';
      event.payload.enemy_action = 'no';
    });
    await h.pending(hospital);
    assert.equal(due(h), '2026-11-15');
    assert.equal(freshness(h), 'conflict');
  }));

test('строк: неможлива хронологія квитанції — на розбір (до поранення, у майбутньому)', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.pending(variant('patient-receipt', 'demo-receipt-before-injury', event => {
      event.payload.received_at = '2026-10-01T12:00:00Z';
    }));
    await h.pending(variant('patient-receipt', 'demo-receipt-future', event => {
      event.payload.received_at = '2026-12-01T12:00:00Z';
    }));
    assert.deepEqual(h.reviewReasons(), ['receipt_before_injury', 'receipt_in_future']);
    assert.equal(due(h), null);
    assert.equal(h.store.row('SELECT patient_received_at FROM wound_case WHERE id=?', CASE)?.patient_received_at, null);
  }));

test('строк: раніша квитанція іншої версії, що надійшла пізніше, не зрушує підтверджений якір мовчки', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted(nextVersion('primary', 'demo-primary-v2', 'v2', 'v1'));
    // Спершу надійшла квитанція v2 (12.11), потім — раніша квитанція v1 (10.11).
    await h.accepted(variant('patient-receipt', 'demo-receipt-v2-first', event => {
      event.payload.document_version = 'v2';
      event.payload.received_at = '2026-11-12T12:00:00Z';
    }));
    assert.equal(due(h), '2026-11-17');
    await h.pending('patient-receipt');
    assert.deepEqual(h.reviewReasons(), ['receipt_would_move_confirmed_anchor']);
    assert.equal(due(h), '2026-11-17');
  }));

test('строк: повторне внесення еПМК іншим потоком не пересуває орієнтир', () =>
  withHarness(async h => {
    await h.accepted('primary');
    const followUp = () => caseSummary(h.store, CASE, {staff: true}).certificateDeadline.followUpDate;
    assert.equal(followUp(), '2026-11-14');
    await h.accepted(variant('primary', 'demo-primary-second-stream', event => {
      event.source_record_ref = 'demo-primary-second';
      event.recorded_at = '2026-11-12T10:00:00Z';
    }));
    assert.equal(followUp(), '2026-11-14');
    assert.equal(openTasks(h, 'confirm_receipt_date'), 1);
  }));

test('строк: перерахунок без зміни дати не створює другого нагадування', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted('patient-receipt');
    reviewOverdueDeadlines(h.store, Date.parse('2026-11-20T12:00:00Z'));
    assert.equal(certificateReminders(h), 1);
    await h.accepted(nextVersion('primary', 'demo-primary-v2', 'v2', 'v1'));
    reviewOverdueDeadlines(h.store, Date.parse('2026-11-21T12:00:00Z'));
    assert.equal(certificateReminders(h), 1);
  }));

test('нагадування: відкликання виданої довідки повертає нагадування; seed-перевірка закривається видачею', () =>
  withHarness(async h => {
    for (const id of ['primary', 'patient-receipt', 'certificate-prepared']) await h.accepted(id);
    reviewOverdueDeadlines(h.store, Date.parse('2026-11-20T12:00:00Z'));
    await h.login('commander');
    assert.equal((await h.command('issue_certificate')).status, 200);
    await h.accepted('certificate-issued');
    assert.equal(certificateReminders(h), 0);
    await h.accepted(variant('certificate-withdrawn', 'demo-withdraw-v1', event => {
      event.payload.document_version = 'v1';
    }));
    assert.equal(certificateReminders(h), 1);
    reviewOverdueDeadlines(h.store, Date.parse('2026-11-22T12:00:00Z'));
    assert.equal(certificateReminders(h), 1);

    // Кейс 02 має seed-задачу «уточнити стан видачі»; підтверджена видача її закриває.
    assert.equal(openTasks(h, 'certificate_status_check', 'demo-case-02'), 1);
    const forCase02 = (id: string, eventId: string) => variant(id, eventId, event => {
      event.subject_ref = 'demo-person-02';
      event.incident_ref = 'demo-incident-02';
      if ('document_ref' in event.payload) event.payload.document_ref = 'demo-certificate-02';
    });
    await h.accepted(forCase02('certificate-prepared', 'demo-prepared-02'));
    assert.equal((await h.command('issue_certificate', 'demo-case-02')).status, 200);
    await h.accepted(forCase02('certificate-issued', 'demo-issued-02'));
    assert.equal(openTasks(h, 'certificate_status_check', 'demo-case-02'), 0);
  }));

test('ВЛК: дві позитивні постанови поспіль лишають одну дію; старе виконання її не закриває', () =>
  withHarness(async h => {
    await h.accepted('vlk-received');
    await h.accepted('vlk-decision');
    const newer = nextVersion('vlk-decision', 'demo-vlk-positive-v2', 'v2', 'v1');
    newer.occurred_at = '2026-11-13T11:00:00.000Z';
    await h.accepted(newer);
    assert.equal(openTasks(h, 'next_service_action'), 1);
    // Виконання, датоване до чинної постанови, стосується попередньої.
    await h.pending('service-executed');
    assert.deepEqual(h.reviewReasons(), ['service_before_current_decision']);
    assert.equal(openTasks(h, 'next_service_action'), 1);
    await h.accepted(variant('service-executed', 'demo-execute-v2', event => {
      event.occurred_at = '2026-11-13T11:30:00.000Z';
    }));
    assert.equal(openTasks(h, 'next_service_action'), 0);
  }));

test('документи: один запит командира — одна видача; інший вид документа видачу не підтверджує', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted('certificate-prepared');
    await h.login('commander');
    // Без запиту командира видача не приймається.
    await h.pending(variant('certificate-issued', 'demo-issue-without-request'));
    assert.equal((await h.command('issue_certificate')).status, 200);
    // Подія з тим самим посиланням, але іншим видом документа, не закриває задачу видачі.
    await h.pending(variant('certificate-issued', 'demo-issue-wrong-kind', event => {
      event.payload.document_kind = 'referral';
    }));
    assert.equal(openTasks(h, 'issue_certificate'), 1);
    await h.accepted('certificate-issued');
    assert.equal(openTasks(h, 'issue_certificate'), 0);
    // Друга видача без нового запиту не приймається.
    await h.pending(variant('certificate-issued', 'demo-issue-again'));
    assert.equal(h.count("SELECT COUNT(*) AS n FROM document_ref WHERE case_id=? AND kind='trauma_certificate' AND state='issued'", CASE), 1);
    // Повторний запит командира на вже видану довідку відхиляється з поясненням.
    const again = await h.command('issue_certificate');
    assert.equal(again.status, 409);
    assert.equal(((await again.json()) as {error: string}).error, 'certificate_already_issued');
  }));

test('документи: запит видачі без складеної довідки відхиляється; направлення без запиту не приймається', () =>
  withHarness(async h => {
    await h.login('commander');
    const early = await h.command('issue_certificate');
    assert.equal(early.status, 409);
    assert.equal(((await early.json()) as {error: string}).error, 'certificate_not_prepared');
    assert.equal(h.count("SELECT COUNT(*) AS n FROM case_event WHERE event_type='command.issue_certificate'"), 0);
    await h.pending('referral');
    assert.deepEqual(h.reviewReasons(), ['referral_needs_command']);
  }));

test('розбір: суперечність закривається після звірки з джерелом; повторна суперечність видима знову', () =>
  withHarness(async h => {
    await h.accepted('primary');
    const changed = fixtureEvent('primary');
    changed.payload.injury_date = '2026-10-19';
    assert.equal((await h.send(changed)).status, 409);
    assert.equal(freshness(h), 'conflict');

    await h.login('patient');
    const review = String(h.store.row("SELECT id FROM review_item WHERE reason_code='event_conflict'")?.id);
    // Боєць бачить, що є суперечність, але закрити її не може.
    assert.equal(patientCaseView(h.store, CASE).reviews.some(item => item.id === review && !item.closable), true);
    assert.equal((await h.command('close_review', CASE, review)).status, 403);

    await h.login('support');
    const staffReview = caseSummary(h.store, CASE, {staff: true}).reviews.find(item => item.id === review);
    assert.deepEqual([staffReview?.resolvable, staffReview?.closable], [false, true]);
    // Суперечність не можна «підтвердити» як невизначений випадок.
    assert.equal((await h.command('resolve_review', CASE, review)).status, 409);
    assert.equal((await h.command('close_review', 'demo-case-02', review)).status, 409);
    assert.equal((await h.command('close_review', CASE, review)).status, 200);
    assert.equal(freshness(h), 'fresh');
    // Підтверджений стан не змінився.
    assert.equal(h.store.row('SELECT injury_date FROM wound_case WHERE id=?', CASE)?.injury_date, '2026-10-20');
    assert.equal(h.count("SELECT COUNT(*) AS n FROM audit_entry WHERE action_code='command' AND result_code='allowed'"), 1);

    assert.equal((await h.send(changed)).status, 409);
    assert.equal(freshness(h), 'conflict');
    assert.equal(h.count("SELECT COUNT(*) AS n FROM review_item WHERE reason_code='event_conflict' AND state='open'"), 1);
  }));

test('розбір: закритий розбір незастосованої події відкривається знову, якщо джерело надсилає її повторно', () =>
  withHarness(async h => {
    await h.pending('service-executed');
    await h.login('support');
    const review = String(h.store.row("SELECT id FROM review_item WHERE reason_code='service_without_current_decision'")?.id);
    assert.equal((await h.command('close_review', CASE, review)).status, 200);
    assert.equal(freshness(h), 'fresh');
    const again = await h.ingest('service-executed');
    assert.deepEqual([again.http, again.status], [200, 'pending_review']);
    assert.equal(freshness(h), 'conflict');
  }));

test('прогалина: ручну позначку можна закрити вручну; задачу від джерела — ні', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted('gap');
    await h.login('support');
    assert.equal((await h.command('gap')).status, 200);
    const summary = () => caseSummary(h.store, CASE, {staff: true});
    const tasks = summary().tasks.filter(task => task.kind === 'reconcile_missing_event');
    assert.deepEqual(tasks.map(task => task.manual).sort(), [false, true]);
    const manual = tasks.find(task => task.manual);
    const fromSource = tasks.find(task => !task.manual);
    assert(manual && fromSource);
    const refused = await h.command('resolve_task', CASE, fromSource.id);
    assert.equal(refused.status, 409);
    assert.equal(((await refused.json()) as {error: string}).error, 'task_not_closable');
    assert.equal((await h.command('resolve_task', CASE, manual.id)).status, 200);
    // Джерельна прогалина лишилась — дані досі позначено неоновленими.
    assert.equal(freshness(h), 'stale');
    await h.accepted('gap-recovered');
    assert.equal(freshness(h), 'fresh');
    // Боєць не може закривати задачі супроводу.
    await h.login('patient');
    assert.equal((await h.command('resolve_task', CASE, manual.id)).status, 403);
  }));

test('повтори: команда після рестарту дає той самий результат без другого ефекту; права перевіряються знову', () =>
  withHarness(async h => {
    const input = {id: 'demo-restart-command', case_id: CASE, action: 'clarify'} as const;
    const session = resolveSession(h.store, 'support', 'demo-support', NOW);
    const first = executeCommand(h.store, session, input, NOW);
    assert.equal(first.duplicate, undefined);

    const reopened = new Store(h.path, h.auditKey);
    try {
      const tasks = reopened.count("SELECT COUNT(*) AS n FROM task WHERE case_id=? AND kind='clarify_author'", CASE);
      const repeated = executeCommand(reopened, resolveSession(reopened, 'support', 'demo-support', NOW), input, NOW);
      assert.deepEqual(repeated, {...first, duplicate: true});
      assert.equal(reopened.count("SELECT COUNT(*) AS n FROM task WHERE case_id=? AND kind='clarify_author'", CASE), tasks);
      assert.equal(reopened.count('SELECT COUNT(*) AS n FROM outbox'), 1);
      // Той самий ключ від іншого актора — конфлікт, а не чужий результат.
      const commander = resolveSession(reopened, 'commander', 'demo-commander', NOW);
      assert.throws(() => executeCommand(reopened, commander, input, NOW), /command_conflict/);
      // Після відкликання гранта повтор уже прийнятої команди відхиляється.
      reopened.run("UPDATE access_grant SET revoked_at='2026-11-13T00:00:00Z' WHERE id='demo-grant-support'");
      assert.throws(() => executeCommand(reopened, session, input, NOW), /authentication_required/);
    } finally {
      reopened.close();
    }
  }, {file: true}));

test('повтори: події в іншому порядку дають розбір без втрат, а після попередників застосовуються', () =>
  withHarness(async h => {
    // Спершу v3 і виконання, потім v1 і v2: нічого не застосовано передчасно.
    const v2 = nextVersion('primary', 'demo-primary-v2', 'v2', 'v1');
    const v3 = nextVersion('primary', 'demo-primary-v3', 'v3', 'v2');
    await h.accepted('primary');
    await h.pending(v3);
    assert.deepEqual(h.reviewReasons(), ['unproven_revision_order']);
    await h.accepted(v2);
    const applied = await h.ingest(v3);
    assert.equal(applied.status, 'accepted');
    assert.deepEqual(h.reviewReasons(), []);
    assert.equal(h.store.row("SELECT version FROM source_cursor WHERE source='demo-mis' AND event_type='medical.primary_recorded' AND stream='demo-stream-primary'")?.version, 'v3');
    assert.equal(h.count("SELECT COUNT(*) AS n FROM case_event WHERE case_id=? AND event_type='medical.primary_recorded' AND inbox_event_id IS NOT NULL", CASE), 3);
  }));

test('повтори: застаріла фікстура 8а й нова подія того самого випадку не створюють другого кейсу', () =>
  withHarness(async h => {
    assert.equal((await h.send(primaryFixture())).status, 202);
    await h.accepted('primary');
    assert.equal(h.count('SELECT COUNT(*) AS n FROM wound_case'), 30);
    assert.equal(h.count("SELECT COUNT(*) AS n FROM task WHERE case_id=? AND kind='prepare_certificate'", CASE), 1);
  }));
