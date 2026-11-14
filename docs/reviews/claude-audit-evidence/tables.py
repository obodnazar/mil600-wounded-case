"""Генерує docs/reviews/claude-audit-findings.md і claude-claim-register.md із зведених JSON."""
import json, sys, pathlib, collections, re
out = pathlib.Path(sys.argv[1])
F = json.load(open(out/'claude-audit-findings.json'))
C = json.load(open(out/'claude-claim-register.json'))
V = json.load(open(out/'claude-audit-coverage.json'))
titles = {s['id']: s['title'] for s in F['streams']}
def cell(text, limit):
    text = re.sub(r'\s+', ' ', str(text or '')).replace('|', '\\|').strip()
    return text if len(text) <= limit else text[:limit-1].rstrip() + '…'
order = {'Critical': 0, 'Major': 1, 'Minor': 2}
lines = ['# Реєстр знахідок повного аудиту (2026-11-14)', '',
  'Згенеровано з [claude-audit-findings.json](claude-audit-findings.json) скриптом зведення; повний текст кожної знахідки '
  '(проблема, джерело / вимога, відтворення, наслідок, запропонована правка, доказ, залишковий ризик) — у JSON. '
  'Пояснення й підсумки — у [звіті аудиту](claude-full-audit.md).', '',
  'Стан: **виправлено** / **знижено** / **прийнято з обмеженнями** / **відкладено з власником** / **лишається відкритим**. '
  'Знахідка не вважається закритою лише тому, що її описано.', '']
tot = collections.Counter()
for sid, title in titles.items():
    items = sorted([f for f in F['findings'] if f['stream'] == sid], key=lambda f: (order.get(f['severity'], 9), f['id']))
    cnt = collections.Counter(f['severity'] for f in items)
    lines += [f'## {sid} — {title}', '', f"Critical {cnt['Critical']} · Major {cnt['Major']} · Minor {cnt['Minor']}", '',
              '| ID | Рівень | Файл | Проблема | Стан після цього PR |', '|---|---|---|---|---|']
    for f in items:
        disp = f.get('disposition') or []
        statuses = collections.Counter(d.get('status', '?') for d in disp)
        status = '; '.join(f'{k}' + (f' ×{v}' if v > 1 else '') for k, v in statuses.items()) or 'не розглянуто'
        note = cell(' / '.join(dict.fromkeys(d.get('what', '') for d in disp if d.get('what'))), 260)
        for k in statuses: tot[k] += 1
        lines.append(f"| {f['id']} | {f['severity']} | {cell(f.get('file'), 70)} | {cell(f.get('problem'), 300)} | **{status}**{'. ' + note if note else ''} |")
    lines.append('')
(out/'claude-audit-findings.md').write_text('\n'.join(lines) + '\n', encoding='utf8')

lines = ['# Реєстр змістових тверджень (2026-11-14)', '',
  'Згенеровано з [claude-claim-register.json](claude-claim-register.json). У JSON для кожного твердження: місця використання, '
  'тип, підстава, дати публікації / редакції / перевірки, пояснення, потрібна правка й результат після виправлення.', '']
st = collections.Counter(c.get('status') for c in C['claims'])
lines += ['| Статус | Кількість |', '|---|---|'] + [f'| {k} | {v} |' for k, v in st.most_common()] + ['']
for sid, title in titles.items():
    items = [c for c in C['claims'] if c['stream'] == sid]
    lines += [f'## {sid} — {title} ({len(items)})', '', '| ID | Статус | Тип | Твердження | Де | Підстава |', '|---|---|---|---|---|---|']
    for c in items:
        locs = c.get('locations') or []
        where = '; '.join(cell(l.get('file') if isinstance(l, dict) else l, 48) for l in locs[:3]) + (f' (+{len(locs)-3})' if len(locs) > 3 else '')
        lines.append(f"| {c['id']} | {c.get('status')} | {cell(c.get('type'), 28)} | {cell(c.get('summary'), 230)} | {where} | {cell(c.get('basis'), 110)} |")
    lines.append('')
(out/'claude-claim-register.md').write_text('\n'.join(lines) + '\n', encoding='utf8')
print('findings md lines', sum(1 for _ in open(out/'claude-audit-findings.md')), 'dispositions', dict(tot))
print('coverage files', len(V['files']), collections.Counter(v.get('read') for v in V['files']))
