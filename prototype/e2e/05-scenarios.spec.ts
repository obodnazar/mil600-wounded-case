import {expect, test, type Page} from '@playwright/test';
import {openApp, openPanel, selectCase, sendFixture, sendFixtures} from './support';

/**
 * Сценарії S1–S8 у браузері на справжньому сервері.
 *
 * Сервер e2e один на весь запуск (SQLite у пам’яті), тож ці тести йдуть після 01–04:
 * повний D1 для кейсу 01 уже пройдено, резервний запит створено, подія `uncertain`
 * чекає звірки, а конфлікт події надходження відкрив розбір у кейсі 01.
 * Тести в цьому файлі залежать від порядку й виконуються послідовно.
 * S9 (мала аналітична група) перевіряє тест D1.
 */
test.describe.configure({mode: 'serial'});

const PENDING = /Подію збережено на розбір\. Бізнес-стан не змінено\./;

async function staffCaseDetail(page: Page, number: string): Promise<void> {
  await openPanel(page, 'Супровід');
  await selectCase(page, number);
}

async function openReserveCase(page: Page): Promise<void> {
  await openPanel(page, 'Супровід');
  await page.locator('.case-item').filter({hasText: 'Резервний запит'}).click();
  await expect(page.locator('.case-detail')).toContainText('Резервний адміністративний запит');
}

function caseDetail(page: Page) {
  return page.locator('.case-detail');
}

test('S6 + S1: резерв без еПМК — строк від довідки про перебування, пізня еПМК долучається до того самого кейсу', async ({page}) => {
  await openApp(page);
  await openReserveCase(page);
  await expect(caseDetail(page)).toContainText('Медичний документ ще не підтверджений');

  await openPanel(page, 'Симулятор');
  await sendFixtures(page, ['reserve-hospital', 'reserve-hospital-receipt']);
  await openReserveCase(page);
  // Відлік від отримання довідки про перебування; медичний документ при цьому не підтверджено.
  await expect(caseDetail(page)).toContainText('18 листопада 2026');
  await expect(caseDetail(page)).toContainText('Медичний документ ще не підтверджений');

  await openPanel(page, 'Симулятор');
  await sendFixture(page, 'reserve-primary');
  await openReserveCase(page);
  await expect(caseDetail(page)).not.toContainText('Медичний документ ще не підтверджений');
  // Той самий резервний кейс, а не новий: у списку й далі один резервний запит.
  await expect(page.locator('.case-item').filter({hasText: 'Резервний запит'})).toHaveCount(1);
});

test('S1: невизначений випадок не зливається автоматично; кейс підтверджує людина після звірки', async ({page}) => {
  await openApp(page);
  // Кейс 02 належить іншій особі: підтвердити на ньому випадок не можна.
  await staffCaseDetail(page, '02');
  const wrongCase = caseDetail(page).getByRole('button', {name: 'Підтвердити випадок після звірки'});
  await expect(wrongCase).toHaveCount(1);
  await wrongCase.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.global-result')).toHaveCount(0);

  await selectCase(page, '01');
  await expect(caseDetail(page)).toContainText('Особа відома, але випадок треба звірити з джерелом');
  await caseDetail(page).getByRole('button', {name: 'Підтвердити випадок після звірки'}).click();
  await expect(page.locator('.global-result')).toContainText('Випадок підтверджено після ручної звірки');
  await expect(caseDetail(page)).not.toContainText('Особа відома, але випадок треба звірити з джерелом');
});

test('S8: суперечливу подію закрито після звірки; прогалину видно й закрито потрібним сигналом; ручне уточнення закривається', async ({page}) => {
  await openApp(page);
  await staffCaseDetail(page, '01');
  // Розбір конфлікту від тесту симулятора: закриваємо після звірки, стан кейсу не змінюється.
  await expect(caseDetail(page)).toContainText('Та сама подія надійшла з іншим змістом');
  await caseDetail(page).getByRole('button', {name: 'Закрити після звірки з джерелом'}).click();
  await expect(page.locator('.global-result')).toContainText('подію не застосовано, стан кейсу не змінено');
  await expect(caseDetail(page)).toContainText('Дані актуальні');

  // Ручне уточнення в автора закривається вручну.
  const actions = page.getByRole('region', {name: 'Дії'});
  await actions.getByRole('button', {name: 'Уточнити в автора', exact: true}).click();
  await expect(page.locator('.global-result')).toContainText('Створено задачу уточнення в автора документа');
  const close = caseDetail(page).getByRole('button', {name: 'Закрити уточнення'});
  await expect(close).toHaveCount(1);
  await close.click();
  await expect(page.locator('.global-result')).toContainText('Уточнення закрито');
  await expect(close).toHaveCount(0);

  // Прогалина від джерела: дані не оновлено, але підтвердження збережено.
  await openPanel(page, 'Симулятор');
  await sendFixture(page, 'gap');
  await openPanel(page, 'Мій кейс');
  await expect(page.locator('.case-status')).toContainText('Дані не оновлено');
  await expect(page.getByText('видачу підтверджено джерелом', {exact: true})).toBeVisible();

  // Чужий сигнал прогалину не закриває; потрібний — відновлює актуальність.
  await openPanel(page, 'Симулятор');
  await sendFixture(page, 'care-start');
  await openPanel(page, 'Мій кейс');
  await expect(page.locator('.case-status')).toContainText('Дані не оновлено');
  await openPanel(page, 'Симулятор');
  await sendFixture(page, 'gap-recovered');
  await openPanel(page, 'Мій кейс');
  await expect(page.locator('.case-status')).toContainText('Дані актуальні');
});

test('S2: цивільний заклад і виписка — після виписки поточний заклад не вигадується', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Симулятор');
  await sendFixture(page, 'civil');
  await openPanel(page, 'Мій кейс');
  await expect(page.getByText('Умовний заклад 03', {exact: true})).toBeVisible();

  await openPanel(page, 'Симулятор');
  await sendFixtures(page, ['civil-summary', 'discharge']);
  await openPanel(page, 'Мій кейс');
  const facility = page.locator('.facts__row', {hasText: 'Заклад лікування'});
  await expect(facility).toContainText('невідомо');
  // Переведення й виписка не перезапускають контроль лікування.
  await expect(page.locator('main')).toContainText('21 лютого 2027');
});

test('S3: нова версія без успадкованої квитанції, відкликання з історією, копія ≠ оригінал', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Симулятор');
  await sendFixture(page, 'certificate-corrected');

  await openPanel(page, 'Мій кейс');
  const certificate = page.locator('.document', {hasText: 'Довідка про обставини травми'}).first();
  await expect(certificate).toContainText('v2');
  await expect(certificate).toContainText('Чинну версію ще не передано адресатові');
  await certificate.getByText(/Попередні версії: 1/).click();
  await expect(certificate).toContainText('Версія v1 — замінена новішою');

  await openPanel(page, 'Симулятор');
  await sendFixture(page, 'certificate-withdrawn');
  await openPanel(page, 'Мій кейс');
  const withdrawn = page.locator('.document', {hasText: 'Довідка про обставини травми'}).first();
  await expect(withdrawn).toContainText('Бракує');
  await withdrawn.getByText(/Попередні версії: 2/).click();
  await expect(withdrawn).toContainText('Версія v2 — відкликана');

  // Запасний шлях: вигаданий зразок із галереї лишається копією.
  await page.getByRole('button', {name: 'Спробувати зразок іншого виду'}).click();
  await expect(page.locator('.global-result')).toContainText('перелік покаже помилку виду');
  await expect(page.locator('.document', {hasText: 'Помилка: інший вид зразка'}).first()).toBeVisible();
  await page.getByRole('button', {name: 'Додати навчальну копію довідки'}).click();
  await expect(page.locator('.global-result')).toContainText('це не оригінал документа');
  await expect(page.locator('.document', {hasText: 'Копія очікує перевірки'}).first()).toBeVisible();

  await staffCaseDetail(page, '01');
  await page.getByRole('region', {name: 'Дії'}).getByRole('button', {name: 'Перевірити навчальну копію'}).click();
  await expect(page.locator('.global-result')).toContainText('Навчальну копію технічно перевірено');

  await openPanel(page, 'Мій кейс');
  const checked = page.locator('.document', {hasText: 'Копію технічно звірено'}).first();
  await expect(checked).toContainText('Навчальна копія, не оригінал');
});

test('S4: ВЛК повертає пакет авторові, нова ревізія приймається', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Симулятор');
  await sendFixture(page, 'vlk-returned');
  await openPanel(page, 'Мій кейс');
  await expect(page.getByText('ВЛК повернула пакет авторові на уточнення', {exact: true})).toBeVisible();

  await openPanel(page, 'Симулятор');
  await sendFixture(page, 'vlk-resubmitted');
  await openPanel(page, 'Мій кейс');
  await expect(page.getByText('ВЛК підтвердила отримання пакета', {exact: true})).toBeVisible();
  await expect(page.locator('main')).toContainText('ревізія v2');
});

test('S6: невідома дата лікування не дає строку — супроводу створено задачу уточнення', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Симулятор');
  await sendFixture(page, 'care-unknown');
  await staffCaseDetail(page, '03');
  await expect(caseDetail(page)).toContainText('Уточнити початок лікування');
});

test('S7: звернення родини фіксується без доступу; супровід готує результат', async ({page}) => {
  await openApp(page);
  await staffCaseDetail(page, '01');
  const actions = page.getByRole('region', {name: 'Дії'});
  await actions.getByRole('button', {name: 'Звернення родини без нового доступу'}).click();
  await expect(page.locator('.global-result')).toContainText('доступу до кейсу воно не створює');
  const requests = caseDetail(page).getByRole('region', {name: 'Звернення'});
  await expect(requests).toContainText('Звернення родини (без доступу до кейсу)');
  await expect(requests).toContainText('Призначено супроводу');

  await actions.getByRole('button', {name: 'Підготувати результат звернення'}).click();
  await expect(page.locator('.global-result')).toContainText('Результат звернення підготовлено');
  await expect(requests).not.toContainText('Призначено супроводу');
  await expect(actions.getByRole('button', {name: 'Підготувати результат звернення'})).toBeDisabled();
});

test('S5: суперечливий сигнал не перезаписує завершений період; невідомий — не стирає підтверджене', async ({page}) => {
  await openApp(page);
  await openPanel(page, 'Симулятор');
  // Відмова для періоду, виконання якого вже підтверджене, — лише на розбір.
  await sendFixture(page, 'ogd-denied', PENDING);
  await sendFixture(page, 'ogd-unknown');

  await openPanel(page, 'Мій кейс');
  const ogd = page.locator('.finance-route', {hasText: 'Одноразова грошова допомога'});
  await expect(ogd).toContainText('Виконання підтверджене джерелом');
  await expect(ogd).not.toContainText('Відмовлено');
  await expect(page.locator('main')).not.toContainText(/кошти отримано|виплачено/i);
});
