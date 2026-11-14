import {expect, type Locator, type Page} from '@playwright/test';

export const BANNER = 'Навчальний прототип KSE. Не офіційний сервіс Міноборони. Дані вигадані';

export const SCREENS = [
  {name: 'desktop', width: 1440, height: 1050},
  {name: 'mobile', width: 390, height: 844},
] as const;

/** Пояснення ADR 0011: ОГД чекає на чинну постанову ВЛК. */
export const OGD_AWAITS_VLK = 'ОГД розглядається лише після постанови ВЛК: її висновок про причинний зв’язок поранення входить до пакета ОГД.';

/** Маркери сум: службова панель і адресний мінімум не показують грошових значень. */
export const MONEY = /грн|₴|UAH|\d[\d\s\u00a0]*,\d{2}/;

export type PanelLabel = 'Мій кейс' | 'Супровід' | 'Аналітика' | 'Симулятор';

/** Навігація панелями: єдиний nav із цим підписом (бічний на desktop, нижній на телефоні). */
export function panelNav(page: Page): Locator {
  return page.getByRole('navigation', {name: 'Демо-панелі'});
}

export function refreshButton(page: Page): Locator {
  return page.getByRole('button', {name: 'Оновити', exact: true});
}

/** Відкриває застосунок і чекає стартового екрана (роль не вибрано). */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', {level: 1})).toContainText('Від події');
}

/** Перемикає панель (навчальну роль) і чекає, доки дані завантажаться. */
export async function openPanel(page: Page, label: PanelLabel): Promise<void> {
  await panelNav(page).getByRole('button', {name: label, exact: true}).click();
  await expect(refreshButton(page)).toBeEnabled();
}

/** Перемикає роль усередині службової панелі. */
export async function staffRole(page: Page, role: 'Супровід' | 'Командир'): Promise<void> {
  const toggle = page.getByRole('group', {name: 'Навчальна роль у частині'}).getByRole('button', {name: role});
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(refreshButton(page)).toBeEnabled();
}

/** Вибирає кейс у списку службової панелі за номером учасника. */
export async function selectCase(page: Page, number: string): Promise<void> {
  // Резервний кейс має ту саму назву учасника, тому відрізняємо його за позначкою.
  const item = page.locator('.case-item').filter({hasText: `Навчальний учасник ${number}`});
  await item.filter({hasNotText: 'Резервний запит'}).click();
  await expect(page.getByRole('heading', {level: 2, name: `Навчальний учасник ${number}`})).toBeVisible();
}

/** Надсилає навчальну подію в симуляторі й чекає відповіді сервера. */
export async function sendFixture(page: Page, id: string, expected: RegExp = /Прийнято|Повтор:/): Promise<void> {
  await page.getByLabel('Навчальна подія').selectOption(id);
  await page.getByRole('button', {name: 'Надіслати', exact: true}).click();
  await expect(page.locator('.result')).toContainText(expected);
  await expect(refreshButton(page)).toBeEnabled();
}

export async function sendFixtures(page: Page, ids: readonly string[]): Promise<void> {
  for (const id of ids) await sendFixture(page, id);
}

/** Сторінка не має горизонтального скролу. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width);
}

/** Знімки пишемо лише за UPDATE_SCREENSHOTS=true, щоб звичайний прогін не змінював репозиторій. */
export async function snapshot(page: Page, file: string, fullPage = true): Promise<void> {
  if (process.env.UPDATE_SCREENSHOTS !== 'true') return;
  // Знімок усієї сторінки робимо з початку: інакше закріплені банер і навігація потрапляють посередині.
  if (fullPage) await page.evaluate(() => window.scrollTo({top: 0, behavior: 'instant'}));
  await page.mouse.move(0, 0);
  await page.screenshot({path: `screenshots/${file}.png`, fullPage});
}

/** Послідовність D1: події симулятора між діями командира (id фікстур — частина контракту демо). */
export const D1 = {
  intake: ['primary', 'admit', 'care-start', 'transfer', 'patient-receipt', 'certificate-prepared'],
  certificateAndReward: [
    'certificate-issued',
    'certificate-sent',
    'certificate-received',
    'reward-packet',
    'reward-approved',
    'reward-execution_partial',
    'reward-execution_confirmed',
  ],
  vlkAndOgd: [
    'referral',
    'vlk-received',
    'vlk-decision',
    'service-executed',
    'ogd-packet',
    'ogd-returned',
    'ogd-packet-v2',
    'ogd-conclusion',
    'ogd-approved',
    'ogd-execution_confirmed',
  ],
} as const;
