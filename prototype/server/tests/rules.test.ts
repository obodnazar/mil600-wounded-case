import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarDays, calendarMonths, kyivDate, monthEnd} from '../domain/calendar.js';
import {careControl, certificateClock, financeTransitionProblem, mergeEnemyAction, packetProblem} from '../domain/rules.js';
import {COHORT, SMALL_COHORT, computeSnapshot, ratio} from '../read/analytics.js';
import {timelineCategory} from '../read/case-view.js';

test('календар: кінець місяця, високосний рік, Europe/Kyiv і перехід часу — без «120 діб»', () => {
  assert.equal(calendarMonths('2026-10-31', 4), '2027-02-28');
  assert.equal(calendarMonths('2023-10-31', 4), '2024-02-29');
  assert.equal(calendarMonths('2026-10-21', 4), '2027-02-21');
  // Чотири календарні місяці — не стала кількість діб.
  assert.notEqual(calendarMonths('2026-10-21', 4), calendarDays('2026-10-21', 120));
  assert.equal(calendarDays('2026-10-24', 5), '2026-10-29');
  assert.equal(calendarDays('2026-12-29', 5), '2027-01-03');
  assert.equal(kyivDate('2026-10-24T22:30:00Z'), '2026-10-25');
  assert.equal(kyivDate('2026-10-24T20:59:59Z'), '2026-10-24');
  assert.equal(monthEnd('2026-02-01'), '2026-02-28');
  assert.equal(monthEnd('2028-02-01'), '2028-02-29');
  assert.throws(() => calendarDays('2026-02-30', 5));
  assert.throws(() => calendarMonths('26-02-01', 1));
});

test('правило довідки: строк лише за підтвердженого отримання й застосовності; інакше орієнтир або нічого', () => {
  const base = {patientReceivedAt: '2026-11-10T12:00:00Z', sourceRecordedAt: '2026-11-09T10:00:00Z'};
  assert.deepEqual(certificateClock({enemyAction: 'yes', ...base}), {
    applicability: 'applicable',
    anchorStatus: 'confirmed',
    anchorDate: '2026-11-10',
    dueDate: '2026-11-15',
    followUpDate: null,
    needsReceiptConfirmation: false,
  });
  const estimated = certificateClock({enemyAction: 'yes', patientReceivedAt: null, sourceRecordedAt: base.sourceRecordedAt});
  assert.deepEqual([estimated.anchorStatus, estimated.dueDate, estimated.followUpDate], ['estimated', null, '2026-11-14']);
  assert.equal(estimated.needsReceiptConfirmation, true);
  // Невідома застосовність: ні строку, ні орієнтира — навіть за підтвердженого отримання.
  const unknown = certificateClock({enemyAction: 'unknown', ...base});
  assert.deepEqual([unknown.anchorStatus, unknown.dueDate, unknown.followUpDate], ['unknown', null, null]);
  assert.equal(unknown.needsReceiptConfirmation, true);
  // Правило не застосовується: нічого не рахуємо й нічого не просимо уточнити.
  const notApplicable = certificateClock({enemyAction: 'no', ...base});
  assert.deepEqual([notApplicable.applicability, notApplicable.dueDate, notApplicable.needsReceiptConfirmation], ['not_applicable', null, false]);
  // Немає жодної дати — немає вигаданого відліку.
  const nothing = certificateClock({enemyAction: 'yes', patientReceivedAt: null, sourceRecordedAt: null});
  assert.deepEqual([nothing.anchorStatus, nothing.dueDate, nothing.followUpDate], ['unknown', null, null]);
  // Отримання о 23:30 за Києвом рахується київською датою.
  assert.equal(certificateClock({enemyAction: 'yes', patientReceivedAt: '2026-11-10T21:30:00Z', sourceRecordedAt: null}).anchorDate, '2026-11-10');
  assert.equal(certificateClock({enemyAction: 'yes', patientReceivedAt: '2026-11-10T22:30:00Z', sourceRecordedAt: null}).anchorDate, '2026-11-11');
});

test('правило застосовності: підтверджене не знижується; пряма суперечність — розбір', () => {
  assert.deepEqual(mergeEnemyAction('unknown', 'yes'), {value: 'yes', conflict: false});
  assert.deepEqual(mergeEnemyAction('yes', 'unknown'), {value: 'yes', conflict: false});
  assert.deepEqual(mergeEnemyAction('no', 'unknown'), {value: 'no', conflict: false});
  assert.deepEqual(mergeEnemyAction('yes', 'yes'), {value: 'yes', conflict: false});
  assert.deepEqual(mergeEnemyAction('yes', 'no'), {value: 'yes', conflict: true});
  assert.deepEqual(mergeEnemyAction('no', 'yes'), {value: 'no', conflict: true});
});

test('правило лікування: чотири календарні місяці лише за дати й застосовності', () => {
  assert.deepEqual(careControl('2026-10-21', true), {
    applicability: 'applicable', startDate: '2026-10-21', dueDate: '2027-02-21', needsClarification: false,
  });
  assert.deepEqual([careControl(null, true).dueDate, careControl(null, true).needsClarification], [null, true]);
  assert.deepEqual([careControl('2026-10-21', undefined).dueDate, careControl('2026-10-21', undefined).needsClarification], [null, true]);
  assert.deepEqual([careControl('2026-10-21', false).dueDate, careControl('2026-10-21', false).needsClarification], [null, false]);
});

test('правило фінансів: переходи мають доведеного попередника; невідоме не є переходом', () => {
  const approved = {status: 'approved', decisionRef: 'd-approved'};
  const next = (status: string, previousDecisionRef: string | null = 'd-approved') => ({status, previousDecisionRef});
  assert.equal(financeTransitionProblem(null, next('approved', null)), null);
  assert.equal(financeTransitionProblem(null, next('execution_partial', null)), 'execution_without_approval');
  assert.equal(financeTransitionProblem(approved, next('execution_partial')), null);
  assert.equal(financeTransitionProblem(approved, next('execution_confirmed')), null);
  assert.equal(financeTransitionProblem(approved, next('denied', 'd-other')), 'financial_revision_order_unknown');
  assert.equal(financeTransitionProblem(approved, next('denied', null)), 'financial_revision_order_unknown');
  const partial = {status: 'execution_partial', decisionRef: 'd-partial'};
  assert.equal(financeTransitionProblem(partial, next('approved', 'd-partial')), 'execution_regression');
  assert.equal(financeTransitionProblem(partial, next('execution_confirmed', 'd-partial')), null);
  const done = {status: 'execution_confirmed', decisionRef: 'd-done'};
  assert.equal(financeTransitionProblem(done, next('approved', 'd-done')), 'completed_period_revision_review');
  assert.equal(financeTransitionProblem(done, next('execution_confirmed', 'd-done')), 'execution_without_approval');
  // Невідомий сигнал ніколи не блокується й нічого не переводить.
  for (const prior of [null, approved, partial, done]) assert.equal(financeTransitionProblem(prior, next('unknown', null)), null);
  // Повернення й відмова до будь-якого рішення — звичайні стани.
  assert.equal(financeTransitionProblem({status: 'under_review', decisionRef: null}, next('returned', null)), null);
  assert.equal(financeTransitionProblem({status: 'returned', decisionRef: 'd-returned'}, next('denied', 'd-returned')), null);
});

test('правило пакета: повернення без отримання, інший період, недоведена ревізія, чужий адресат', () => {
  const signal = {returned: false, revision: 'v1', period: null, supersedesRevision: null, recipientRef: 'demo-vlk', expectedRecipient: 'demo-vlk'};
  assert.equal(packetProblem(null, signal), null);
  assert.equal(packetProblem(null, {...signal, returned: true}), 'return_without_receipt');
  assert.equal(packetProblem({revision: 'v1', period: '2026-11'}, {...signal, period: '2026-10'}), 'packet_period_mismatch');
  assert.equal(packetProblem({revision: 'v1', period: null}, {...signal, revision: 'v2'}), 'packet_revision_order_unknown');
  assert.equal(packetProblem({revision: 'v1', period: null}, {...signal, revision: 'v2', supersedesRevision: 'v1'}), null);
  assert.equal(packetProblem(null, {...signal, recipientRef: 'demo-finance'}), 'packet_recipient_mismatch');
});

test('AC08: показники BO обчислюються з когорти; знаменники, невідомі, поріг і порожній знаменник', () => {
  const metric = (view: ReturnType<typeof computeSnapshot>, id: string) => {
    const found = view.metrics.find(item => item.id === id);
    assert(found, id);
    return found;
  };
  const full = computeSnapshot();
  assert.equal(metric(full, 'BO-1').value, '14 днів');
  assert.equal(metric(full, 'BO-1').coverage, '15 з датами; 5 без дати; 10 відкритих');
  assert.equal(metric(full, 'BO-2').value, 'ВЛК 40% · ОГД 25%');
  assert.equal(metric(full, 'BO-3').value, '5/20');
  assert.equal(metric(full, 'BO-3').coverage, '20/30 з підтвердженням; 10 невідомих');
  assert.equal(metric(full, 'BO-5').value, '44.4%');
  assert.equal(metric(full, 'BO-6').value, '6 кейсів на ставку · 10 хв/кейс');
  assert(full.metrics.filter(item => item.id !== 'BO-4').every(item => item.state === 'demo'));

  // Значення справді залежать від даних, а не намальовані.
  const changed = computeSnapshot(COHORT.map((row, i) => ({...row, vlkReturned: i < 5, decision: row.decision ? '2026-10-21' : null})));
  assert.equal(metric(changed, 'BO-1').value, '20 днів');
  assert.equal(metric(changed, 'BO-2').value, 'ВЛК 20% · ОГД 25%');

  // Нульовий знаменник — «недостатньо даних», а не 0 %.
  assert.equal(ratio(1, 0), null);
  assert.equal(ratio(0, 0), null);
  const empty = computeSnapshot([]).metrics.filter(item => item.id !== 'BO-4');
  assert(empty.every(item => item.state === 'insufficient' && item.value === 'Недостатньо даних'));
  assert.equal(metric(computeSnapshot(COHORT, null), 'BO-6').state, 'insufficient');
  // Частка округлюється до десятих, а не показує неокруглений дріб.
  assert.equal(metric(computeSnapshot(COHORT, 7), 'BO-6').value, '4.3 кейсів на ставку · 10 хв/кейс');
  const noDates = computeSnapshot(COHORT.map(row => ({...row, injury: null})));
  assert.equal(metric(noDates, 'BO-1').state, 'insufficient');

  // Мала група: приховано значення, підсумки й покриття — жодної цифри.
  const small = computeSnapshot(SMALL_COHORT).metrics.filter(item => item.id !== 'BO-4');
  assert(small.every(item => item.state === 'suppressed' && item.value === 'Приховано'));
  assert(small.every(item => !/\d/.test(item.coverage ?? '') && !/\d/.test(item.detail)));
  // Мала ДОПОВНЮВАЛЬНА клітинка теж приховує показник: її не відновити відніманням.
  const complement = computeSnapshot(COHORT.map((row, i) => ({...row, vlkReturned: i < 4})));
  assert.equal(metric(complement, 'BO-2').state, 'suppressed');
  assert.equal(metric(complement, 'BO-2').coverage, 'Покриття приховане разом із групою');
  const stopFor = (i: number) => (i < 5 ? 'confirmed_missed_exam' : i < 27 ? 'confirmed_no_stop' : 'unknown') as typeof COHORT[number]['stop'];
  const fewUnknown = computeSnapshot(COHORT.map((row, i) => ({...row, stop: stopFor(i)})));
  assert.equal(metric(fewUnknown, 'BO-3').state, 'suppressed');

  // BO-4 — зовнішній контекст із джерелом; з когорти не обчислюється.
  for (const view of [full, computeSnapshot([]), computeSnapshot(SMALL_COHORT)]) {
    const context = metric(view, 'BO-4');
    assert.equal(context.state, 'context');
    assert.equal(context.value, '23% із 2 455');
    assert(context.source?.startsWith('https://milomb.gov.ua/'));
  }
  assert.equal(full.status, 'synthetic_fixed_snapshot');
  assert.equal(full.minimum, 5);
});

test('таймлайн: кожен тип події має категорію', () => {
  assert.equal(timelineCategory('medical.primary_recorded'), 'medical');
  assert.equal(timelineCategory('care.transferred'), 'medical');
  assert.equal(timelineCategory('document.issued'), 'documents');
  assert.equal(timelineCategory('command.issue_certificate'), 'documents');
  assert.equal(timelineCategory('referral.issued'), 'vlk');
  assert.equal(timelineCategory('vlk.decision_recorded'), 'vlk');
  assert.equal(timelineCategory('service.action_confirmed'), 'vlk');
  assert.equal(timelineCategory('command.refer_vlk'), 'vlk');
  assert.equal(timelineCategory('finance.status_recorded'), 'finance');
  assert.equal(timelineCategory('source.sync_gap'), 'sync');
  assert.equal(timelineCategory('command.support_request'), 'requests');
});
