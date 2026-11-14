import {expect, test, type Page} from '@playwright/test';
import {openApp, openPanel, refreshButton, selectCase, snapshot, staffRole} from './support';

const requestHelp = (page: Page) => page.getByRole('button', {name: 'Попросити уточнення', exact: true});
const patientTitle = (page: Page) => page.getByRole('heading', {name: 'Мій кейс', exact: true});

test('збій мережі не показує успіх; повтор команди йде з тим самим ключем', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Мій кейс');
  const ids: string[] = [];
  let lose = true;
  await page.route('**/api/commands', async route => {
    const body: {id: string} = route.request().postDataJSON();
    ids.push(body.id);
    if (lose) {
      lose = false;
      await route.fetch();
      await route.abort('failed');
    } else {
      await route.continue();
    }
  });

  await requestHelp(page).click();
  await expect(page.getByRole('alert')).toContainText('Мережевий збій');
  await expect(page.getByRole('alert')).toContainText('не вважається виконаною');
  await expect(page.locator('.global-result')).toHaveCount(0);
  await expect(patientTitle(page)).toBeVisible();
  await snapshot(page, 'state-network-error-desktop', false);

  await page.getByRole('button', {name: 'Повторити', exact: true}).click();
  await expect(page.locator('.global-result')).toContainText('Запит збережено');
  await expect(page.locator('.global-result')).toContainText('Це повтор');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toMatch(/^demo-[a-z0-9-]{1,60}$/);
  expect(ids[0]).toBe(ids[1]);
});

test('зміна ролі при збої завантаження прибирає дані попередньої панелі', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Мій кейс');
  await expect(page.locator('.timeline')).toHaveCount(1);
  await page.route('**/api/staff', route => route.abort('failed'));

  await page.getByRole('navigation', {name: 'Демо-панелі'}).getByRole('button', {name: 'Супровід', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Мережевий збій');
  await expect(patientTitle(page)).toHaveCount(0);
  await expect(page.locator('.timeline')).toHaveCount(0);
  await expect(page.locator('.next-step')).toHaveCount(0);
  await expect(page.getByRole('heading', {level: 1, name: 'Супровід кейсів'})).toBeVisible();

  await page.unroute('**/api/staff');
  await page.getByRole('button', {name: 'Повторити', exact: true}).click();
  await expect(page.getByRole('heading', {level: 2, name: 'Призначені кейси'})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('підтверджений POST і збій оновлення: успішний запис не оголошується втраченим', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Мій кейс');
  await page.route('**/api/patient', route => route.abort('failed'));

  await requestHelp(page).click();
  await expect(page.getByRole('alert')).toContainText('Дію підтверджено сервером, але панель не оновлено');
  await expect(page.locator('.global-result')).toContainText('Запит збережено');
  await expect(patientTitle(page)).toBeVisible();

  await page.unroute('**/api/patient');
  await page.getByRole('button', {name: 'Оновити панель', exact: true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.global-result')).toContainText('Запит збережено');
});

test('застарілі дані: невдале оновлення лишає попередній стан і позначає його', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Мій кейс');
  await page.route('**/api/patient', route => route.abort('failed'));

  await refreshButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Дані не оновлено');
  await expect(page.getByRole('alert')).toContainText('попередні підтвердження збережено');
  await expect(page.locator('.sync-note--stale')).toContainText('Не оновлено');
  await expect(patientTitle(page)).toBeVisible();
});

test('завершення сесії за 401: дані ролі прибрано, нова сесія починається з вибору ролі', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Мій кейс');
  await page.route('**/api/patient', route =>
    route.fulfill({status: 401, contentType: 'application/json', body: JSON.stringify({error: 'authentication_required'})}),
  );

  await refreshButton(page).click();
  await expect(page.getByRole('heading', {level: 1, name: 'Сесія завершилась'})).toBeVisible();
  await expect(patientTitle(page)).toHaveCount(0);
  await expect(page.locator('.timeline')).toHaveCount(0);
  await expect(refreshButton(page)).toHaveCount(0);
  await snapshot(page, 'state-session-ended-desktop', false);

  await page.unroute('**/api/patient');
  await page.getByRole('button', {name: 'Почати нову сесію'}).click();
  await expect(page.getByRole('heading', {level: 1})).toContainText('Від події');
});

test('сесія попереджає за хвилину до кінця, продовжується і завершується за expiresAt', async ({page}) => {
  let lifetime = 30_000;
  await page.route('**/api/session', async route => {
    const response = await route.fetch();
    const session: {expiresAt: number} = await response.json();
    await route.fulfill({response, json: {...session, expiresAt: Date.now() + lifetime}});
  });
  await page.goto('/');
  const warning = page.getByText('Сесія завершиться менш ніж за хвилину');
  await expect(warning).toBeVisible();

  await page.getByRole('button', {name: 'Продовжити сесію'}).click();
  await expect(warning).toHaveCount(0);
  await expect(page.getByRole('heading', {level: 1})).toContainText('Від події');

  lifetime = 1_500;
  await page.reload();
  await expect(page.getByRole('heading', {level: 1, name: 'Сесія завершилась'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Почати нову сесію'})).toBeVisible();
});

test('429 із Retry-After: зрозуміле повідомлення й повтор лише після очікування', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Мій кейс');
  await page.route('**/api/commands', route =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: {'Retry-After': '60'},
      body: JSON.stringify({error: 'rate_limited'}),
    }),
  );

  await requestHelp(page).click();
  await expect(page.getByRole('alert')).toContainText('Забагато запитів. Повторіть через 60 с');
  await expect(page.locator('.global-result')).toHaveCount(0);
  const retry = page.getByRole('button', {name: /^Повторити через \d+ с$/});
  await expect(retry).toBeDisabled();
});

test('відмова 403: пояснення без повтору, запис не оголошується виконаним', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Супровід');
  await page.route('**/api/commands', route =>
    route.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({error: 'command_forbidden'})}),
  );

  await page.getByRole('button', {name: 'Уточнити в автора', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Недостатньо прав для цієї дії');
  await expect(page.getByRole('alert')).toContainText('Дію не записано');
  await expect(page.locator('.global-result')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Повторити', exact: true})).toHaveCount(0);
});

test('недоступні дії вимкнено з поясненням; дії командира в ролі супроводу не виконуються', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Супровід');
  await selectCase(page, '03');
  const actions = page.getByRole('region', {name: 'Дії'});

  for (const name of ['Запит видачі довідки', 'Направити на ВЛК']) {
    const button = actions.getByRole('button', {name, exact: true});
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleDescription(/Виконує командир/);
  }
  const resolve = actions.getByRole('button', {name: 'Підготувати результат звернення', exact: true});
  await expect(resolve).toBeDisabled();
  await expect(resolve).toHaveAccessibleDescription(/Немає відкритих звернень/);
  const verify = actions.getByRole('button', {name: 'Перевірити навчальну копію', exact: true});
  await expect(verify).toBeDisabled();
  await expect(verify).toHaveAccessibleDescription(/Немає навчальної копії/);
  await expect(actions.getByRole('button', {name: 'Уточнити в автора', exact: true})).toBeEnabled();

  await staffRole(page, 'Командир');
  await expect(page.getByRole('heading', {level: 2, name: 'Навчальний учасник 03'})).toBeVisible();
  const issue = actions.getByRole('button', {name: 'Запит видачі довідки', exact: true});
  await expect(issue).toBeDisabled();
  await expect(issue).toHaveAccessibleDescription(/ще не склала медична служба/);
  await expect(actions.getByRole('button', {name: 'Направити на ВЛК', exact: true})).toBeEnabled();
  await expect(page.getByText('Службова проєкція: клінічні документи')).toBeVisible();
});

test('розбір: закриття після звірки з джерелом із поясненням наслідків', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Супровід');
  await page.getByRole('group', {name: 'Фільтр кейсів за станом'}).getByRole('button', {name: /Потрібна звірка/}).click();
  await expect(page.getByRole('status').filter({hasText: 'Показано'})).toContainText('Показано 2 із 10');
  await selectCase(page, '08');
  const reviews = page.getByRole('region', {name: 'Звірка з джерелом'});
  await expect(reviews).toContainText('Адресат повернув пакет на уточнення');
  await expect(reviews).toContainText('подія лишається незастосованою');
  await snapshot(page, 'staff-detail-desktop');

  await reviews.getByRole('button', {name: 'Закрити після звірки з джерелом'}).click();
  await expect(page.locator('.global-result')).toContainText('Розбір закрито після звірки');
  await expect(reviews).toContainText('Розборів немає');
});

test('пошук і фільтр кейсів: порожній результат пояснено, є скидання', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Супровід');
  await page.getByLabel('Пошук кейсу').fill('учасник 05');
  await expect(page.locator('.case-item')).toHaveCount(1);
  await page.getByLabel('Пошук кейсу').fill('немає такого');
  await expect(page.getByText('За цими умовами кейсів немає')).toBeVisible();
  await page.getByRole('button', {name: 'Скинути пошук і фільтр'}).click();
  await expect(page.locator('.case-item')).toHaveCount(10);
});

test('резервний шлях: запит без еПМК не створює медичного факту й не дублюється', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Супровід');
  const reserve = page.getByRole('region', {name: 'Якщо подія еПМК недоступна'});
  await expect(reserve).toContainText('не створює медичного факту');
  const create = reserve.getByRole('button', {name: 'Створити адміністративний запит', exact: true});
  await create.click();
  await expect(page.locator('.global-result')).toContainText('Резервний запит відкрито');
  await expect(create).toBeDisabled();
  await expect(create).toHaveAccessibleDescription(/уже створено/);
  await expect(page.locator('.case-item')).toHaveCount(11);
});

test('телефон: список кейсів і деталі — окремі кроки з поверненням', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await openApp(page);
  await openPanel(page, 'Супровід');
  await expect(page.getByRole('heading', {level: 2, name: 'Призначені кейси'})).toBeVisible();
  await expect(page.locator('.case-detail')).toHaveCount(0);

  await selectCase(page, '02');
  await expect(page.locator('.case-list')).toHaveCount(0);
  await expect(page.getByRole('heading', {level: 3, name: 'Відкриті задачі'})).toBeVisible();
  await snapshot(page, 'staff-detail-mobile', false);

  await page.getByRole('button', {name: 'До списку кейсів'}).click();
  await expect(page.getByRole('heading', {level: 2, name: 'Призначені кейси'})).toBeVisible();
  await expect(page.locator('.case-detail')).toHaveCount(0);
});

test('телефон: розділи кейсу згорнуті, якір розгортає потрібний', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await openApp(page);
  await openPanel(page, 'Мій кейс');
  const timeline = page.getByRole('button', {name: /Події кейсу/});
  await expect(timeline).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.timeline')).toBeHidden();
  await timeline.click();
  await expect(page.locator('.timeline')).toBeVisible();

  await page.getByRole('link', {name: 'Що буде далі'}).click();
  await expect(page.getByRole('button', {name: /Ви бачите крок/})).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.what-next')).toBeVisible();
});

test('клавіатура: skip-link, навігація панелями й видимий фокус', async ({page}) => {
  await openApp(page);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', {name: 'Перейти до змісту'});
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();

  await page.keyboard.press('Tab');
  const patientNav = page.getByRole('navigation', {name: 'Демо-панелі'}).getByRole('button', {name: 'Мій кейс'});
  await expect(patientNav).toBeFocused();
  const outline = await patientNav.evaluate(element => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe('none');

  await page.keyboard.press('Enter');
  await expect(patientTitle(page)).toBeVisible();
  await expect(page.locator('main')).toBeFocused();
  await page.keyboard.press('Tab');
  const insideNextStep = await page.evaluate(() => document.activeElement?.closest('.next-step') !== null);
  expect(insideNextStep).toBe(true);
  await page.getByRole('link', {name: 'Що буде далі'}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', {name: 'Ви бачите крок. Супровід веде справу.'})).toBeInViewport();

  const targets = await page.locator('main button:visible, main a.btn:visible, main summary:visible').evaluateAll(
    elements => elements.map(element => Math.round(element.getBoundingClientRect().height)),
  );
  expect(Math.min(...targets)).toBeGreaterThanOrEqual(44);
});
