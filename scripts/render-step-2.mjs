// Генерує PDF кроку II з submission/step-2/krok-2.html і кладе поруч файли для Moodle.
// Запуск з кореня: node scripts/render-step-2.mjs (потрібен playwright з prototype/ і локальний Chrome).
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {dirname, join} from 'node:path';
import {copyFileSync} from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'prototype', 'package.json'));
const {chromium} = require('playwright');
const out = join(root, 'submission', 'step-2');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

const browser = await chromium.launch({executablePath});
const page = await browser.newPage();
await page.goto(pathToFileURL(join(out, 'krok-2.html')).href, {waitUntil: 'load'});
await page.pdf({path: join(out, 'MIL600-krok-2-kejs-poranennia.pdf'), preferCSSPageSize: true, printBackground: true});

// Растрові копії схем для перегляду без редактора.
async function png(svgPath, width, height, target) {
  const p = await browser.newPage({viewport: {width, height}});
  await p.goto(pathToFileURL(join(out, 'krok-2.html')).href);
  await p.evaluate(([url, w]) => {
    document.body.innerHTML = `<img src="${url}" style="width:${w}px;display:block">`;
    document.body.style.cssText = 'margin:0;background:#fff';
  }, [pathToFileURL(svgPath).href, width]);
  await p.waitForFunction(() => document.images[0]?.complete);
  await p.screenshot({path: join(out, target), timeout: 120000});
  await p.close();
}
await png(join(root, 'docs', 'bpmn', 'to-be-overview.svg'), 4430, 1396, 'to-be-overview.png');
await png(join(root, 'docs', 'architecture', 'enterprise-architecture.svg'), 1640, 860, 'enterprise-architecture.png');
await browser.close();

for (const [from, to] of [
  [['docs', 'bpmn', 'to-be-overview.bpmn'], 'to-be-overview.bpmn'],
  [['docs', 'bpmn', 'to-be.bpmn'], 'to-be-detailed.bpmn'],
]) copyFileSync(join(root, ...from), join(out, to));
console.log('ok');
