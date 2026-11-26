"""Верхньорівнева ентерпрайз-архітектура «Кейсу поранення» (крок II): користувачі → канали → модулі → наявні системи.

Запуск з кореня репозиторію: python3 docs/architecture/generate-ea.py
Джерела змісту: c4-context.md, c4-container.md, rbac.md, ADR 0001–0013. Пунктир — цільові інтеграції,
не підтверджені API; у прототипі їх замінює симулятор.
"""
from pathlib import Path
from xml.sax.saxutils import escape

W, H = 1640, 860
INK, MUTED, LINE = '#1b1f24', '#5a6370', '#c7cdd6'
SYS_FILL, SYS_STROKE = '#dce9f7', '#1f4e79'
USER_FILL, CH_FILL, EXT_FILL = '#ffffff', '#fdf3e6', '#f1f3f5'
out = []


def text(x, y, s, size=13, weight='normal', fill=INK, anchor='start'):
    out.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" '
               f'text-anchor="{anchor}">{escape(s)}</text>')


def box(x, y, w, h, title, lines=(), fill='#fff', stroke=LINE, title_fill=INK, r=8, size=13):
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="1.4"/>')
    text(x + 12, y + 22, title, size=size, weight='bold', fill=title_fill)
    for i, line in enumerate(lines):
        text(x + 12, y + 41 + i * 16, line, size=11.5, fill=MUTED)


def arrow(x1, y1, x2, y2, dashed=False, label=None, lx=None, ly=None):
    dash = ' stroke-dasharray="6 5"' if dashed else ''
    out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#4a5563" stroke-width="1.4"{dash} '
               f'marker-end="url(#arrow)"/>')
    if label:
        text(lx if lx is not None else (x1 + x2) / 2, ly if ly is not None else (y1 + y2) / 2 - 6, label,
             size=10.5, fill=MUTED, anchor='start' if lx is not None else 'middle')


def column_title(x, w, title, sub):
    text(x + w / 2, 70, title, size=15, weight='bold', anchor='middle')
    text(x + w / 2, 88, sub, size=11.5, fill=MUTED, anchor='middle')


text(24, 34, '«Кейс поранення»: верхньорівнева ентерпрайз-архітектура', size=20, weight='bold')
text(W - 24, 34, 'Навчальний проєкт KSE MIL600 · дані в прототипі вигадані', size=11.5, fill=MUTED, anchor='end')

# Колонки
UX, CX, SX, EX = 24, 290, 560, 1150
UW, CW, SW, EW = 230, 230, 550, 466
column_title(UX, UW, 'Користувачі', 'хто працює з кейсом')
column_title(CX, CW, 'Канали', 'де вони це бачать')
column_title(SX, SW, 'Сервіс «Кейс поранення»', 'новий модуль екосистеми МОУ')
column_title(EX, EW, 'Наявні системи', 'де живуть документи й рішення')

users = [
    ('Військовослужбовець', ['бачить свій кейс, документи,', 'строки й виплати']),
    ('Родина / довірена особа', ['звертається через супровід;', 'власного доступу немає']),
    ('Командир частини', ['запит довідки, направлення', 'на ВЛК; без діагнозів']),
    ('Служба супроводу', ['усі призначені кейси,', 'уточнення, звернення']),
    ('Аналітик / керівництво', ['лише агрегати BO,', 'без даних людей']),
]
uy = []
for i, (t, ls) in enumerate(users):
    y = 110 + i * 112
    box(UX, y, UW, 84, t, ls, fill=USER_FILL)
    uy.append(y + 42)

channels = [
    ('Армія+: «Мій кейс»', ['мобільний кабінет бійця; простий,', 'працює при поганому зв’язку'], 0),
    ('Армія+: режим командира', ['задачі частини:', 'довідка, направлення'], 2),
    ('Робоче місце супроводу', ['черга кейсів, задачі,', 'журнал звернень'], 3),
    ('Аналітична панель', ['показники BO-1…BO-7,', 'пригнічення малих груп'], 4),
]
cy = {}
for t, ls, ui in channels:
    y = 110 + ui * 112
    box(CX, y, CW, 84, t, ls, fill=CH_FILL, stroke='#e0b98a')
    cy[ui] = y + 42
for ui in (0, 2, 3, 4):
    arrow(UX + UW, uy[ui], CX - 4, cy[ui])
fy, ty = 110 + 112 + 62, 110 + 3 * 112 + 62
out.append(f'<polyline points="{UX + UW},{fy} {UX + UW + 18},{fy} {UX + UW + 18},{ty} {CX - 4},{ty}" fill="none" '
           f'stroke="#4a5563" stroke-width="1.4" marker-end="url(#arrow)"/>')
text(UX + UW + 24, fy - 6, 'звернення', size=10.5, fill=MUTED)

# Сервіс
out.append(f'<rect x="{SX}" y="104" width="{SW}" height="560" rx="12" fill="#f5f9fd" stroke="{SYS_STROKE}" stroke-width="1.8"/>')
modules = [
    ('Шлюз подій', ['перевіряє джерело, підпис,', 'повтор; бере лише мінімум полів']),
    ('Кейс і таймлайн', ['один кейс на поранення;', 'етап, наступний крок, хто діє']),
    ('Документи й чеклісти', ['окремо ВЛК / винагорода / ОГД;', 'версія, автор, отримання']),
    ('Строки й задачі', ['довідка 5 днів; ВЛК до 12 міс.;', 'нагадування людині, без санкцій']),
    ('Доступ і ролі', ['перевірка на сервері; командиру', 'без діагнозів, аналітику без людей']),
    ('Аналітика', ['агрегати BO; невідоме ≠ 0;', 'малі групи приховано']),
]
mw, mh = 255, 88
for i, (t, ls) in enumerate(modules):
    col, row = i % 2, i // 2
    x = SX + 16 + col * (mw + 8)
    y = 124 + row * (mh + 14)
    box(x, y, mw, mh, t, ls, fill=SYS_FILL, stroke=SYS_STROKE, title_fill=SYS_STROKE)
box(SX + 16, 124 + 3 * (mh + 14), SW - 32, 70, 'Журнал і аудит',
    ['хто що побачив і зробив, без медичного змісту; повтор події не дублює дію'], fill=SYS_FILL, stroke=SYS_STROKE,
    title_fill=SYS_STROKE)
box(SX + 16, 124 + 3 * (mh + 14) + 84, SW - 32, 86, 'Сховище кейсу',
    ['метадані, стани, задачі, журнал подій, посилання на документи;',
     'клінічні документи лишаються в МІС, копій медзаписів сервіс не тримає'], fill='#ffffff', stroke=SYS_STROKE,
    title_fill=SYS_STROKE)
text(SX + 16, 124 + 3 * (mh + 14) + 196, 'Сервіс не ставить діагнозів, не підписує документів і не ухвалює рішень:', size=11.5,
     fill=SYS_STROKE)
text(SX + 16, 124 + 3 * (mh + 14) + 213, 'перевіряє, рахує, нагадує й показує. Вирішують командир, ВЛК, розпорядник коштів.',
     size=11.5, fill=SYS_STROKE)
for ui in (0, 2, 3, 4):
    arrow(CX + CW, cy[ui], SX - 4, cy[ui] if ui else cy[ui])

systems = [
    ('МІС ЗСУ', ['еПМК від медика; постанови ВЛК'], 'еПМК, постанова', True),
    ('Системи закладів / ЕСОЗ', ['надходження, переведення, виписки'], 'надходження', True),
    ('СЕДО', ['довідка про обставини травми, накази,', 'квитанції про отримання'], 'довідка, квитанція', True),
    ('Облік особового складу', ['призначення бійця до частини'], 'частина бійця', True),
    ('Фінансові джерела / орган ОГД', ['накази, рішення, підтвердження виплат'], 'стан виплати', True),
    ('ІКС «Супровід»', ['можливе розміщення модуля; межі', 'й готовність уточнює власник'], 'розміщення', False),
]
for i, (t, ls, lab, inbound) in enumerate(systems):
    y = 110 + i * 92
    box(EX + 70, y, EW - 70, 76, t, ls, fill=EXT_FILL)
    yy = y + 38
    if inbound:
        arrow(EX + 66, yy, SX + SW + 4, yy, dashed=True)
        text(SX + SW + 8, yy - 7, lab, size=10.5, fill=MUTED)
    else:
        arrow(SX + SW + 4, yy, EX + 66, yy, dashed=True)
        text(SX + SW + 8, yy - 7, lab, size=10.5, fill=MUTED)

# Хто де працює
box(24, 690, 520, 160, 'Хто працює у своїх системах', [
    'Медик вносить еПМК у МІС ЗСУ, як і зараз: нової форми немає.',
    'ВЛК оглядає й оформлює постанову у своїй МІС.',
    'Начальник медслужби й командир оформлюють довідку в СЕДО.',
    'Фінслужба й орган ОГД ухвалюють рішення у своєму контурі.',
    'Сервіс отримує від них події й показує стан у кейсі.',
], fill='#fff')
box(560, 690, 550, 160, 'Безпека й дані', [
    'Мінімум даних: лише те, що потрібно для кроку маршруту.',
    'Доступ за роллю й частиною, перевірка на кожен запит.',
    'Захист за ст. 8 Закону №80/94-ВР, погодження власника,',
    'категоризація інформації; без цього реальних даних немає.',
    'Командир бачить службовий мінімум, не медичні записи.',
], fill='#fff')
box(1126, 690, 490, 160, 'Як читати', [
    'Суцільна стрілка: користувач працює з каналом / сервісом.',
    'Пунктир: цільова інтеграція з наявною системою. Її треба',
    'погодити з власником; у прототипі — симулятор подій.',
    'Синій: модулі нового сервісу. Сірий: наявні системи,',
    'які ми не змінюємо.',
], fill='#fff')

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
       f'font-family="Helvetica Neue, Arial, sans-serif">'
       '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
       '<path d="M0,0 L10,5 L0,10 z" fill="#4a5563"/></marker></defs>'
       f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + ''.join(out) + '</svg>\n')
path = Path(__file__).with_name('enterprise-architecture.svg')
path.write_text(svg, encoding='utf-8')
print(path)
