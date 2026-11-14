import {expect, test} from '@playwright/test';
import {openApp, openPanel, refreshButton, sendFixture} from './support';

test('симулятор: подія на розборі, повторна доставка й конфлікт після приймання', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Симулятор');

  await sendFixture(page, 'uncertain', /Подію збережено на розбір\. Бізнес-стан не змінено\./);
  await sendFixture(page, 'uncertain', /Подія досі на розборі/);

  await page.getByLabel('Навчальна подія').selectOption('admit');
  await page.getByRole('button', {name: 'Перевірити конфлікт після приймання'}).click();
  await expect(page.locator('.result')).toContainText('Конфлікт:');
  await expect(page.locator('.result')).toContainText('попередні підтвердження збережено');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(refreshButton(page)).toBeEnabled();

  await openPanel(page, 'Мій кейс');
  await expect(page.locator('.case-status')).toContainText(/Є суперечність|Потрібна звірка|Дані актуальні/);
});
