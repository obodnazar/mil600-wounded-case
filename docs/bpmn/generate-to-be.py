"""Відтворювана навчальна BPMN TO BE з окремими DI для деталей.

Запуск із кореня репозиторію: python3 docs/bpmn/generate-to-be.py
SVG експортує bpmn-js; цей скрипт змінює лише to-be.bpmn.
"""
from pathlib import Path
import xml.etree.ElementTree as E

NS = {'bpmn': 'http://www.omg.org/spec/BPMN/20100524/MODEL',
      'bpmndi': 'http://www.omg.org/spec/BPMN/20100524/DI',
      'dc': 'http://www.omg.org/spec/DD/20100524/DC',
      'di': 'http://www.omg.org/spec/DD/20100524/DI',
      'xsi': 'http://www.w3.org/2001/XMLSchema-instance'}
for k, v in NS.items(): E.register_namespace(k, v)
def el(p, tag, text=None, **a):
    k, n = tag.split(':')
    e = E.SubElement(p, '{'+NS[k]+'}'+n, {k:str(v) for k,v in a.items()})
    if text is not None: e.text = text
    return e
root = E.Element('{'+NS['bpmn']+'}definitions', id='Definitions_ToBe',
                 targetNamespace='https://example.invalid/mil600/to-be', exporter='MIL600 навчальна модель')
process = el(root, 'bpmn:process', id='Process_ToBe', name='Координація кейсу поранення — TO BE', isExecutable='false')
el(process,'bpmn:documentation', 'Пропозиція 2026-11-13. Одна концептуальна координація, не підпорядкування установ. '
   'Медичні факти й рішення залишаються в уповноважених джерелах. Інтеграції демо синтетичні. '
   'Завершення гілки BPMN не закриває WoundCase чи всі фінансові періоди. Див. docs/06-to-be.md.')
laneset = el(process, 'bpmn:laneSet', id='LaneSet_ToBe')
lane_defs = [('Medical','Медичні установи: чинна допомога',80,240),
             ('System','Координація / сервіс: серверні межі',320,250),
             ('Unit','Частина: належні посадові особи',570,280),
             ('VLK','Направлення / ВЛК: учасники в деталях',850,220),
             ('Finance','Фінансові маршрути: учасники в деталях',1070,280)]
lanes = {key:el(laneset,'bpmn:lane',id='Lane_'+key,name=name) for key,name,_,_ in lane_defs}
diagrams = []
nodes = {}
flows = []
def diagram(key, scope, title, width, height, main=False):
    d = {'key':key,'scope':scope,'title':title,'width':width,'height':height,'nodes':[],'flows':[],'main':main,'notes':[]}
    diagrams.append(d)
    return d
main = diagram('overview', process, 'TO BE • навчальна пропозиція • 2026-11-13 • деталі: окремі SVG / DI цього XML',2320,1470,True)
def node(d, id, typ, name, x, y, w=180, h=80, lane=None, doc=None, **attrs):
    e = el(d['scope'],'bpmn:'+typ,id=id,name=name,**attrs)
    if doc: el(e,'bpmn:documentation',doc)
    if lane: el(lanes[lane],'bpmn:flowNodeRef',id)
    n={'id':id,'el':e,'box':(x,y,w,h),'type':typ,'name':name,'d':d}
    nodes[id]=n; d['nodes'].append(n)
    return e
def event(d,id,typ,name,x,y,lane=None,**attrs):
    return node(d,id,typ,name,x,y,36,36,lane,**attrs)
def gate(d,id,name,x,y,lane=None,parallel=False):
    return node(d,id,'parallelGateway' if parallel else 'exclusiveGateway',name,x,y,50,50,lane)
def flow(d,id,src,dst,name=None,points=None,default=False,condition=None,label=None):
    s,t=nodes[src],nodes[dst]
    a,b=s['box'],t['box']
    if points is None:
        sy,ty=a[1]+a[3]/2,b[1]+b[3]/2
        points=[(a[0]+a[2],sy),(b[0],ty)] if sy==ty else [(a[0]+a[2],sy),((a[0]+a[2]+b[0])/2,sy),((a[0]+a[2]+b[0])/2,ty),(b[0],ty)]
    f=el(d['scope'],'bpmn:sequenceFlow',id=id,sourceRef=src,targetRef=dst,**({'name':name} if name else {}))
    if condition:
        c=el(f,'bpmn:conditionExpression',condition)
        c.set('{'+NS['xsi']+'}type','bpmn:tFormalExpression')
    if default: s['el'].set('default',id)
    # BPMN XSD: documentation, incoming, outgoing, eventDefinitions / loopCharacteristics.
    for n,tag in [(s,'outgoing'),(t,'incoming')]:
        item=E.Element('{'+NS['bpmn']+'}'+tag);item.text=id
        children=list(n['el']); before=['timerEventDefinition','messageEventDefinition','multiInstanceLoopCharacteristics']
        if tag=='incoming': before.append('outgoing')
        idx=next((i for i,c in enumerate(children) if c.tag.split('}')[-1] in before),len(children))
        n['el'].insert(idx,item)
    if label is None and name:
        # Підпис біля середини найдовшого сегмента, а не всередині адресата.
        a,b=max(zip(points,points[1:]),key=lambda p:abs(p[0][0]-p[1][0])+abs(p[0][1]-p[1][1]))
        x,y=(a[0]+b[0])/2,(a[1]+b[1])/2
        label=(x-65,y-36,130,32) if a[1]==b[1] else (x+10,y-16,130,32)
    d['flows'].append((id,points,label));flows.append(f)
def chain(d, ids):
    for a,b in zip(ids,ids[1:]):flow(d,'F_'+a+'_'+b,a,b)
def note(d,id,text,x,y,w,h):d['notes'].append((id,text,(x,y,w,h)))

# Огляд: лікування не очікує ані входу в застосунок, ані створення кейсу.
event(main,'Start_Injury','startEvent','Поранення',160,150,'Medical')
gate(main,'Fork_CareCase','',270,143,'Medical',True)
node(main,'Sub_Care','subProcess','Чинна допомога, лікування, переведення',420,118,220,100,'Medical')
event(main,'End_Care','endEvent','Клінічна гілка',690,150,'Medical')
node(main,'Sub_Intake','subProcess','еПМК АБО адміністративна ініціація; особа + випадок',420,365,250,100,'System')
gate(main,'Gateway_NewCase','Новий кейс?',760,390,'System')
event(main,'End_Joined','endEvent','Долучено до наявного; задачі не дублюються',930,390,'System')
gate(main,'Fork_Admin','',830,490,'System',True)
node(main,'Sub_Certificate','subProcess','Довідка: скласти → видати → отримати',940,640,220,100,'Unit')
event(main,'End_Certificate','endEvent','Отримання цієї версії підтверджено',1210,672,'Unit')
node(main,'Sub_VLK','subProcess','Належне направлення → пакет → рішення ВЛК',1250,900,230,100,'VLK')
gate(main,'Fork_AfterVLK','',1580,925,'VLK',True)
node(main,'Task_ServiceExecution','userTask','Уповноважена особа: виконати службову дію; підтвердити окремо',1800,640,230,100,'Unit')
event(main,'End_Service','endEvent','Службова дія виконана',2150,672,'Unit')
node(main,'Sub_Reward','subProcess','Додаткова винагорода: окремий період / підстави',940,1140,230,100,'Finance')
event(main,'End_Reward','endEvent','Стан обраного періоду',1250,1172,'Finance')
node(main,'Sub_OGD','subProcess','ОГД: окремий пакет, орган і виконання',1800,1140,230,100,'Finance')
event(main,'End_OGD','endEvent','Стан окремого пакета',2150,1172,'Finance')
node(main,'EventSub_Control','subProcess','Нова подія / погоджена звірка / звернення: окремий прохід',1360,365,290,110,'System',triggeredByEvent='true')
event(main,'Timer_Long','boundaryEvent','Контроль до 4 календарних місяців',520,202,'Medical',attachedToRef='Sub_Care',cancelActivity='false')
e=el(nodes['Timer_Long']['el'],'bpmn:timerEventDefinition',id='TimerDef_Long');el(e,'bpmn:timeDate','long_treatment_review_at')
node(main,'Task_LongReview','userTask','Медик / супровід: перевірити актуальність і організувати належний огляд',790,145,220,80,'Medical')
event(main,'End_LongReview','endEvent','Без санкцій від таймера',1110,167,'Medical')
event(main,'Timer_Certificate','boundaryEvent','Контроль застосовного строку',1040,722,'Unit',attachedToRef='Sub_Certificate',cancelActivity='false')
e=el(nodes['Timer_Certificate']['el'],'bpmn:timerEventDefinition',id='TimerDef_Certificate');el(e,'bpmn:timeDate','certificate_due_at')
node(main,'Task_CertReview','userTask','Супровід: перевірити стан / дату; уточнити в автора',1330,650,200,80,'Unit')
event(main,'End_CertReview','endEvent','Без автоматичної відмови',1600,672,'Unit')
chain(main,['Start_Injury','Fork_CareCase','Sub_Care','End_Care'])
flow(main,'F_ToIntake','Fork_CareCase','Sub_Intake',points=[(295,193),(295,415),(420,415)])
chain(main,['Sub_Intake','Gateway_NewCase'])
flow(main,'F_Existing','Gateway_NewCase','End_Joined','Наявний / повтор',default=True,label=(820,370,135,25))
flow(main,'F_New','Gateway_NewCase','Fork_Admin','Створено',condition='created == true',points=[(785,440),(785,515),(830,515)],label=(700,460,100,25))
flow(main,'F_ToCert','Fork_Admin','Sub_Certificate',points=[(855,540),(855,690),(940,690)])
flow(main,'F_ToVLK','Fork_Admin','Sub_VLK',points=[(880,515),(1180,515),(1180,950),(1250,950)])
flow(main,'F_ToReward','Fork_Admin','Sub_Reward',points=[(855,540),(855,1190),(940,1190)])
chain(main,['Sub_Certificate','End_Certificate']);chain(main,['Sub_Reward','End_Reward'])
chain(main,['Sub_VLK','Fork_AfterVLK'])
flow(main,'F_ToService','Fork_AfterVLK','Task_ServiceExecution',points=[(1605,925),(1690,925),(1690,690),(1800,690)])
flow(main,'F_ToOGD','Fork_AfterVLK','Sub_OGD',points=[(1605,975),(1690,975),(1690,1190),(1800,1190)])
chain(main,['Task_ServiceExecution','End_Service']);chain(main,['Sub_OGD','End_OGD'])
flow(main,'F_LongAlert','Timer_Long','Task_LongReview',points=[(538,238),(538,275),(900,275),(900,225)])
chain(main,['Task_LongReview','End_LongReview'])
flow(main,'F_CertAlert','Timer_Certificate','Task_CertReview',points=[(1058,758),(1058,800),(1430,800),(1430,730)])
chain(main,['Task_CertReview','End_CertReview'])
note(main,'Note_Timers','Таймер вмикається лише за відомої застосовної дати. Невідома дата → задача уточнення. 4 місяці — від початку лікування; переведення не скидає її. 5 днів для визначеного випадку N16 — від отримання документа військовим.',120,1370,1230,95)
note(main,'Note_Trust','Усі читання / дії: серверна роль + scope + поля; оригінали в джерелах. Немає входу бійця → призначений супровід. Родина не отримує доступ автоматично. Немає події ≠ немає лікування / права. Демо — лише вигадані дані.',1400,1370,850,95)

# Деталі допомоги: звичайні медичні дії, поза автоматизацією продукту.
care=diagram('care',nodes['Sub_Care']['el'],'Медична допомога • чинні уповноважені медики • C6 поза продуктом',2100,560)
event(care,'Care_Start','startEvent','',80,202)
node(care,'Care_Primary','userTask','Медик: допомога; ПМК / еПМК у чинній системі',170,180)
node(care,'Care_Admission','userTask','Заклад: початок / епізод лікування; джерельна дата',420,180)
node(care,'Care_Treatment','userTask','Медики: лікування за клінічними рішеннями',670,180)
gate(care,'Care_TransferNeeded','Переведення?',940,195)
node(care,'Care_Transfer','userTask','Заклад: переведення, новий епізод; початок без скидання',680,380)
node(care,'Care_Documents','userTask','Автор: оформити належні медичні документи у джерелі',1140,180)
event(care,'Care_End','endEvent','Завершено клінічний епізод',1440,202)
chain(care,['Care_Start','Care_Primary','Care_Admission','Care_Treatment','Care_TransferNeeded'])
flow(care,'Care_NoTransfer','Care_TransferNeeded','Care_Documents','Ні',default=True)
flow(care,'Care_YesTransfer','Care_TransferNeeded','Care_Transfer','Так',condition='transfer_required',points=[(965,245),(965,420),(860,420)],label=(975,310,60,25))
flow(care,'Care_TransferLoop','Care_Transfer','Care_Admission',points=[(680,420),(390,420),(390,220),(420,220)])
chain(care,['Care_Documents','Care_End'])
note(care,'Care_Note','Кейс отримує лише дозволені мінімальні події / посилання. Медики не вводять ті самі клінічні дані в новий застосунок; реальні адаптери залежать від власників. N01, N04, N05; ADR 0001, 0003–0005.',1650,150,350,200)

intake=diagram('intake',nodes['Sub_Intake']['el'],'Ініціація • дві альтернативи • адміністративний кейс не створює медичного факту',2100,800)
event(intake,'Intake_Med','intermediateCatchEvent','Погоджена подія еПМК',90,130)
el(nodes['Intake_Med']['el'],'bpmn:messageEventDefinition',id='MessageDef_IntakeMed')
event(intake,'Intake_Admin','intermediateCatchEvent','Запит належного командира / супроводу',90,350)
el(nodes['Intake_Admin']['el'],'bpmn:messageEventDefinition',id='MessageDef_IntakeAdmin')
gate(intake,'Intake_Merge','',300,220)
node(intake,'Intake_Validate','serviceTask','Сервер: повноваження, мінімальний конверт, джерело',420,205)
node(intake,'Intake_Link','serviceTask','Перевірене зіставлення: особа + випадок + область',680,205)
gate(intake,'Intake_Matched','Достатній доказ?',920,220)
node(intake,'Intake_Review','userTask','Уповноважений: перевірити збіг; без пошуку за схожим ПІБ',1010,380)
gate(intake,'Intake_Resolved','Збіг доведено?',1260,395)
node(intake,'Intake_AwaitProof','receiveTask','Очікувати належне уточнення; до того не зливати кейси',1320,560)
node(intake,'Intake_EnsureCase','serviceTask','Атомарно: створити або знайти кейс; подія / аудит / outbox',1600,205,220,80)
event(intake,'Intake_End','endEvent','created = так / ні',1900,227)
flow(intake,'Intake_MedMerge','Intake_Med','Intake_Merge',points=[(126,148),(240,148),(240,245),(300,245)])
flow(intake,'Intake_AdminMerge','Intake_Admin','Intake_Merge',points=[(126,368),(240,368),(240,245),(300,245)])
chain(intake,['Intake_Merge','Intake_Validate','Intake_Link','Intake_Matched'])
flow(intake,'Intake_Trusted','Intake_Matched','Intake_EnsureCase','Так',condition='identity_and_incident_verified')
flow(intake,'Intake_Uncertain','Intake_Matched','Intake_Review','Ні / конфлікт',default=True,points=[(945,270),(945,420),(1010,420)],label=(810,330,120,25))
chain(intake,['Intake_Review','Intake_Resolved'])
flow(intake,'Intake_ResolvedYes','Intake_Resolved','Intake_EnsureCase','Так',condition='review_verified',points=[(1310,420),(1530,420),(1530,245),(1600,245)],label=(1430,390,60,25))
flow(intake,'Intake_ResolvedNo','Intake_Resolved','Intake_AwaitProof','Ні',default=True,points=[(1285,445),(1285,600),(1320,600)],label=(1200,500,60,25))
flow(intake,'Intake_Retry','Intake_AwaitProof','Intake_Link',points=[(1500,600),(1550,600),(1550,730),(650,730),(650,245),(680,245)])
chain(intake,['Intake_EnsureCase','Intake_End'])
note(intake,'Intake_Note','Повтор і пізня еПМК не створюють другого кейсу / комплекту задач. Нове поранення тієї самої особи — окремий випадок. Подія не надає AccessGrant. Невалідний / неавторизований запит відхиляє шлюз, а не гілка успішного процесу. F01, F09, F10; ADR 0003, 0005.',1630,420,380,230)
# Вкладений звичайний subprocess починається none-start; альтернативні
# повідомлення очікує event-based gateway, перша подія скасовує інше очікування.
for n in intake['nodes']:
    x,y,w,h=n['box'];n['box']=(x+230,y,w,h)
intake['flows']=[(id,[(x+230,y) for x,y in pts],(lb[0]+230,*lb[1:]) if lb else None) for id,pts,lb in intake['flows']]
intake['notes']=[(id,text,(box[0]+230,*box[1:])) for id,text,box in intake['notes']]
intake['width']=2400
event(intake,'Intake_Start','startEvent','',40,227)
node(intake,'Intake_WaitFirst','eventBasedGateway','Перший дозволений вхід',140,220,50,50)
chain(intake,['Intake_Start','Intake_WaitFirst'])
flow(intake,'Intake_WaitMed','Intake_WaitFirst','Intake_Med',points=[(165,220),(165,148),(320,148)])
flow(intake,'Intake_WaitAdmin','Intake_WaitFirst','Intake_Admin',points=[(165,270),(165,368),(320,368)])

cert=diagram('certificate',nodes['Sub_Certificate']['el'],'Довідка • підготовка, видача, надсилання та отримання різні • F03–F04',2070,430)
event(cert,'Cert_Start','startEvent','',60,202)
spec=[('Anchor','serviceTask','Сервіс: правило + якір; невідоме → задача уточнення'),
      ('Prepare','userTask','Начальник медслужби: скласти довідку'),
      ('Issue','userTask','Командир: видати довідку за повноваженнями'),
      ('Send','userTask','Належний відправник: передати чинним дозволеним каналом'),
      ('Receipt','receiveTask','Очікувати підтвердження отримання адресатом саме цієї версії'),
      ('Record','serviceTask','Сервіс: зафіксувати отримувача / версію / час; оновити вимоги')]
for i,(id,typ,name) in enumerate(spec):node(cert,'Cert_'+id,typ,name,150+i*280,180,220,80)
event(cert,'Cert_End','endEvent','Версія отримана',1900,202)
chain(cert,['Cert_Start']+['Cert_'+s[0] for s in spec]+['Cert_End'])
note(cert,'Cert_Note','N16 ст.260: для визначеного випадку 5 днів рахуються від отримання військовим первинного медичного облікового документа (за відсутності — довідки закладу), не від поранення / створення еПМК. Невідомий якір → null і уточнення; таймер нічого не санкціонує. Оригінал ≠ фото / OCR. Виправлена версія потребує нового отримання.',150,310,1810,90)

vlk=diagram('vlk',nodes['Sub_VLK']['el'],'ВЛК • технічний чекліст не блокує направлення • клінічне рішення залишається ВЛК',3130,620)
event(vlk,'VLK_Start','startEvent','',50,202)
node(vlk,'VLK_Referral','userTask','Належний видавець: оформити направлення за N01',140,180,210,80)
node(vlk,'VLK_Checklist','serviceTask','Сервіс: технічні вимоги пакета + версія правил',420,180,210,80)
gate(vlk,'VLK_Gaps','Прогалина?',710,195)
node(vlk,'VLK_CreateTask','serviceTask','Створити задачу автору; це не очікування її виконання',690,410,220,80)
gate(vlk,'VLK_Merge','',1010,195)
node(vlk,'VLK_Send','userTask','Належний учасник: передати наявні документи чинним каналом',1140,180,220,80)
node(vlk,'VLK_Receipt','receiveTask','Очікувати підтвердження отримання пакета ВЛК',1430,180,220,80)
gate(vlk,'VLK_Returned','Повернення?',1720,195)
node(vlk,'VLK_Correct','userTask','Автор документа: усунути зауваження; нова версія',1420,410,220,80)
node(vlk,'VLK_Exam','userTask','ВЛК: медичний огляд і причинний зв’язок; поза продуктом C6',1910,180,220,80)
node(vlk,'VLK_Decision','userTask','ВЛК: прийняти й оформити належну постанову',2200,180,220,80)
node(vlk,'VLK_Record','serviceTask','Сервіс: зафіксувати дозволений результат; наступна службова дія окремо',2490,180,230,80)
event(vlk,'VLK_End','endEvent','Рішення зафіксовано',2830,202)
chain(vlk,['VLK_Start','VLK_Referral','VLK_Checklist','VLK_Gaps'])
flow(vlk,'VLK_NoGap','VLK_Gaps','VLK_Merge','Ні',default=True)
flow(vlk,'VLK_HasGap','VLK_Gaps','VLK_CreateTask','Так',condition='requirements_missing_or_unknown',points=[(735,245),(735,410)],label=(750,320,60,25))
flow(vlk,'VLK_TaskCreated','VLK_CreateTask','VLK_Merge',points=[(910,450),(1035,450),(1035,245)])
chain(vlk,['VLK_Merge','VLK_Send','VLK_Receipt','VLK_Returned'])
flow(vlk,'VLK_NotReturned','VLK_Returned','VLK_Exam','Ні',default=True)
flow(vlk,'VLK_WasReturned','VLK_Returned','VLK_Correct','Так',condition='explicit_return_received',points=[(1745,245),(1745,450),(1640,450)],label=(1760,330,60,25))
flow(vlk,'VLK_CorrectionLoop','VLK_Correct','VLK_Send',points=[(1420,450),(1100,450),(1100,220),(1140,220)])
chain(vlk,['VLK_Exam','VLK_Decision','VLK_Record','VLK_End'])
note(vlk,'VLK_Note','Направлення видає суб’єкт належного рівня за N01 II 6.1 / за умовами 6.4; супровід координує, не підписує замість нього. Технічна прогалина створює задачу, не відмову в направленні. C2 — підгіпотеза; повернення моделюємо як можливий виняток. Оригінали й правомірність доступу перевіряє джерело.',1900,390,1110,140)

def financial(key, sub, prefix, title, basis):
    d=diagram(key,nodes[sub]['el'],title,2560,1100)
    def n(id,typ,name,x,y,w=180):return node(d,prefix+id,typ,name,x,y,w,80)
    def ev(id,name,x,y):return event(d,prefix+id,'endEvent',name,x,y)
    event(d,prefix+'Start','startEvent','',60,227)
    n('Basis','userTask',basis,150,205)
    n('Checklist','serviceTask','Сервіс: окремі вимоги / правила / період; не визначає право',400,205)
    n('Send','userTask','Належний заявник / учасник: подати пакет чинним каналом',650,205)
    n('Receipt','receiveTask','Очікувати підтвердження реєстрації / отримання належним органом',900,205)
    n('Decision','userTask','Належний орган: рішення; сервіс лише отримує підтверджений стан',1150,205)
    gate(d,prefix+'Outcome','Який стан?',1400,220)
    n('Fix','userTask','Автор / заявник: доопрацювати; повернення не є відмовою',650,440)
    n('Explain','userTask','Супровід: пояснити причину відмови й чинний шлях оскарження',1600,440,220)
    ev('Denied','Обґрунтована відмова; право на оскарження збережено',2100,462)
    n('Clarify','userTask','Супровід: уточнити невідомий стан; без обіцянки грошей',1150,680)
    n('AwaitStatus','receiveTask','Очікувати відповідь належного джерела',1360,680)
    n('AwaitExecution','receiveTask','Очікувати належне підтвердження виконання за обраним періодом / пакетом',1580,205,220)
    gate(d,prefix+'Enough','Увесь обраний обсяг виконано?',1860,220)
    n('Partial','serviceTask','Зафіксувати частину; решту лишити відкритою',2090,680)
    n('Confirmed','serviceTask','Зафіксувати виконання: джерело + сума / період / час',2090,205)
    ev('End','Підтверджено лише обраний обсяг',2390,227)
    chain(d,[prefix+x for x in ['Start','Basis','Checklist','Send','Receipt','Decision','Outcome']])
    flow(d,prefix+'Returned',prefix+'Outcome',prefix+'Fix','Повернено',condition='status == returned',points=[(1400,245),(1380,245),(1380,340),(740,340),(740,440)],label=(1050,305,120,25))
    flow(d,prefix+'FixLoop',prefix+'Fix',prefix+'Send',points=[(650,480),(620,480),(620,245),(650,245)])
    flow(d,prefix+'Refused',prefix+'Outcome',prefix+'Explain','Відмова',condition='status == denied',points=[(1425,220),(1425,100),(1530,100),(1530,480),(1600,480)],label=(1460,65,120,25))
    chain(d,[prefix+'Explain',prefix+'Denied'])
    flow(d,prefix+'Unknown',prefix+'Outcome',prefix+'Clarify','Невідомо',default=True,points=[(1425,270),(1425,610),(1240,610),(1240,680)],label=(1435,565,120,25))
    chain(d,[prefix+'Clarify',prefix+'AwaitStatus'])
    flow(d,prefix+'StatusLoop',prefix+'AwaitStatus',prefix+'Outcome',points=[(1540,720),(1550,720),(1550,60),(1425,60),(1425,220)])
    flow(d,prefix+'Approved',prefix+'Outcome',prefix+'AwaitExecution','Призначено',condition='status == approved',label=(1460,210,120,25))
    chain(d,[prefix+'AwaitExecution',prefix+'Enough'])
    flow(d,prefix+'AllExecuted',prefix+'Enough',prefix+'Confirmed','Так',condition='execution_evidence_covers_selected_scope')
    flow(d,prefix+'PartExecuted',prefix+'Enough',prefix+'Partial','Ні / частина',default=True,points=[(1885,270),(1885,720),(2090,720)],label=(1900,600,150,25))
    flow(d,prefix+'ExecutionLoop',prefix+'Partial',prefix+'AwaitExecution',points=[(2270,720),(2310,720),(2310,870),(1560,870),(1560,245),(1580,245)])
    chain(d,[prefix+'Confirmed',prefix+'End'])
    note(d,prefix+'Note','Повернення ≠ відмова ≠ призначення ≠ виконання. Немає довіреного джерела виконання → очікування / невідоме, не «гроші отримано». Один прохід — обраний період або пакет; інші не закриваються. F06; ADR 0001, 0003–0004.',80,950,2320,100)
    return d
financial('reward','Sub_Reward','Reward_','Додаткова винагорода • паралельно лікуванню / без загального бар’єра фінальної ВЛК • N06, N21',
          'Уповноважені: підстави винагороди для конкретного періоду; чинні N06 / N21')
ogd=financial('ogd','Sub_OGD','OGD_','ОГД • окрема заява / пакет / орган призначення • N07 • опціональний маршрут',
          'Заявник / належний орган: перевірити застосовність ОГД; ЕКОПФО за потреби — окремо від ВЛК')
# Не кожен кейс породжує ОГД. Відсутність потреби / застосовності — явна людська розвилка.
gate(ogd,'OGD_Applicable','Є підстава / звернення?',350,385)
event(ogd,'OGD_NotApplicable','endEvent','ОГД не запитується / не застосовується; без відмови сервісом',70,427)
# Замінити перший потік Basis -> Checklist через явну розвилку.
old='F_OGD_Basis_OGD_Checklist'
ogd['scope'].remove(next(f for f in flows if f.get('id')==old))
for nid in ['OGD_Basis','OGD_Checklist']:
    for child in list(nodes[nid]['el']):
        if child.text==old:nodes[nid]['el'].remove(child)
ogd['flows']=[f for f in ogd['flows'] if f[0]!=old]
flow(ogd,'OGD_CheckApplicability','OGD_Basis','OGD_Applicable',points=[(240,285),(240,410),(350,410)])
flow(ogd,'OGD_ApplicableYes','OGD_Applicable','OGD_Checklist','Так',condition='authorized_applicability_confirmed',points=[(375,385),(375,245),(400,245)],label=(500,320,60,25))
flow(ogd,'OGD_ApplicableNo','OGD_Applicable','OGD_NotApplicable','Явне ні',condition='not_requested_or_authorized_not_applicable',points=[(350,410),(180,410),(180,445),(106,445)],label=(220,380,100,25))
node(ogd,'OGD_ApplicabilityWait','receiveTask','Застосовність невідома: уточнити / очікувати належну відповідь',360,760,230,80)
flow(ogd,'OGD_ApplicableUnknown','OGD_Applicable','OGD_ApplicabilityWait','Невідомо',default=True,points=[(375,435),(375,760)],label=(390,690,130,25))
flow(ogd,'OGD_ApplicabilityRetry','OGD_ApplicabilityWait','OGD_Applicable',points=[(590,800),(610,800),(610,410),(400,410)])
note(ogd,'OGD_Deadlines','Строк рішення ≠ банківське зарахування. N07 п.23: у воєнний час рішення про призначення — 3 місяці від отримання всіх необхідних документів. Невідомий якір → уточнення. Повні умови — у нормативній матриці.',650,550,420,150)

control=diagram('control',nodes['EventSub_Control']['el'],'Окремий непереривний прохід • нова подія / звірка / звернення • не клінічне рішення',2510,700)
event(control,'Control_Start','startEvent','Погоджений вхід для case_id',70,227,isInterrupting='false')
el(nodes['Control_Start']['el'],'bpmn:messageEventDefinition',id='MessageDef_Control')
node(control,'Control_Validate','serviceTask','Сервер: джерело, scope, мінімізація; перевірити версію / збіг',220,205,220,80)
gate(control,'Control_Trusted','Узгоджено?',520,220)
node(control,'Control_Review','serviceTask','ReviewItem + власник: конфлікт / прогалина; жодної тихої підміни',450,440,220,80)
event(control,'Control_Pending','endEvent','Ручний розгляд лишається відкритим',760,462)
gate(control,'Control_Repeat','Точний повтор?',850,220)
event(control,'Control_Duplicate','endEvent','Без повторного ефекту',857,462)
node(control,'Control_Atomic','serviceTask','Одна транзакція: inbox / стан / задача / аудит / outbox',1100,205,220,80)
node(control,'Control_Project','serviceTask','Рольова проєкція: час / джерело / свіжість / власник; без діагнозу командиру',1400,205,220,80)
gate(control,'Control_NeedsSupport','Звернення?',1700,220)
node(control,'Control_Support','userTask','Призначений супровід: допомога без входу бійця; родині лише дозволене',1640,440,220,80)
node(control,'Control_Aggregate','serviceTask','Лише захищений агрегат BO1–BO6: когорта, покриття, unknown; приховування груп',2020,205,220,80)
event(control,'Control_End','endEvent','Проєкції оновлено',2340,227)
chain(control,['Control_Start','Control_Validate','Control_Trusted'])
flow(control,'Control_Valid','Control_Trusted','Control_Repeat','Так',condition='verified_and_consistent')
flow(control,'Control_Conflict','Control_Trusted','Control_Review','Ні / невідомо',default=True,points=[(545,270),(545,440)],label=(560,340,150,25))
chain(control,['Control_Review','Control_Pending'])
flow(control,'Control_IsRepeat','Control_Repeat','Control_Duplicate','Так',condition='same_id_and_digest',points=[(875,270),(875,462)],label=(890,350,60,25))
flow(control,'Control_New','Control_Repeat','Control_Atomic','Ні',default=True)
chain(control,['Control_Atomic','Control_Project','Control_NeedsSupport'])
flow(control,'Control_NoSupport','Control_NeedsSupport','Control_Aggregate','Ні',default=True)
flow(control,'Control_WithSupport','Control_NeedsSupport','Control_Support','Так',condition='support_requested',points=[(1725,270),(1725,440)],label=(1740,340,60,25))
flow(control,'Control_SupportDone','Control_Support','Control_Aggregate',points=[(1860,480),(1950,480),(1950,245),(2020,245)])
chain(control,['Control_Aggregate','Control_End'])
note(control,'Control_Note','Реальні адаптери й push / poll — тільки після погодження власника. Пізня / виправлена версія не визначається часом отримання; непрозорий source_version не сортуємо. Клінічні body / довільні URL не зберігаємо. Нове отримання кожної виправленої версії — окремий Delivery. Симулятор використовує той самий шлюз (F09).',1030,560,1380,105)

# Collaboration і DI. Кожен внутрішній вузол видно на власній площині.
collab=el(root,'bpmn:collaboration',id='Collaboration_ToBe')
el(collab,'bpmn:participant',id='Participant_ToBe',name='Навчальний наскрізний маршрут • чинні ролі / окремі повноваження',processRef='Process_ToBe')
def shape(plane,id,box,**attrs):
    s=el(plane,'bpmndi:BPMNShape',id='DI_'+id,bpmnElement=id,**attrs)
    x,y,w,h=box;el(s,'dc:Bounds',x=x,y=y,width=w,height=h)
    return s
for d in diagrams:
    dg=el(root,'bpmndi:BPMNDiagram',id='Diagram_'+d['key'],name=d['key'])
    p=el(dg,'bpmndi:BPMNPlane',id='Plane_'+d['key'],bpmnElement='Collaboration_ToBe' if d['main'] else d['scope'].get('id'))
    if d['main']:
        shape(p,'Participant_ToBe',(40,80,2250,1270),isHorizontal='true')
        for key,_,y,h in lane_defs:shape(p,'Lane_'+key,(70,y,2220,h),isHorizontal='true')
    # Заголовок у кожному SVG — анотація, не бізнес-подія.
    d['notes'].append(('Title_'+d['key'],d['title'],(80,0,d['width']-160,60)))
    for n in d['nodes']:
        attrs={}
        if n['type']=='subProcess':attrs['isExpanded']='false'
        if n['type']=='exclusiveGateway':attrs['isMarkerVisible']='true'
        s=shape(p,n['id'],n['box'],**attrs)
        if n['type'] in ['startEvent','intermediateCatchEvent','endEvent','boundaryEvent','exclusiveGateway','eventBasedGateway'] and n['name']:
            x,y,w,h=n['box']
            # Шлюзи: підпис над вузлом, події: під ним.
            lb=(x-65,y-62,180,50) if n['type'] in ['exclusiveGateway','eventBasedGateway'] else (x-70,y+h+10,190,58)
            if n['id']=='Timer_Long':lb=(350,240,170,45)
            if n['id']=='Timer_Certificate':lb=(860,760,180,45)
            if n['id']=='End_Certificate':lb=(1210,740,160,45)
            if n['id']=='End_Joined':lb=(930,440,210,48)
            if n['id']=='Intake_WaitFirst':lb=(20,100,190,40)
            if n['id']=='Control_Duplicate':lb=(930,450,180,40)
            l=el(s,'bpmndi:BPMNLabel');el(l,'dc:Bounds',x=lb[0],y=lb[1],width=lb[2],height=lb[3])
    for id,text,box in d['notes']:
        e=el(d['scope'],'bpmn:textAnnotation',id=id);el(e,'bpmn:text',text)
        shape(p,id,box)
    for id,points,label in d['flows']:
        e=el(p,'bpmndi:BPMNEdge',id='DI_'+id,bpmnElement=id)
        clean=[]
        for point in points:
            if not clean or point!=clean[-1]:clean.append(point)
        for x,y in clean:el(e,'di:waypoint',x=x,y=y)
        if label:
            l=el(e,'bpmndi:BPMNLabel');x,y,w,h=label;el(l,'dc:Bounds',x=x,y=y,width=w,height=h)
E.indent(root,space='  ')
out=Path('docs/bpmn/to-be.bpmn')
out.write_bytes(E.tostring(root,encoding='utf-8',xml_declaration=True))
print(f'{out}: {len(nodes)} вузлів, {len(diagrams)} DI-площин')
