#!/usr/bin/env python3
"""Структурна перевірка локальних посилань і матриці трасування; без мережі.

Не перевіряє зміст: чи тест справді стосується вимоги, чи тести проходять,
чи чинні норми. Це звіряє людина / аудит, читаючи тести й джерела.
"""
from pathlib import Path
from urllib.parse import unquote, urlsplit
import collections
import json
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
errors = []

def require(ok, message):
    if not ok:
        errors.append(message)

def visible(text):
    return re.sub(r'^(`{3,}|~{3,}).*?^\1[^\n]*$', '', text, flags=re.M | re.S)

def anchors(path):
    text = visible(path.read_text())
    found = set(re.findall(r'<a\s+(?:id|name)=[\"\']([^\"\']+)', text))
    repeats = collections.Counter()
    for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', text, re.M):
        heading = re.sub(r'!?\[([^\]]+)\]\([^)]*\)', r'\1', heading)
        slug = re.sub(r'[^\w\s-]', '', heading.lower()).replace(' ', '-')
        number = repeats[slug]
        repeats[slug] += 1
        found.add(slug + (f'-{number}' if number else ''))
    return found

paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')
mds = sorted({ROOT / p for p in paths if p.endswith('.md')})
links = 0
for path in mds:
    text = visible(path.read_text())
    text = re.sub(r'`[^`\n]+`', '', text)
    for match in re.finditer(r'!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)', text):
        href = match[1].strip('<>')
        if urlsplit(href).scheme or href.startswith('//'):
            continue
        parsed = urlsplit(href)
        target = (path.parent / unquote(parsed.path)).resolve() if parsed.path else path
        line = text[:match.start()].count('\n') + 1
        where = f'{path.relative_to(ROOT)}:{line}'
        require(target.is_relative_to(ROOT), f'{where}: поза репозиторієм: {href}')
        require(target.exists(), f'{where}: немає {href}')
        if target.exists() and parsed.fragment and target.suffix == '.md':
            require(unquote(parsed.fragment) in anchors(target), f'{where}: немає якоря {href}')
        links += 1

manifest = json.loads((ROOT / 'docs/final-traceability.json').read_text(encoding='utf-8'))
rows = manifest['rows']
FEATURES = [f'F{i:02}' for i in range(1, 11)]
require([r['feature'] for r in rows] == FEATURES, 'Матриця повинна мати рівно F01–F10, по одному рядку, за порядком')

# Лише вузли процесу: потоки, доріжки й DI-фігури не вважаються кроками.
NODE_TAGS = {'task', 'userTask', 'serviceTask', 'receiveTask', 'sendTask', 'manualTask', 'scriptTask', 'businessRuleTask',
             'subProcess', 'callActivity', 'startEvent', 'endEvent', 'boundaryEvent', 'intermediateCatchEvent',
             'intermediateThrowEvent', 'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway'}
def node_ids(kind):
    tree = ET.parse(ROOT / f'docs/bpmn/{kind.replace("_", "-")}.bpmn')
    return {e.get('id') for e in tree.iter() if e.get('id') and e.tag.split('}')[-1] in NODE_TAGS}
ids = {kind: node_ids(kind) for kind in ['as_is', 'to_be']}
norms = {r['id'] for r in json.loads((ROOT / 'regulation/sources.json').read_text(encoding='utf-8'))['sources']}
concept = (ROOT / 'docs/05-product-concept.md').read_text(encoding='utf-8')
brd = (ROOT / 'docs/02-brd.md').read_text(encoding='utf-8')
table = (ROOT / 'docs/final-traceability.md').read_text(encoding='utf-8').splitlines()
REQUIRED = ['title', 'br', 'scenarios', 'as_is', 'to_be', 'norms', 'adrs', 'evidence', 'proof']  # metrics може бути порожнім (F10)

for r in rows:
    f = r['feature']
    require(r['acceptance'] == 'AC' + f[1:], f'{f}: пара F / AC не збігається ({r["acceptance"]})')
    for key in REQUIRED:
        require(bool(r.get(key)), f'{f}: порожнє поле {key}')
    for kind in ids:
        require(set(r[kind]) <= ids[kind], f'{f}: {kind} містить ID, що не є вузлом моделі: {sorted(set(r[kind]) - ids[kind])}')
    require(set(r['norms']) <= norms, f'{f}: невідомі норми {sorted(set(r["norms"]) - norms)}')
    for adr in r['adrs']:
        require(len(list((ROOT / 'docs/architecture/adr').glob(adr + '-*.md'))) == 1, f'{f}: немає унікального ADR {adr}')
    # Доказ — наявний файл тесту або тека e2e зі сценаріями. Зміст тесту скрипт не оцінює.
    test_files = 0
    for file in r['evidence']:
        target = ROOT / file
        if target.is_dir():
            require(any(target.glob('*.spec.ts')), f'{f}: у теці доказів {file} немає *.spec.ts')
        else:
            is_test = target.is_file() and file.endswith(('.test.ts', '.spec.ts'))
            require(is_test, f'{f}: доказ {file} не є наявним файлом тесту')
            test_files += is_test
    require(test_files > 0, f'{f}: серед доказів немає жодного файлу тесту')
    for key in ['feature', 'acceptance']:
        require(re.search(rf'\| {r[key]} \|', concept) is not None, f'{r[key]} не визначено в таблицях концепції')
    for br in r['br']:
        require(re.search(rf'^\| {re.escape(br)} \|', brd, re.M) is not None, f'{f}: {br} не визначено в BRD')
    for scenario in r['scenarios']:
        require(re.search(rf'^\| {scenario} — ', concept, re.M) is not None, f'{f}: сценарій {scenario} не визначено в концепції')
    for metric in r['metrics']:
        require(re.search(rf'^\| {re.escape(metric)} \|', brd, re.M) is not None, f'{f}: {metric} не визначено в BRD')
    # Людська таблиця має збігатися з JSON.
    line = [x for x in table if x.startswith(f'| {f} / {r["acceptance"]} · ')]
    require(len(line) == 1, f'{f}: у final-traceability.md очікується рівно один рядок')
    if len(line) == 1:
        cells = line[0].strip().strip('|').split(' | ')
        require(len(cells) == 5, f'{f}: рядок final-traceability.md має {len(cells)} колонок замість 5')
        if len(cells) == 5:
            require(r['title'] in cells[0], f'{f}: назва в .md відрізняється від JSON')
            require(set(re.findall(r'BR-\d+|S\d+|BO-\d+', cells[1])) == set(r['br'] + r['scenarios'] + r['metrics']), f'{f}: BR / S / BO в .md відрізняються від JSON')
            as_is, _, to_be = cells[2].partition('→')
            require(re.findall(r'`([^`]+)`', as_is) == r['as_is'] and re.findall(r'`([^`]+)`', to_be) == r['to_be'], f'{f}: BPMN ID в .md відрізняються від JSON')
            require(set(re.findall(r'N\d\d', cells[3])) == set(r['norms']) and set(re.findall(r'\b\d{4}\b', cells[3])) == set(r['adrs']), f'{f}: норми / ADR в .md відрізняються від JSON')
            require(all(f'(../{file}' in cells[4] for file in r['evidence']) and r['proof'] in cells[4], f'{f}: докази в .md відрізняються від JSON')

# Покриття рахується об'єднанням по рядках: «парасолькові» рядки F08 / F09 можуть приховати пропуск в іншому рядку.
coverage = {}
for key, expected in [('br', {f'BR-{i}' for i in range(1, 10)}), ('scenarios', {f'S{i}' for i in range(1, 10)}), ('metrics', {f'BO-{i}' for i in range(1, 7)})]:
    found = {v for r in rows for v in r[key]}
    coverage[key] = (len(found & expected), len(expected))
    require(found == expected, f'Покриття {key}: бракує {sorted(expected - found)}, зайві {sorted(found - expected)}')
risk = (ROOT / 'docs/final-risk-disposition.md').read_text(encoding='utf-8')
risks = set(re.findall(r'^\| (R\d+) \|', risk, re.M))
expected_risks = {f'R{i:02}' for i in range(1, 23)}
require(risks == expected_risks, 'Неповне покриття R01–R22')
for file in ['docs/reviews/final.md', 'docs/reviews/phase-9.md', 'docs/final-package.md', 'docs/pitch-notes.md', 'output/pdf/pitch-one-pager.pdf']:
    require((ROOT / file).is_file(), f'Немає фінального артефакту {file}')

# PDF пітчу має відповідати Markdown. Звірка лише за наявності pdftotext; інакше чесно про це сказати.
pdf_note = 'PDF пітчу з Markdown НЕ звірено: немає pdftotext'
pdftotext = shutil.which('pdftotext')
if pdftotext and (ROOT / 'output/pdf/pitch-one-pager.pdf').is_file():
    out = subprocess.run([pdftotext, '-layout', str(ROOT / 'output/pdf/pitch-one-pager.pdf'), '-'], capture_output=True, text=True)
    squeeze = lambda s: re.sub(r'\s+', '', s.replace('—', '-').replace('–', '-').replace('\x0c', ''))
    source = (ROOT / 'docs/pitch-one-pager.md').read_text(encoding='utf-8')
    source = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', source)
    source = re.sub(r'^#+\s*', '', source, flags=re.M).replace('**', '')
    same = out.returncode == 0 and squeeze(source) == squeeze(out.stdout)
    require(same, 'Текст output/pdf/pitch-one-pager.pdf не збігається з docs/pitch-one-pager.md: перегенеруйте PDF')
    pdf_note = 'текст PDF пітчу збігається з Markdown (pdftotext)'

if errors:
    print('\n'.join(errors))
    sys.exit(1)
pairs = sum(r['acceptance'] == 'AC' + r['feature'][1:] for r in rows)
print(f'OK: {len(mds)} Markdown-файлів, {links} локальних посилань; пар F/AC {pairs}/{len(FEATURES)}, '
      f'BR {coverage["br"][0]}/{coverage["br"][1]}, S {coverage["scenarios"][0]}/{coverage["scenarios"][1]}, '
      f'BO {coverage["metrics"][0]}/{coverage["metrics"][1]}, R {len(risks & expected_risks)}/{len(expected_risks)}; '
      f'вузли BPMN / НПА / ADR / файли тестів існують; .md збігається з JSON; {pdf_note}.')
print('Це структурна перевірка. Вона не доводить, що названий тест перевіряє саме цю вимогу, що тести проходять, '
      'що покрито кожен рядок окремо (BR / S / BO рахуються об’єднанням) або що норми чинні.')
