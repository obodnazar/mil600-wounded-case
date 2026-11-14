import {expect, test} from '@playwright/test';
import {
  BANNER,
  expectNoHorizontalScroll,
  MONEY,
  OGD_AWAITS_VLK,
  openApp,
  openPanel,
  panelNav,
  SCREENS,
  snapshot,
  staffRole,
  type PanelLabel,
} from './support';

const PANELS: readonly {label: PanelLabel; title: string; file: string}[] = [
  {label: 'Мій кейс', title: 'Мій кейс', file: 'patient'},
  {label: 'Супровід', title: 'Супровід кейсів', file: 'staff'},
  {label: 'Аналітика', title: 'Огляд процесу', file: 'analytics'},
  {label: 'Симулятор', title: 'Симулятор джерел', file: 'simulator'},
];

for (const screen of SCREENS) {
  test(`${screen.name}: стартовий екран — чотири панелі й гайд без входу`, async ({page}) => {
    await page.setViewportSize({width: screen.width, height: screen.height});
    await openApp(page);
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expect(page.getByText(BANNER, {exact: true})).toBeVisible();
    await expect(page.locator('.welcome-panel')).toHaveCount(4);
    await expect(page.getByRole('heading', {name: 'Допомога без входу бійця'})).toBeVisible();
    await expect(page.locator('.guide__steps li').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await snapshot(page, `welcome-${screen.name}`, screen.name === 'desktop');
  });

  for (const panel of PANELS) {
    test(`${screen.name}: ${panel.label} — адаптивність і знімок`, async ({page}) => {
      await page.setViewportSize({width: screen.width, height: screen.height});
      await openApp(page);
      await openPanel(page, panel.label);
      await expect(page.getByRole('heading', {level: 1, name: panel.title, exact: true})).toBeVisible();
      await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
      await expect(page.getByText(BANNER, {exact: true})).toBeVisible();
      await expect(panelNav(page).getByRole('button', {name: panel.label, exact: true})).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expectNoHorizontalScroll(page);
      await snapshot(page, `${panel.file}-${screen.name}`, screen.name === 'desktop');
    });
  }
}

test('чотири панелі, серверні межі й стійкий повтор у браузері', async ({page}) => {
  await openApp(page);

  await openPanel(page, 'Мій кейс');
  await expect(page.getByRole('heading', {name: 'Мій кейс', exact: true})).toBeVisible();
  await expect(page.getByText('Дату отримання підтвердити', {exact: true})).toBeVisible();
  await expect(page.getByText(BANNER, {exact: true})).toBeVisible();
  // Кейс 01 на старті не має постанови ВЛК: рядок ОГД із даних видно, і поруч — пояснення (ADR 0011).
  const ogd = page.locator('.finance-route', {hasText: 'Одноразова грошова допомога'});
  await expect(ogd.getByText(OGD_AWAITS_VLK, {exact: true})).toBeVisible();
  await expect(ogd.locator('.finance-period')).toHaveCount(1);
  await expect(page.locator('#finance')).toContainText('у навчальному прототипі їх окремо не змодельовано');
  await expect(page.locator('.finance-route', {hasText: 'Винагорода за час стаціонарного лікування'})).toHaveCount(1);
  await page.getByRole('link', {name: 'Що буде далі'}).click();
  await expect(page.getByRole('heading', {name: 'Ви бачите крок. Супровід веде справу.'})).toBeInViewport();

  await openPanel(page, 'Супровід');
  await expect(page.getByRole('heading', {name: 'Супровід кейсів'})).toBeVisible();
  // Адресний мінімум кейсу 01: заклад і стан виплати без сум, без документних посилань.
  await expect(page.getByRole('heading', {level: 2, name: 'Навчальний учасник 01'})).toBeVisible();
  const address = page.getByRole('region', {name: 'Що бачить частина'});
  await expect(address).toContainText(/Заклад лікування\s*Умовний заклад \d{2}/);
  await expect(address).toContainText(/Винагорода за час стаціонарного лікування · листопад 2026\s*на розгляді/);
  await expect(address).toContainText('Одноразова грошова допомога (ОГД) · листопад 2026');
  await expect(address.getByText(OGD_AWAITS_VLK, {exact: true})).toBeVisible();
  const addressText = await address.innerText();
  expect(addressText).not.toMatch(MONEY);
  expect(addressText).not.toContain('demo-');
  await staffRole(page, 'Командир');
  const forbidden = await page.request.get('/api/cases/demo-case-01/clinical-document');
  expect(forbidden.status()).toBe(403);
  const foreign = await page.request.get('/api/cases/demo-case-11');
  expect(foreign.status()).toBe(404);

  await openPanel(page, 'Аналітика');
  await expect(page.getByRole('heading', {name: 'Огляд процесу'})).toBeVisible();
  await expect(page.locator('.metric')).toHaveCount(6);
  await expect(page.locator('.metric-value')).toHaveCount(6);
  await expect(page.getByText('Малі групи й пов’язані підсумки не розкриваємо')).toBeVisible();
  await expect(page.getByText('Вигаданий розрахунок').first()).toBeVisible();
  await expect(page.getByText('Зовнішній контекст', {exact: true})).toBeVisible();
  const source = page.getByRole('link', {name: /Першоджерело контексту/});
  await expect(source).toHaveAttribute('target', '_blank');
  await expect(source).toHaveAttribute('rel', 'noreferrer');
  const body: unknown = await (await page.request.get('/api/analytics')).json();
  expect(body).not.toHaveProperty('total');
  expect(JSON.stringify(body)).not.toContain('demo-person-');

  await openPanel(page, 'Симулятор');
  await expect(page.getByRole('heading', {name: 'Симулятор джерел'})).toBeVisible();
  await expect(page.getByLabel('Навчальна подія')).toHaveValue('primary');
  await page.getByRole('button', {name: 'Надіслати', exact: true}).click();
  await expect(page.locator('.result')).toContainText(/Прийнято|Повтор/);
  await page.getByRole('button', {name: 'Повторити ту саму подію'}).click();
  await expect(page.locator('.result')).toContainText('Повтор: нових кейсів');
});

test('боєць не бачить технічних деталей, а симулятор — єдине місце для них', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Мій кейс');
  const patientText = await page.locator('main').innerText();
  for (const technical of ['HMAC', 'outbox', 'inbox', 'demo-mis', 'demo-rule-', 'Форма 5']) {
    expect(patientText).not.toContain(technical);
  }
  expect(patientText).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  const certificate = page.locator('.document__title', {hasText: 'довідка про обставини травми (додаток 5 до Наказу №402)'});
  await expect(certificate.first()).toBeVisible();

  await openPanel(page, 'Симулятор');
  await expect(page.locator('main')).toContainText('HMAC');
});
