"""Зводить реєстри шести потоків аудиту в три файли репозиторію docs/reviews/."""
import json, sys, collections, pathlib
audit = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2])
STREAMS = [('RES','Дослідження й докази проблеми'),('LEG1','Нормативка: медичні дані, ВЛК, строки'),('LEG2','Нормативка: виплати, електронні документи'),('PROD','Продуктові документи й трасування'),('BPMN','BPMN AS IS і TO BE'),('ARCH','Архітектура й безпека проти коду')]
claims, coverage, findings = [], [], []
applied = {}
for sub in [s for s, _ in STREAMS] + ['MAIN']:
    ap = audit / sub / 'applied.json'
    if ap.exists():
        for a in json.load(open(ap)):
            applied.setdefault(a.get('finding'), []).append({k: a.get(k) for k in ('file','status','what','owner') if a.get(k)})
for stream, title in STREAMS:
    d = audit / stream
    for c in json.load(open(d/'claims.json')): claims.append({'stream': stream, **c})
    for c in json.load(open(d/'coverage.json')): coverage.append({'stream': stream, **c})
    for f in json.load(open(d/'findings.json')): findings.append({'stream': stream, **f, 'disposition': applied.get(f['id'], [])})
meta = {'generated': '2026-11-14', 'branch': 'claude/full-audit-and-prototype-rewrite', 'baseline': 'main@bcead3a',
        'note': 'Зведено з шести паралельних незалежних потоків аудиту. Статуси — на дату перевірки; непрочитане джерело ніде не подано як підтверджене.',
        'streams': [{'id': s, 'title': t} for s, t in STREAMS]}
def dump(name, key, items, extra=None):
    doc = {**meta, **(extra or {}), key: items}
    (out/name).write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf8')
dump('claude-claim-register.json', 'claims', claims, {'counts': dict(collections.Counter(c.get('status','?') for c in claims))})
dump('claude-audit-coverage.json', 'files', coverage, {'counts': dict(collections.Counter(c.get('read','?') for c in coverage))})
dump('claude-audit-findings.json', 'findings', findings, {'counts': dict(collections.Counter(f.get('severity','?') for f in findings))})
print('claims', len(claims), collections.Counter(c.get('status') for c in claims))
print('coverage', len(coverage), collections.Counter(c.get('read') for c in coverage))
print('findings', len(findings), collections.Counter((f['stream'], f['severity']) for f in findings))
