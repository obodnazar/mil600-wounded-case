#!/usr/bin/env python3
"""Перевіряє локальні посилання і трасування фінального пакета; без мережі."""
from pathlib import Path
from urllib.parse import unquote, urlsplit
import collections
import json
import re
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

manifest = json.loads((ROOT / 'docs/final-traceability.json').read_text())
rows = manifest['rows']
require(len(rows) == 10, 'Матриця повинна мати 10 функцій')
for key, expected in [('feature', {f'F{i:02}' for i in range(1, 11)}), ('acceptance', {f'AC{i:02}' for i in range(1, 11)})]:
    require({r[key] for r in rows} == expected, f'Неповне або зайве покриття {key}')
    require(len({r[key] for r in rows}) == len(rows), f'Повтор {key}')
ids = {kind: {e.get('id') for e in ET.parse(ROOT / f'docs/bpmn/{kind.replace("_", "-")}.bpmn').iter() if e.get('id')} for kind in ['as_is', 'to_be']}
norms = {r['id'] for r in json.loads((ROOT / 'regulation/sources.json').read_text())['sources']}
concept = (ROOT / 'docs/05-product-concept.md').read_text()
brd = (ROOT / 'docs/02-brd.md').read_text()
for r in rows:
    for kind in ids:
        require(bool(r[kind]) and set(r[kind]) <= ids[kind], f'{r["feature"]}: невідомі ID {kind}: {set(r[kind]) - ids[kind]}')
    require(set(r['norms']) <= norms, f'{r["feature"]}: невідомі норми')
    for adr in r['adrs']:
        require(len(list((ROOT / 'docs/architecture/adr').glob(adr + '-*.md'))) == 1, f'Немає унікального ADR {adr}')
    for file in r['evidence']:
        require((ROOT / file).is_file(), f'Немає доказу {file}')
    for key in ['feature', 'acceptance']:
        require(r[key] in concept, f'Вимога {r[key]} не знайдена в концепції')
    for br in r['br']:
        require(br in brd, f'Невідома вимога {br}')
for key, expected in [('br', {f'BR-{i}' for i in range(1, 10)}), ('scenarios', {f'S{i}' for i in range(1, 10)}), ('metrics', {f'BO-{i}' for i in range(1, 7)})]:
    require({v for r in rows for v in r[key]} == expected, f'Неповне покриття {key}')
risk = (ROOT / 'docs/final-risk-disposition.md').read_text()
require(set(re.findall(r'^\| (R\d+) \|', risk, re.M)) == {f'R{i:02}' for i in range(1, 23)}, 'Неповне покриття R01–R22')
for file in ['docs/reviews/final.md', 'docs/reviews/phase-9.md', 'docs/final-package.md', 'docs/pitch-notes.md', 'output/pdf/pitch-one-pager.pdf']:
    require((ROOT / file).is_file(), f'Немає фінального артефакту {file}')
if errors:
    print('\n'.join(errors))
    sys.exit(1)
print(f'OK: {len(mds)} Markdown-файлів, {links} локальних посилань; F/AC 10/10, BR 9/9, S 9/9, BO 6/6, R 22/22; BPMN ID / НПА / ADR / файли існують.')
print('Це структурна перевірка; вона не доводить зміст доказів, працездатність або юридичну достатність.')
