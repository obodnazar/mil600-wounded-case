// Генерує PDF і PNG пакета кроку I з submission/step-1/krok-1.html.
// Запуск з кореня: node scripts/render-step-1.mjs (потрібен playwright з prototype/ і локальний Chrome).
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {dirname, join} from 'node:path';
import {copyFileSync} from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'prototype', 'package.json'));
const {chromium} = require('playwright');
const out = join(root, 'submission', 'step-1');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

const browser = await chromium.launch({executablePath});
const page = await browser.newPage();
await page.goto(pathToFileURL(join(out, 'krok-1.html')).href, {waitUntil: 'load'});
await page.pdf({path: join(out, 'MIL600-krok-1-kejs-poranennia.pdf'), preferCSSPageSize: true, printBackground: true});

// Растрова копія схеми для перегляду без редактора BPMN (ширина 3600 px).
const width = 3600;
const height = Math.round((width * 2110) / 4690);
const svg = await browser.newPage({viewport: {width, height}});
const src = pathToFileURL(join(root, 'docs', 'bpmn', 'as-is.svg')).href;
// Сторінка з file:// може завантажити локальний SVG; about:blank — ні.
await svg.goto(pathToFileURL(join(out, 'krok-1.html')).href);
await svg.evaluate(([url, w]) => {
  document.body.innerHTML = `<img src="${url}" style="width:${w}px;display:block">`;
  document.body.style.cssText = 'margin:0;background:#fff';
}, [src, width]);
await svg.waitForFunction(() => document.images[0]?.complete);
await svg.screenshot({path: join(out, 'as-is.png'), timeout: 120000});
await browser.close();

copyFileSync(join(root, 'docs', 'bpmn', 'as-is.bpmn'), join(out, 'as-is.bpmn'));
copyFileSync(join(root, 'docs', 'bpmn', 'as-is.svg'), join(out, 'as-is.svg'));
console.log('ok');
