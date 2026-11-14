import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {StaffView} from '../../shared/api.js';
import {caseSummary, patientCaseView} from '../read/case-view.js';
import {NOW, fixtureEvent, variant, withHarness, type Harness} from './harness.js';

/** Регресії знахідок повторного незалежного проходу 2026-11-14 (RR-01…RR-11). */

const CASE = 'demo-case-01';
const openTasks = (h: Harness, kind: string, caseId = CASE): number =>
  h.count("SELECT COUNT(*) AS n FROM task WHERE case_id=? AND kind=? AND status='open'", caseId, kind);
const milestones = (h: Harness) => patientCaseView(h.store, CASE).milestones;
const lastReason = (h: Harness): string | undefined => h.reviewReasons().at(-1);

async function issueCertificate(h: Harness, record = 'demo-certificate-d1'): Promise<void> {
  const withRecord = (id: string, eventId: string) => variant(id, eventId, event => {
    event.payload.document_ref = record;
  });
  await h.accepted(withRecord('certificate-prepared', `demo-prepared-${record}`));
  await h.login('commander');
  assert.equal((await h.command('issue_certificate')).status, 200);
  await h.accepted(withRecord('certificate-issued', `demo-issued-${record}`));
}

test('RR-01: виправлена видана довідка переносить очікування квитанції на нову версію', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await issueCertificate(h);
    await h.accepted('certificate-corrected');
    const receipts = h.store.rows(
      "SELECT trigger_ref,status FROM task WHERE case_id=? AND kind='await_recipient_receipt' ORDER BY rowid",
      CASE,
    );
    assert.deepEqual(receipts.map(row => row.status), ['resolved', 'open']);
    assert.match(String(receipts[1]?.trigger_ref), /:v2$/);
    await h.accepted('certificate-received-v2');
    assert.equal(openTasks(h, 'await_recipient_receipt'), 0);
  }));

test('RR-02: подія «складено» від джерела документообігу не створює направлення без запиту', () =>
  withHarness(async h => {
    const forged = variant('certificate-prepared', 'demo-sedo-referral', event => {
      event.source_system = 'demo-sedo';
      event.payload.document_kind = 'referral';
      event.payload.document_ref = 'demo-referral-forged';
    });
    assert.equal((await h.send(forged)).status, 403);
    assert.equal(milestones(h).referral, 'none');
    await h.login('commander');
    assert.equal((await h.command('refer_vlk')).status, 200);
  }));

test('RR-03: командир не бачить і не закриває розборів фінансових подій із загальною причиною', () =>
  withHarness(async h => {
    await h.accepted('reward-packet');
    const conflicting = fixtureEvent('reward-packet');
    conflicting.payload.confirmed_at = '2026-11-12T10:00:00.000Z';
    assert.equal((await h.send(conflicting)).status, 409);
    const staff = async () => {
      const view = (await (await h.get('/api/staff')).json()) as StaffView;
      return view.cases.find(item => item.id === CASE);
    };
    await h.login('support');
    const review = (await staff())?.reviews.find(item => item.reason === 'event_conflict');
    assert(review?.closable);
    await h.login('commander');
    assert(!(await staff())?.reviews.some(item => item.reason === 'event_conflict'));
    const single = (await (await h.get(`/api/cases/${CASE}`)).json()) as {reviews: {reason: string}[]};
    assert(!single.reviews.some(item => item.reason === 'event_conflict'));
    assert.equal((await h.command('close_review', CASE, review.id)).status, 403);
  }));

test('RR-04: квитанція нового запису з тією самою версією очікується окремо', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await issueCertificate(h);
    await h.accepted(variant('certificate-received', 'demo-receipt-d1-v1'));
    assert.equal(openTasks(h, 'await_recipient_receipt'), 0);
    await h.accepted(variant('certificate-withdrawn', 'demo-withdraw-d1-v1', event => {
      event.payload.document_version = 'v1';
    }));
    await issueCertificate(h, 'demo-certificate-d2');
    assert.equal(openTasks(h, 'await_recipient_receipt'), 1);
  }));

test('RR-05: повторна доставка з новим event_id, але тим самим змістом, не обходить перевірку часу запиту', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted('certificate-prepared');
    await h.pending('certificate-issued');
    h.setNow(NOW + 60 * 60 * 1000);
    await h.login('commander');
    assert.equal((await h.command('issue_certificate')).status, 200);
    const renamed = fixtureEvent('certificate-issued');
    renamed.event_id = 'demo-issued-renamed';
    const result = await h.ingest(renamed);
    assert.equal(result.status, 'pending_review');
    assert.equal(milestones(h).certificate, 'requested');
  }));

test('RR-07: неможлива мітка часу — розбір, а не 503 із втратою події', () =>
  withHarness(async h => {
    const leap = variant('primary', 'demo-primary-leap-second', event => {
      event.recorded_at = '2026-06-30T23:59:60Z';
    });
    const result = await h.ingest(leap);
    // Зараз таку мітку відхиляє схема (400): джерело одразу бачить відмову, нескінченних 503 немає.
    // Якщо схема колись її пропустить, RangeError у домені має дати розбір, а не 503.
    if (result.http === 400) return;
    assert.deepEqual([result.http, result.status], [202, 'pending_review']);
    assert.equal(lastReason(h), 'unprocessable_event');
  }));

test('RR-08: повторний невідомий фінансовий сигнал знову відкриває уточнення', () =>
  withHarness(async h => {
    await h.accepted('reward-packet');
    await h.accepted('reward-approved');
    await h.accepted('reward-unknown');
    await h.accepted('reward-execution_partial');
    assert.equal(caseSummary(h.store, CASE, {staff: true}).freshness, 'fresh');
    await h.accepted(variant('reward-unknown', 'demo-reward-unknown-again'));
    assert.equal(caseSummary(h.store, CASE, {staff: true}).freshness, 'stale');
    const reward = patientCaseView(h.store, CASE).finances.find(track => track.kind === 'reward');
    assert.deepEqual([reward?.status, reward?.clarificationOpen], ['execution_partial', true]);
  }));

test('RR-09: чинність постанови порівнює моменти часу з різними зсувами', () =>
  withHarness(async h => {
    await h.accepted('vlk-received');
    const decision = (id: string, at: string, clarify = false) => variant('vlk-decision', id, event => {
      event.occurred_at = at;
      event.payload.document_ref = id;
      if (clarify) event.payload.service_code = 'clarification_needed';
    });
    await h.accepted(decision('demo-decision-offset', '2026-11-13T23:00:00+05:00'));
    await h.accepted(decision('demo-decision-clarify-20', '2026-11-13T20:00:00Z', true));
    await h.pending(decision('demo-decision-positive-19', '2026-11-13T19:00:00Z'));
    assert.equal(lastReason(h), 'decision_older_than_current');
    assert.equal(milestones(h).vlkDecision, 'clarification_needed');
  }));

test('RR-10: направлення не відкочує стадію кейсу після постанови', () =>
  withHarness(async h => {
    await h.accepted('vlk-received');
    await h.accepted('vlk-decision');
    await h.login('commander');
    assert.equal((await h.command('refer_vlk')).status, 200);
    await h.accepted('referral');
    assert.equal(patientCaseView(h.store, CASE).stage, 'service_action');
  }));

test('RR-11: виправлена складена версія медичного документа лишається складеною', () =>
  withHarness(async h => {
    const prepared = variant('certificate-prepared', 'demo-summary-prepared', event => {
      event.payload.document_kind = 'medical_summary';
      event.payload.document_ref = 'demo-summary-mis';
    });
    await h.accepted(prepared);
    const corrected = variant('certificate-corrected', 'demo-summary-corrected', event => {
      event.source_system = 'demo-mis';
      event.payload.document_kind = 'medical_summary';
      event.payload.document_ref = 'demo-summary-mis';
    });
    await h.accepted(corrected);
    const states = h.store.rows(
      "SELECT document_version,state,active FROM document_ref WHERE case_id=? AND source_record_ref='demo-summary-mis' ORDER BY rowid",
      CASE,
    );
    assert.deepEqual(states.map(row => [row.document_version, row.state, row.active]), [['v1', 'prepared', 0], ['v2', 'prepared', 1]]);
  }));
