import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {StaffCaseView, StaffView} from '../../shared/api.js';
import {reviewOverdueDeadlines} from '../domain/deadlines.js';
import {caseSummary} from '../read/case-view.js';
import {fixtureEvent, nextVersion, variant, withHarness, type Harness} from './harness.js';

/** Регресії знахідок третього незалежного проходу 2026-11-14 (TR-01…TR-06) і посилена перевірка витоку полів. */

const CASE = 'demo-case-01';
const lastReason = (h: Harness): string | undefined => h.reviewReasons().at(-1);

async function staffCase(h: Harness, caseId = CASE): Promise<StaffCaseView> {
  const view = (await (await h.get('/api/staff')).json()) as StaffView;
  const item = view.cases.find(entry => entry.id === caseId);
  assert(item, caseId);
  return item;
}

test('TR-01: подія ОГД, датована раніше за чинну постанову ВЛК, не приймається — і при повторній доставці теж', () =>
  withHarness(async h => {
    // Пакет ОГД до будь-якої постанови — на розбір; після постанови, датованої пізніше, його повтор — теж.
    await h.pending('ogd-packet');
    await h.accepted('vlk-received');
    await h.accepted(variant('vlk-decision', 'demo-decision-11', event => {
      event.occurred_at = '2026-11-13T11:00:00.000Z';
    }));
    const redelivered = await h.ingest('ogd-packet');
    assert.deepEqual([redelivered.http, redelivered.status], [200, 'pending_review']);
    // Затриманий пакет, отриманий до постанови, — на розбір.
    await h.pending(variant('ogd-packet', 'demo-ogd-dated-early', event => {
      event.occurred_at = '2026-11-01T09:00:00.000Z';
      event.payload.confirmed_at = '2026-11-01T09:00:00.000Z';
    }));
    assert.equal(lastReason(h), 'ogd_before_vlk_decision');
    // Пакет, отриманий після постанови, приймається.
    await h.accepted(variant('ogd-packet', 'demo-ogd-after', event => {
      event.occurred_at = '2026-11-13T11:30:00.000Z';
      event.payload.confirmed_at = '2026-11-13T11:30:00.000Z';
    }));
  }));

test('TR-01: після запиту ВЛК на уточнення стан ОГД не приймається навіть за вже отриманого пакета', () =>
  withHarness(async h => {
    await h.accepted('vlk-received');
    await h.accepted('vlk-decision');
    await h.accepted('ogd-packet');
    const clarification = nextVersion('vlk-decision', 'demo-clarify-after-ogd', 'v2', 'v1');
    clarification.payload.service_code = 'clarification_needed';
    clarification.occurred_at = '2026-11-13T11:00:00.000Z';
    await h.accepted(clarification);
    await h.pending('ogd-approved');
    assert.equal(lastReason(h), 'ogd_before_vlk_decision');
  }));

test('TR-02: у навчальних даних ОГД і стадії після постанови є лише разом із постановою ВЛК', () =>
  withHarness(async h => {
    const orphanOgd = h.count(
      `SELECT COUNT(*) AS n FROM financial_track f
        WHERE f.payment_kind='ogd'
          AND NOT EXISTS(SELECT 1 FROM case_event e WHERE e.case_id=f.case_id AND e.event_type='vlk.decision_recorded')`,
    );
    assert.equal(orphanOgd, 0);
    const decidedWithout = h.count(
      `SELECT COUNT(*) AS n FROM wound_case c
        WHERE c.lifecycle_state IN ('service_action','finance','completed')
          AND NOT EXISTS(SELECT 1 FROM case_event e WHERE e.case_id=c.id AND e.event_type='vlk.decision_recorded')`,
    );
    assert.equal(decidedWithout, 0);
    await h.login('commander');
    const early = await staffCase(h, CASE);
    assert.deepEqual([early.address.vlkDecision, early.address.finances.map(track => track.kind)], ['none', ['reward']]);
    const decided = await staffCase(h, 'demo-case-04');
    assert.equal(decided.address.vlkDecision, 'recorded');
    assert(decided.address.finances.some(track => track.kind === 'ogd'));
  }));

test('TR-03: командир не бачить нагадування про строк лікування; супровід бачить', () =>
  withHarness(async h => {
    await h.accepted('care-start');
    reviewOverdueDeadlines(h.store, Date.parse('2027-03-01T12:00:00Z'));
    await h.login('support');
    assert((await staffCase(h)).tasks.some(task => task.kind === 'review_deadline'));
    await h.login('commander');
    assert(!(await staffCase(h)).tasks.some(task => task.kind === 'review_deadline'));
  }));

test('TR-04: командир не застосовує розбір фінансової події через ручну звірку випадку', () =>
  withHarness(async h => {
    const withoutIncident = fixtureEvent('reward-packet');
    withoutIncident.incident_ref = null;
    await h.pending(withoutIncident);
    const review = String(h.store.row("SELECT id FROM review_item WHERE reason_code='missing_incident'")?.id);
    await h.login('commander');
    assert.equal((await h.command('resolve_review', CASE, review)).status, 403);
    await h.login('support');
    assert.equal((await h.command('resolve_review', CASE, review)).status, 200);
  }));

test('TR-05: актуальність кейсу для командира не видає прихованих розборів про виплати', () =>
  withHarness(async h => {
    await h.pending('ogd-packet');
    assert.equal(caseSummary(h.store, CASE, {staff: true}).freshness, 'conflict');
    await h.login('support');
    assert.equal((await staffCase(h)).freshness, 'conflict');
    await h.login('commander');
    const commander = await staffCase(h);
    assert.deepEqual([commander.freshness, commander.reviews.length], ['unknown', 0]);
    // Видима проблема (прогалина джерела) командирові показується.
    await h.accepted('gap');
    assert.equal((await staffCase(h)).freshness, 'stale');
  }));

test('TR-06: постанова з майбутнього й неможливий початок лікування — на розбір', () =>
  withHarness(async h => {
    await h.accepted('vlk-received');
    await h.pending(variant('vlk-decision', 'demo-decision-future', event => {
      event.occurred_at = '2027-06-01T10:00:00.000Z';
    }));
    assert.equal(lastReason(h), 'decision_in_future');
    await h.pending(variant('care-start', 'demo-care-future', event => {
      event.payload.date = '2027-03-01';
    }));
    assert.equal(lastReason(h), 'care_start_in_future');
    await h.pending(variant('care-start', 'demo-care-before-injury', event => {
      event.payload.date = '2026-06-01';
    }));
    assert.equal(lastReason(h), 'care_start_before_injury');
  }));

test('адресний мінімум після реальних подій не містить посилань на рішення, доказів, пакетів і записів', () =>
  withHarness(async h => {
    for (const id of ['primary', 'admit', 'reward-packet', 'reward-approved', 'reward-execution_partial', 'vlk-received', 'vlk-decision',
      'ogd-packet', 'ogd-returned', 'ogd-packet-v2', 'ogd-conclusion', 'ogd-approved']) {
      await h.accepted(id);
    }
    for (const profile of ['support', 'commander'] as const) {
      await h.login(profile);
      for (const route of ['/api/staff', `/api/cases/${CASE}`]) {
        const text = await (await h.get(route)).text();
        for (const marker of ['demo-decision-', 'demo-source-proof', 'demo-reward-packet', 'demo-ogd-packet', 'demo-packet-',
          'demo-record-', 'demo-primary-d1', 'demo-d1-episode', 'demo-provider-', 'demo-vlk-decision']) {
          assert(!text.includes(marker), `${profile} ${route}: ${marker}`);
        }
      }
      const item = await staffCase(h);
      assert.deepEqual(item.address.finances.map(track => [track.kind, track.status]).sort(),
        [['ogd', 'approved'], ['reward', 'execution_partial']]);
    }
  }));
