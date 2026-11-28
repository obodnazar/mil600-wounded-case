// Проходить клікабельний сценарій submission/step-2/ui-flow/index.html і знімає ключові екрани (390×844).
// Запуск з кореня: node scripts/shoot-ui-flow.mjs (playwright з prototype/, локальний Chrome).
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {dirname, join} from 'node:path';
import {mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'prototype', 'package.json'));
const {chromium} = require('playwright');
const dir = join(root, 'submission', 'step-2', 'ui-flow');
const out = join(dir, 'screens');
mkdirSync(out, {recursive: true});

const browser = await chromium.launch({executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
const page = await browser.newPage({viewport: {width: 390, height: 844}, deviceScaleFactor: 2});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.dismiss());
await page.goto(pathToFileURL(join(dir, 'index.html')).href);
await page.evaluate(() => localStorage.clear());
await page.reload();
const shot = name => page.screenshot({path: join(out, name + '.png')});
const click = sel => page.locator(sel).first().click();
const text = () => page.locator('main').innerText();

await shot('01-intro');
await click('#intro-next');
assert.match(await text(), /На розгляді у командира/);
await shot('02-soldier-review');

await click('[data-role=commander]');
await shot('03-commander-list');
await click('[data-person="0"]');
assert.match(await text(), /Діагнозів і медичних записів тут немає/);
await shot('04-commander-card');

await click('#return');
await shot('05-return-reason');
await click('#do-return');
assert.match(await text(), /Повернуто на доопрацювання/);
await click('[data-role=soldier]');
assert.match(await text(), /Повернуто на доопрацювання/);
await shot('06-soldier-returned');
await click('[data-role=commander]');
await click('#fixed');

await click('#demo-net');
await click('#approve');
await click('#do-sign');
assert.match(await text(), /Немає зв’язку/);
await shot('07-commander-no-network');
await click('#demo-net');
await click('#approve');
await shot('08-sign-sheet');
await click('#do-sign');
assert.match(await text(), /Підписано й надіслано/);
await shot('09-commander-sent');

await click('[data-role=soldier]');
assert.match(await text(), /Затверджено й надіслано у ВЛК/);
await shot('10-soldier-sent');
await click('#to-vlk');
await shot('11-checklist-todo');
await click('#demo-referral');
await click('[data-act=exam]');
await click('[data-tab=done]');
assert.match(await text(), /Прийти на огляд ВЛК/);
await shot('12-checklist-done');
assert.deepEqual(errors, []);
await browser.close();
console.log('ok: 12 екранів');
