import {expect, test} from '@playwright/test';
import {D1, MONEY, OGD_AWAITS_VLK, openApp, openPanel, sendFixtures, snapshot, staffRole} from './support';

test('D1 у браузері: команди ролей, джерела, два види виплат, таймлайн і малий агрегат', async ({page}) => {
  test.setTimeout(120_000);
  await openApp(page);

  await openPanel(page, 'Симулятор');
  await sendFixtures(page, D1.intake);

  await openPanel(page, 'Супровід');
  const actions = page.getByRole('region', {name: 'Дії'});
  await expect(page.getByRole('heading', {level: 2, name: 'Навчальний учасник 01'})).toBeVisible();
  await expect(actions.getByRole('button', {name: 'Направити на ВЛК', exact: true})).toBeDisabled();
  // Заклад після переведення — від джерела; виплати — лише вид, місяць і стан.
  const address = page.getByRole('region', {name: 'Що бачить частина'});
  await expect(address).toContainText(/Заклад лікування\s*Умовний заклад \d{2}/);
  expect(await address.innerText()).not.toMatch(MONEY);
  await staffRole(page, 'Командир');
  await actions.getByRole('button', {name: 'Запит видачі довідки', exact: true}).click();
  await expect(page.locator('.global-result')).toContainText('Запит збережено');
  await expect(page.locator('.global-result')).toContainText('кнопка не створює підтвердженого документа');
  await expect(actions.getByText('Запит подано; чекаємо підтвердження джерела')).toBeVisible();
  const pending = actions.getByRole('button', {name: 'Запит видачі довідки', exact: true});
  await expect(pending).toBeDisabled();
  await expect(pending).toHaveAccessibleDescription(/Запит уже подано/);

  await openPanel(page, 'Симулятор');
  await sendFixtures(page, D1.certificateAndReward);

  await openPanel(page, 'Мій кейс');
  await expect(page.getByText('Виконання підтверджене джерелом', {exact: true})).toBeVisible();
  await expect(page.getByText('Адміністративну дію виконано', {exact: true})).toHaveCount(0);
  await expect(page.getByText(OGD_AWAITS_VLK, {exact: true})).toBeVisible();

  await openPanel(page, 'Супровід');
  await staffRole(page, 'Командир');
  await actions.getByRole('button', {name: 'Направити на ВЛК', exact: true}).click();
  await expect(page.locator('.global-result')).toContainText('Запит збережено');

  await openPanel(page, 'Симулятор');
  await sendFixtures(page, D1.vlkAndOgd);
  await expect(page.locator('.demo-path__event svg')).toHaveCount(24);
  await snapshot(page, 'simulator-after-d1-desktop');

  await openPanel(page, 'Мій кейс');
  await expect(page.getByText('Виконання підтверджене джерелом', {exact: true})).toHaveCount(2);
  await expect(page.getByText('Схвалено; виконання ще не підтверджене', {exact: true})).toHaveCount(1);
  await expect(page.locator('main')).not.toContainText(/кошти отримано|виплачено/i);
  await expect(page.locator('.finance-route')).toHaveCount(2);
  // Після постанови ВЛК пояснення-очікування зникає: ОГД уже розглядається.
  await expect(page.getByText(OGD_AWAITS_VLK, {exact: true})).toHaveCount(0);

  const documents = page.getByRole('group', {name: 'Перелік документів'});
  await expect(documents.getByRole('button', {name: 'ВЛК', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await documents.getByRole('button', {name: 'ОГД · жовтень 2026'}).click();
  await expect(page.locator('.document')).toHaveCount(2);
  await snapshot(page, 'd1-patient-desktop');

  // Таймлайн: спершу останні 8, далі «Показати ще», фільтр за категорією, деталі події.
  const filter = page.getByRole('group', {name: 'Фільтр подій за категорією'});
  await expect(page.locator('.timeline__entry')).toHaveCount(8);
  await page.getByRole('button', {name: /^Показати ще/}).click();
  await expect(page.locator('.timeline__entry')).toHaveCount(18);
  await filter.getByRole('button', {name: /ВЛК і служба/}).click();
  await expect(filter.getByRole('button', {name: /ВЛК і служба/})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Адміністративну дію виконано', {exact: true})).toHaveCount(1);
  const decision = page.locator('.timeline__entry', {hasText: 'Постанову ВЛК оформлено'});
  await decision.locator('summary').click();
  await expect(decision).toContainText('Виконати адміністративну дію за постановою ВЛК');
  await expect(decision).toContainText('Відповідає: Командир');
  await expect(decision).toContainText('Виконано');
  const executed = page.locator('.timeline__entry', {hasText: 'Адміністративну дію виконано'});
  await executed.locator('summary').click();
  await expect(executed).toContainText('Подія лише підтверджує факт; наступної дії не потребує.');
  await expect(executed).toContainText('Симуляція');
  await filter.getByRole('button', {name: /^Усі/}).click();
  const more = page.getByRole('button', {name: /^Показати ще/});
  const total = Number(await filter.getByRole('button', {name: /^Усі/}).locator('.segmented__count').innerText());
  expect(total).toBeGreaterThanOrEqual(27);
  for (let shown = 8; shown < total; shown += 10) await more.click();
  await expect(more).toHaveCount(0);
  await expect(page.locator('.timeline__entry')).toHaveCount(total);
  if (process.env.UPDATE_SCREENSHOTS === 'true') {
    // Високе вікно: довгий журнал уміщується цілком, і закріплений банер не перекриває рядки.
    await page.setViewportSize({width: 1440, height: 2600});
    await page.locator('#timeline').screenshot({path: 'screenshots/d1-timeline-desktop.png'});
    await page.setViewportSize({width: 1440, height: 1000});
  }
  await page.getByRole('button', {name: /^Згорнути до останніх/}).click();
  await expect(page.locator('.timeline__entry')).toHaveCount(8);

  await openPanel(page, 'Симулятор');
  await page.getByRole('button', {name: 'Мала група · перевірити приховування', exact: true}).click();
  await expect(page.locator('.result')).toContainText('зріз обрано');
  await openPanel(page, 'Аналітика');
  await expect(page.locator('.metric-value').filter({hasText: 'Приховано'})).toHaveCount(5);
  await expect(page.locator('.metric')).toHaveCount(6);
  await snapshot(page, 'suppressed-analytics-desktop');

  await openPanel(page, 'Симулятор');
  await page.getByRole('button', {name: 'Основний вигаданий зріз', exact: true}).click();
  await expect(page.locator('.result')).toContainText('зріз обрано');
  await openPanel(page, 'Аналітика');
  await expect(page.locator('.metric-value').filter({hasText: 'Приховано'})).toHaveCount(0);
});
