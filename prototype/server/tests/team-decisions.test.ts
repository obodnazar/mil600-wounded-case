import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patientCaseView} from '../read/case-view.js';
import {fixtureEvent, variant, withHarness, type Harness} from './harness.js';

/** Рішення команди 2026-11-14: направлення закладом (ADR 0013) і ОГД як одна виплата. */

const CASE = 'demo-case-01';
const lastReason = (h: Harness): string | undefined => h.reviewReasons().at(-1);
const milestones = (h: Harness) => patientCaseView(h.store, CASE).milestones;

test('ADR 0013: заклад поточного лікування направляє на ВЛК без запиту командира; друге направлення не створюється', () =>
  withHarness(async h => {
    await h.accepted('primary');
    // Без поточного епізоду лікування заклад направити не може.
    await h.pending('referral-facility');
    assert.equal(lastReason(h), 'facility_referral_without_current_care');
    await h.accepted('admit');
    // Інший заклад, ніж той, де боєць зараз лікується, — на розбір.
    await h.pending(variant('referral-facility', 'demo-referral-other-provider', event => {
      event.payload.provider_ref = 'demo-provider-5';
    }));
    assert.equal(lastReason(h), 'facility_referral_without_current_care');
    await h.accepted(variant('referral-facility', 'demo-referral-facility-ok'));
    assert.equal(milestones(h).referral, 'issued_by_facility');
    assert.equal(h.store.row('SELECT lifecycle_state FROM wound_case WHERE id=?', CASE)?.lifecycle_state, 'vlk');
    assert.equal(h.count("SELECT COUNT(*) AS n FROM task WHERE case_id=? AND kind='await_vlk_receipt' AND status='open'", CASE), 1);
    // Командирові направляти вдруге не пропонується; повторне направлення від закладу — на розбір.
    await h.login('commander');
    assert.notEqual((await h.command('refer_vlk')).status, 200);
    await h.pending(variant('referral-facility', 'demo-referral-facility-second', event => {
      event.payload.document_ref = 'demo-referral-facility-2';
      event.source_record_ref = 'demo-record-referral-facility-2';
    }));
    assert.equal(lastReason(h), 'referral_already_active');
  }));

test('ADR 0013: «від закладу» не може надіслати документообіг, а командирське — медична система', () =>
  withHarness(async h => {
    await h.accepted('primary');
    await h.accepted('admit');
    const commanderFromMis = fixtureEvent('referral-facility');
    commanderFromMis.event_id = 'demo-commander-from-mis';
    commanderFromMis.payload.issuer_ref = 'demo-commander';
    await h.pending(commanderFromMis);
    assert.equal(lastReason(h), 'referral_needs_command');
    assert.equal(milestones(h).referral, 'none');
  }));
