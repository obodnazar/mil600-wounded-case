"""Одноекранна TO BE для здачі кроку II: хто робить кожен крок — людина, система чи уповноважена особа.

Це спрощений огляд тієї самої логіки, що й детальна модель to-be.bpmn (вісім DI-площин).
Іконка людини — userTask (дію виконує людина), шестерня — serviceTask (сервіс «Кейс поранення»).
Помаранчеві задачі — рішення уповноваженої особи (командир, ВЛК, розпорядник коштів).
Запуск з кореня репозиторію: python3 docs/bpmn/generate-to-be-overview.py
"""
import xml.etree.ElementTree as E
from pathlib import Path

NS = {
    'bpmn': 'http://www.omg.org/spec/BPMN/20100524/MODEL',
    'bpmndi': 'http://www.omg.org/spec/BPMN/20100524/DI',
    'dc': 'http://www.omg.org/spec/DD/20100524/DC',
    'di': 'http://www.omg.org/spec/DD/20100524/DI',
    'bioc': 'http://bpmn.io/schema/bpmn/biocolor/1.0',
    'color': 'http://www.omg.org/spec/BPMN/non-normative/color/1.0',
}
for k, v in NS.items():
    E.register_namespace(k, v)


def q(tag):
    p, t = tag.split(':')
    return '{%s}%s' % (NS[p], t)


def el(parent, tag, text=None, **attrs):
    e = E.SubElement(parent, q(tag), {k: str(v) for k, v in attrs.items()})
    if text is not None:
        e.text = text
    return e


root = E.Element(q('bpmn:definitions'), id='Definitions_ToBeOverview',
                 targetNamespace='https://example.invalid/mil600/to-be-overview', exporter='MIL600 навчальна модель')
collab = el(root, 'bpmn:collaboration', id='Collaboration_ToBeOverview')
el(collab, 'bpmn:participant', id='Pool_ToBe', name='Кейс поранення — TO BE (огляд)', processRef='Process_ToBeOverview')
process = el(root, 'bpmn:process', id='Process_ToBeOverview', name='Кейс поранення — TO BE (огляд)', isExecutable='false')
el(process, 'bpmn:documentation',
   'Огляд для кроку II, 2026-11-26. Деталі, винятки й повтори — у to-be.bpmn. Медичні факти й рішення лишаються '
   'в уповноважених джерелах; інтеграції в прототипі синтетичні.')
laneset = el(process, 'bpmn:laneSet', id='LaneSet_ToBeOverview')

X0, LANE_W = 40, 4420          # лівий край пулу і ширина
HEAD = 30                      # смуга назви пулу
LANES = [  # key, назва, висота
    ('Soldier', 'Військовослужбовець', 150),
    ('Medical', 'Медик / заклад', 160),
    ('System', 'Сервіс «Кейс поранення» в Армія+ (система)', 400),
    ('Unit', 'Частина: командир, медслужба, супровід', 300),
    ('VLK', 'ВЛК', 150),
    ('Finance', 'Фінслужба / орган ОГД', 170),
]
lane_y = {}
y = 60
for key, name, h in LANES:
    lane_y[key] = (y, h)
    y += h
POOL_H = y - 60
lanes = {key: el(laneset, 'bpmn:lane', id='Lane_' + key, name=name) for key, name, _ in LANES}

COL0, COL = 190, 175            # x першої колонки та крок
TW, TH = 140, 84                # розмір задачі
ROWS = {'System': (25, 150, 295), 'Unit': (40, 185)}
nodes, flows = {}, []
HUMAN, SYSTEM, DECISION = 'human', 'system', 'decision'
FILL = {SYSTEM: ('#dce9f7', '#1f4e79'), DECISION: ('#fde3c4', '#9a4a00'), HUMAN: ('#ffffff', '#222222')}


def cx(col):
    return COL0 + col * COL


def row_y(lane, row=0):
    top, h = lane_y[lane]
    if lane in ROWS:
        return top + ROWS[lane][row]
    return top + (h - TH) // 2


def node(id, typ, name, lane, col, row=0, kind=None, w=TW, h=TH):
    e = el(process, 'bpmn:' + typ, id=id, name=name)
    el(lanes[lane], 'bpmn:flowNodeRef', id)
    if typ in ('task', 'userTask', 'serviceTask'):
        box = (cx(col), row_y(lane, row), w, h)
    elif typ.endswith('Gateway'):
        box = (cx(col) + (TW - 50) // 2, row_y(lane, row) + (TH - 50) // 2, 50, 50)
    else:  # події
        box = (cx(col) + (TW - 36) // 2, row_y(lane, row) + (TH - 36) // 2, 36, 36)
    nodes[id] = {'el': e, 'box': box, 'kind': kind, 'typ': typ, 'label': None}
    return e


def task(id, name, lane, col, row=0, kind=HUMAN):
    return node(id, 'serviceTask' if kind == SYSTEM else 'userTask', name, lane, col, row, kind)


def mid(id, side):
    x, y, w, h = nodes[id]['box']
    return {'l': (x, y + h / 2), 'r': (x + w, y + h / 2), 't': (x + w / 2, y), 'b': (x + w / 2, y + h)}[side]


def flow(src, dst, name=None, points=None, label=None, default=False, condition=None):
    fid = 'F_' + src + '_' + dst
    attrs = dict(id=fid, sourceRef=src, targetRef=dst)
    if name:
        attrs['name'] = name
    f = el(process, 'bpmn:sequenceFlow', **attrs)
    if condition:
        c = el(f, 'bpmn:conditionExpression', condition)
        c.set('{http://www.w3.org/2001/XMLSchema-instance}type', 'bpmn:tFormalExpression')
    el(nodes[src]['el'], 'bpmn:outgoing', fid)
    el(nodes[dst]['el'], 'bpmn:incoming', fid)
    if default:
        nodes[src]['el'].set('default', fid)
    if points is None:
        a, b = mid(src, 'r'), mid(dst, 'l')
        if abs(a[1] - b[1]) < 1:
            points = [a, b]
        else:
            mx = b[0] - 18
            points = [a, (mx, a[1]), (mx, b[1]), b]
    flows.append({'id': fid, 'points': points, 'label': label})


# ── Вузли ──────────────────────────────────────────────────────────────
node('Start_Injury', 'startEvent', 'Поранення', 'Medical', 0)
task('Care_ePMK', 'Надати допомогу; внести еПМК у МІС ЗСУ', 'Medical', 1)
task('Sys_Open', 'Отримати еПМК, звірити особу й випадок, відкрити кейс', 'System', 2, kind=SYSTEM)
node('Gw_Match', 'exclusiveGateway', 'Збіг підтверджено?', 'System', 3)
task('Unit_Match', 'Супровід: звірити особу й випадок вручну', 'Unit', 3)
node('Fork_Case', 'parallelGateway', '', 'System', 4)

task('Soldier_View', 'Бачити перелік і стан документів та наступний крок', 'Soldier', 5)
node('End_View', 'endEvent', 'Боєць знає, що далі', 'Soldier', 6)

task('Care_Treat', 'Лікувати; оформити виписки й переведення', 'Medical', 5)
task('Sys_Clock', 'Зафіксувати надходження; рахувати строки: довідка 5 днів, ВЛК до 12 міс.', 'System', 6, kind=SYSTEM)

task('Sys_CertTask', 'Поставити частині задачу: довідка про обставини травми', 'System', 5, row=1, kind=SYSTEM)
task('Unit_CertPrep', 'Начальник медслужби: скласти довідку', 'Unit', 6)
task('Unit_CertSign', 'Рішення командира: підписати довідку', 'Unit', 7, kind=DECISION)
task('Sys_Remind', 'Нагадати командиру й супроводу про строк', 'System', 7, kind=SYSTEM)
node('End_Remind', 'endEvent', 'Нагадування надіслано', 'System', 8)
task('Sys_CertSend', 'Надіслати довідку закладу й бійцю; зафіксувати отримання', 'System', 8, row=1, kind=SYSTEM)

task('Sys_Reward', 'Зібрати підстави винагороди за стаціонарне лікування', 'System', 6, row=2, kind=SYSTEM)
task('Unit_RewardOrder', 'Рішення командира: наказ про винагороду', 'Unit', 7, row=1, kind=DECISION)
task('Fin_RewardPay', 'Фінслужба: нарахувати й виплатити винагороду', 'Finance', 8)
task('Sys_RewardShow', 'Показати бійцю стан винагороди', 'System', 9, row=2, kind=SYSTEM)
node('End_Reward', 'endEvent', 'Винагороду виплачено й показано', 'System', 10, row=2)

node('Join_Docs', 'parallelGateway', '', 'System', 9)
task('Sys_Check', 'Перевірити комплектність пакета ВЛК; показати прогалини й автора', 'System', 10, kind=SYSTEM)
node('Gw_Gaps', 'exclusiveGateway', 'Є прогалини?', 'System', 11)
task('Sys_GapTask', 'Задача автору документа; направлення не блокує', 'System', 11, row=1, kind=SYSTEM)
node('Merge_Gaps', 'exclusiveGateway', '', 'System', 12)
task('Unit_Refer', 'Рішення: направити на ВЛК (командир або заклад)', 'Unit', 13, kind=DECISION)
task('Sys_SendVLK', 'Передати пакет у ВЛК; зафіксувати отримання', 'System', 14, kind=SYSTEM)
task('VLK_Exam', 'ВЛК: огляд, причинний зв’язок', 'VLK', 15)
task('VLK_Decision', 'Рішення ВЛК: постанова', 'VLK', 16, kind=DECISION)
task('Sys_ShowDecision', 'Показати постанову бійцю й частині; відкрити ОГД', 'System', 17, kind=SYSTEM)
node('Fork_After', 'parallelGateway', '', 'System', 18)
task('Unit_Execute', 'Частина: виконати дії за постановою', 'Unit', 19)
node('End_Route', 'endEvent', 'Подальший маршрут визначено', 'Unit', 20)
task('Sys_OGDCheck', 'Перевірити пакет ОГД: довідка + постанова ВЛК', 'System', 19, kind=SYSTEM)
task('Fin_OGDConclusion', 'Уповноважений орган: висновок', 'Finance', 20)
task('Fin_OGDDecision', 'Рішення розпорядника коштів: призначити або відмовити', 'Finance', 21, kind=DECISION)
task('Sys_OGDShow', 'Показати рішення й підтвердження виплати', 'System', 22, kind=SYSTEM)
node('End_OGD', 'endEvent', 'Результат ОГД показано', 'System', 23)

# Неперервний таймер строку довідки на задачі командира.
b = el(process, 'bpmn:boundaryEvent', id='Timer_Cert', name='Строк довідки сплив', attachedToRef='Unit_CertSign',
       cancelActivity='false')
el(lanes['Unit'], 'bpmn:flowNodeRef', 'Timer_Cert')
td = el(b, 'bpmn:timerEventDefinition', id='TimerDef_Cert')
el(td, 'bpmn:timeDate', 'надходження + 5 календарних днів (лише дії противника)')
sx, sy, sw, sh = nodes['Unit_CertSign']['box']
nodes['Timer_Cert'] = {'el': b, 'box': (sx + sw / 2 - 18, sy - 18, 36, 36), 'kind': None, 'typ': 'boundaryEvent',
                       'label': (sx + sw / 2 + 20, sy - 44, 120, 26)}

# ── Потоки ─────────────────────────────────────────────────────────────
flow('Start_Injury', 'Care_ePMK')
flow('Care_ePMK', 'Sys_Open')
flow('Sys_Open', 'Gw_Match')
gx, gy, gw, gh = nodes['Gw_Match']['box']
flow('Gw_Match', 'Fork_Case', 'Так', condition='identity_and_incident_confirmed', label=(gx + 52, gy + 6, 30, 18))
ux, uy, uw, uh = nodes['Unit_Match']['box']
flow('Gw_Match', 'Unit_Match', 'Ні', default=True, points=[(gx + 25, gy + 50), (gx + 25, uy)], label=(gx + 32, gy + 60, 24, 18))
ox, oy, ow, oh = nodes['Sys_Open']['box']
flow('Unit_Match', 'Sys_Open', points=[(ux, uy + uh / 2), (ox + ow / 2, uy + uh / 2), (ox + ow / 2, oy + oh)])

fx, fy, fw, fh = nodes['Fork_Case']['box']
for dst in ('Soldier_View', 'Care_Treat'):
    t = mid(dst, 'l')
    flow('Fork_Case', dst, points=[(fx + 25, fy), (fx + 25, t[1]), t])
t = mid('Sys_CertTask', 'l')
flow('Fork_Case', 'Sys_CertTask', points=[(fx + 25, fy + 50), (fx + 25, t[1]), t])
t = mid('Sys_Reward', 'l')
flow('Fork_Case', 'Sys_Reward', points=[(fx + 50, fy + 25), (fx + 70, fy + 25), (fx + 70, t[1]), t])
flow('Soldier_View', 'End_View')
flow('Care_Treat', 'Sys_Clock')
flow('Sys_CertTask', 'Unit_CertPrep')
flow('Unit_CertPrep', 'Unit_CertSign')
flow('Unit_CertSign', 'Sys_CertSend')
tx, ty, tw, th = nodes['Timer_Cert']['box']
rx, ry, rw, rh = nodes['Sys_Remind']['box']
flow('Timer_Cert', 'Sys_Remind', points=[(tx + 18, ty), (tx + 18, ry + rh)])
flow('Sys_Remind', 'End_Remind')

jx, jy, jw, jh = nodes['Join_Docs']['box']
a = mid('Sys_Clock', 'r')
flow('Sys_Clock', 'Join_Docs', points=[a, (a[0] + 20, a[1]), (a[0] + 20, jy - 30), (jx + 25, jy - 30), (jx + 25, jy)])
a = mid('Sys_CertSend', 'r')
flow('Sys_CertSend', 'Join_Docs', points=[a, (jx + 25, a[1]), (jx + 25, jy + 50)])

flow('Sys_Reward', 'Unit_RewardOrder')
flow('Unit_RewardOrder', 'Fin_RewardPay')
flow('Fin_RewardPay', 'Sys_RewardShow')
flow('Sys_RewardShow', 'End_Reward')

flow('Join_Docs', 'Sys_Check')
flow('Sys_Check', 'Gw_Gaps')
gx, gy, gw, gh = nodes['Gw_Gaps']['box']
flow('Gw_Gaps', 'Merge_Gaps', 'Ні', default=True, label=(gx + 54, gy + 6, 24, 18))
t = mid('Sys_GapTask', 't')
flow('Gw_Gaps', 'Sys_GapTask', 'Так', condition='technical_gaps_found', points=[(gx + 25, gy + 50), t],
     label=(gx + 32, gy + 56, 30, 18))
mx, my, mw, mh = nodes['Merge_Gaps']['box']
a = mid('Sys_GapTask', 'r')
flow('Sys_GapTask', 'Merge_Gaps', points=[a, (mx + 25, a[1]), (mx + 25, my + 50)])
flow('Merge_Gaps', 'Unit_Refer')
flow('Unit_Refer', 'Sys_SendVLK')
flow('Sys_SendVLK', 'VLK_Exam')
flow('VLK_Exam', 'VLK_Decision')
flow('VLK_Decision', 'Sys_ShowDecision')
flow('Sys_ShowDecision', 'Fork_After')
fx, fy, fw, fh = nodes['Fork_After']['box']
t = mid('Unit_Execute', 'l')
flow('Fork_After', 'Unit_Execute', points=[(fx + 25, fy + 50), (fx + 25, t[1]), t])
flow('Fork_After', 'Sys_OGDCheck')
flow('Unit_Execute', 'End_Route')
flow('Sys_OGDCheck', 'Fin_OGDConclusion')
flow('Fin_OGDConclusion', 'Fin_OGDDecision')
flow('Fin_OGDDecision', 'Sys_OGDShow')
flow('Sys_OGDShow', 'End_OGD')

# ── Легенда ────────────────────────────────────────────────────────────
notes = []


def note(id, text, x, y, w, h):
    el(el(process, 'bpmn:textAnnotation', id=id), 'bpmn:text', text)
    notes.append((id, (x, y, w, h)))


note('Note_Legend', 'Іконка людини — дію виконує людина. Шестерня — дію виконує сервіс «Кейс поранення». '
     'Помаранчеве — рішення уповноваженої особи (командир, ВЛК, розпорядник коштів). '
     'Перевіряє система, вирішує людина.', X0 + 10, 4, 1500, 50)
note('Note_Scope', 'Огляд. Деталі, повтори, конфлікти й винятки — у детальній моделі to-be.bpmn (вісім площин). '
     'Строк огляду ВЛК — п. 11 ст. 10-1 Закону №2011-XII у редакції з 24.11.2026.', X0 + 1560, 4, 1500, 50)

# BPMN XSD вимагає порядок: incoming, outgoing — перед визначеннями подій.
for n in nodes.values():
    e = n['el']
    refs = [c for c in list(e) if c.tag in (q('bpmn:incoming'), q('bpmn:outgoing'))]
    for c in refs:
        e.remove(c)
    refs.sort(key=lambda c: 0 if c.tag == q('bpmn:incoming') else 1)
    for i, c in enumerate(refs):
        e.insert(i, c)

# ── DI ─────────────────────────────────────────────────────────────────
dg = el(root, 'bpmndi:BPMNDiagram', id='Diagram_ToBeOverview', name='TO BE огляд')
plane = el(dg, 'bpmndi:BPMNPlane', id='Plane_ToBeOverview', bpmnElement='Collaboration_ToBeOverview')


def bounds(parent, x, y, w, h):
    el(parent, 'dc:Bounds', x=round(x), y=round(y), width=round(w), height=round(h))


s = el(plane, 'bpmndi:BPMNShape', id='Pool_ToBe_di', bpmnElement='Pool_ToBe', isHorizontal='true')
bounds(s, X0, 60, LANE_W, POOL_H)
for key, _, _ in LANES:
    top, h = lane_y[key]
    s = el(plane, 'bpmndi:BPMNShape', id='Lane_' + key + '_di', bpmnElement='Lane_' + key, isHorizontal='true')
    bounds(s, X0 + HEAD, top, LANE_W - HEAD, h)
for nid, n in nodes.items():
    attrs = dict(id=nid + '_di', bpmnElement=nid)
    if n['kind'] in (SYSTEM, DECISION):
        fill, stroke = FILL[n['kind']]
        attrs['{%s}fill' % NS['bioc']] = fill
        attrs['{%s}stroke' % NS['bioc']] = stroke
        attrs['{%s}background-color' % NS['color']] = fill
        attrs['{%s}border-color' % NS['color']] = stroke
    s = el(plane, 'bpmndi:BPMNShape', **attrs)
    bounds(s, *n['box'])
    x, y, w, h = n['box']
    if n['typ'].endswith('Gateway') or n['typ'].endswith('Event'):
        name = n['el'].get('name')
        if name:
            lab = el(s, 'bpmndi:BPMNLabel')
            lx, ly, lw, lh = n['label'] or (x - 35, y + h + 4, w + 70, 30)
            if n['typ'].endswith('Gateway'):
                lx, ly, lw, lh = n['label'] or (x - 30, y - 34, 110, 30)
            bounds(lab, lx, ly, lw, lh)
for f in flows:
    e = el(plane, 'bpmndi:BPMNEdge', id=f['id'] + '_di', bpmnElement=f['id'])
    for px, py in f['points']:
        el(e, 'di:waypoint', x=round(px), y=round(py))
    if f['label']:
        bounds(el(e, 'bpmndi:BPMNLabel'), *f['label'])
for nid, box in notes:
    bounds(el(plane, 'bpmndi:BPMNShape', id=nid + '_di', bpmnElement=nid), *box)

out = Path(__file__).with_name('to-be-overview.bpmn')
E.indent(root)
out.write_text(E.tostring(root, encoding='unicode', xml_declaration=True) + '\n', encoding='utf-8')
print(f'{out.relative_to(Path.cwd())}: {len(nodes)} вузлів, {len(flows)} потоків')
