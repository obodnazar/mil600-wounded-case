// Перевірка моделі та DI; залежності встановлюються поза репозиторієм.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const modules = process.argv[2];
if (!modules) throw new Error('Використання: node docs/bpmn/validate-to-be.mjs /шлях/до/node_modules [файл.bpmn]');
const require = createRequire(resolve(modules, '../package.json'));
const { BpmnModdle } = require('bpmn-moddle');
const moddle = new BpmnModdle();
const xml = await readFile(process.argv[3] || resolve(here, 'to-be.bpmn'), 'utf8');
const parsed = await moddle.fromXML(xml);
assert.equal(parsed.warnings.length, 0, JSON.stringify(parsed.warnings));
const definitions = parsed.rootElement;
const processModel = definitions.rootElements.find(e => e.$type === 'bpmn:Process');
assert(processModel && processModel.isExecutable === false, 'Потрібна невиконувана модель');
const lanes = processModel.laneSets.flatMap(s => s.lanes);
assert.equal(lanes.length, 5, 'Потрібні п’ять доріжок огляду');
const all = [];
function visit(scope) {
  for (const e of scope.flowElements || []) {
    all.push(e);
    if (e.$type === 'bpmn:SubProcess') visit(e);
  }
}
visit(processModel);
const ids = new Set();
for (const e of all) {
  assert(!ids.has(e.id), `Дубль ID ${e.id}`); ids.add(e.id);
}
const nodes = all.filter(e => e.$instanceOf('bpmn:FlowNode'));
const flows = all.filter(e => e.$type === 'bpmn:SequenceFlow');
assert.equal(definitions.diagrams.length, 8, 'Огляд + сім деталізацій');
const di = definitions.diagrams.flatMap(d => d.plane.planeElement);
const planeByElement = new Map(definitions.diagrams.flatMap(d => d.plane.planeElement.map(e => [e.bpmnElement.id, d.plane])));
const shapes = new Map(di.filter(e => e.$type === 'bpmndi:BPMNShape').map(e => [e.bpmnElement.id, e]));
const edges = new Map(di.filter(e => e.$type === 'bpmndi:BPMNEdge').map(e => [e.bpmnElement.id, e]));
for (const n of nodes) {
  assert(shapes.has(n.id), `Немає DI вузла ${n.id}`);
  if (n.$parent === processModel) {
    assert.equal(lanes.filter(l => l.flowNodeRef?.includes(n)).length, 1, `Доріжка ${n.id}`);
  }
  if (n.$type === 'bpmn:ExclusiveGateway' && n.outgoing.length > 1) {
    assert(n.default, `Немає default ${n.id}`);
    for (const f of n.outgoing) {
      assert(f.name, `Гілка без підпису ${f.id}`);
      if (f !== n.default) assert(f.conditionExpression?.body, `Немає умови ${f.id}`);
    }
  }
}
for (const f of flows) {
  assert(f.sourceRef && f.targetRef, `Нерозв’язане посилання ${f.id}`);
  assert.equal(f.sourceRef.$parent, f.targetRef.$parent, `Потік перетинає межу підпроцесу ${f.id}`);
  assert(f.sourceRef.outgoing.includes(f) && f.targetRef.incoming.includes(f), `incoming/outgoing ${f.id}`);
  const edge = edges.get(f.id);
  assert(edge?.waypoint.length >= 2, `Немає DI потоку ${f.id}`);
  const p = edge.waypoint;
  for (let i = 1; i < p.length; i++) {
    assert(p[i-1].x === p[i].x || p[i-1].y === p[i].y, `Неортогональний сегмент ${f.id}`);
  }
  // Довгі зворотні стрілки не повинні проходити крізь сторонні вузли.
  for (const n of nodes) {
    if ([f.sourceRef, f.targetRef].includes(n)) continue;
    // Контейнер власного подієвого підпроцесу оточує дочірні потоки.
    if (f.$parent === n || planeByElement.get(f.id) !== planeByElement.get(n.id)) continue;
    const b = shapes.get(n.id).bounds;
    const margin = 2;
    for (let i = 1; i < p.length; i++) {
      const a = p[i-1], z = p[i];
      const intersects = a.x === z.x
        ? a.x > b.x+margin && a.x < b.x+b.width-margin && Math.max(a.y,z.y) > b.y+margin && Math.min(a.y,z.y) < b.y+b.height-margin
        : a.y > b.y+margin && a.y < b.y+b.height-margin && Math.max(a.x,z.x) > b.x+margin && Math.min(a.x,z.x) < b.x+b.width-margin;
      assert(!intersects, `${f.id} проходить крізь ${n.id}`);
    }
  }
}
function checkScope(scope) {
  const own = scope.flowElements || [];
  const flowNodes = own.filter(e => e.$instanceOf('bpmn:FlowNode'));
  if (!flowNodes.length) return; // Згорнуті підпроцеси свідомо не деталізовано.
  const starts = flowNodes.filter(e => ['bpmn:StartEvent','bpmn:BoundaryEvent'].includes(e.$type));
  const seen = new Set();
  function walk(n) {
    if (seen.has(n)) return; seen.add(n);
    for (const f of n.outgoing || []) walk(f.targetRef);
  }
  starts.forEach(walk);
  for (const n of flowNodes.filter(e => !e.triggeredByEvent)) assert(seen.has(n), `Недосяжний вузол ${n.id}`);
  const ends = flowNodes.filter(e => e.$type === 'bpmn:EndEvent');
  const canEnd = new Set();
  function back(n) { if (canEnd.has(n)) return; canEnd.add(n); for (const f of n.incoming || []) back(f.sourceRef); }
  ends.forEach(back);
  for (const n of flowNodes.filter(e => !e.triggeredByEvent)) assert(canEnd.has(n), `Немає шляху до кінця ${n.id}`);
  for (const sub of own.filter(e => e.$type === 'bpmn:SubProcess')) checkScope(sub);
}
checkScope(processModel);
// Ключові інваріанти затвердженого маршруту; це не рушій BPMN.
const byId = Object.fromEntries(all.map(e => [e.id,e]));
for (const [timer,activity] of [['Timer_Certificate','Sub_Certificate'],['Timer_Long','Sub_Care']]) {
  const t=byId[timer];
  assert(t.attachedToRef?.id===activity && t.cancelActivity===false);
  assert(t.eventDefinitions[0].timeDate.body);
}
assert(byId.EventSub_Control.triggeredByEvent);
assert(!byId.EventSub_Control.incoming?.length && !byId.EventSub_Control.outgoing?.length);
assert.equal(byId.Control_Start.isInterrupting,false);
assert.equal(byId.Control_Start.eventDefinitions[0].$type,'bpmn:MessageEventDefinition');
assert.equal(byId.Gateway_NewCase.default.targetRef.id,'End_Joined','Повтор не запускає задачі повторно');
assert.equal(byId.Intake_AwaitProof.$type,'bpmn:ReceiveTask','Невизначений збіг очікує уточнення');
function reachable(from,to,excluded=[]) {
  const seen=new Set(excluded);
  function walk(n) {
    if(seen.has(n.id)) return false;
    if(n.id===to) return true;
    seen.add(n.id);
    return (n.outgoing||[]).some(f=>walk(f.targetRef));
  }
  return walk(byId[from]);
}
assert(!reachable('Intake_Med','Intake_End',['Intake_EnsureCase']));
assert(!reachable('Intake_Admin','Intake_End',['Intake_EnsureCase']));
assert(!reachable('VLK_Start','VLK_Checklist',['VLK_Referral']),'Чекліст не передує направленню');
assert.equal(byId.VLK_CreateTask.$type,'bpmn:ServiceTask','Створення задачі, а не блокування направлення');
assert.equal(byId.VLK_Exam.$type,'bpmn:UserTask','Клініка залишається людині');
assert(byId.Fork_Admin.outgoing.some(f=>f.targetRef.id==='Sub_Reward'));
assert(!reachable('Sub_Reward','Sub_VLK'),'Винагорода не очікує фінальної ВЛК');
for (const route of ['Reward_','OGD_']) {
  assert.equal(byId[route+'Outcome'].default.targetRef.id,route+'Clarify');
  assert.equal(byId[route+'AwaitExecution'].$type,'bpmn:ReceiveTask');
  assert(!reachable(route+'Start',route+'Confirmed',[route+'AwaitExecution']),'Без доказу виконання немає підтвердження');
  assert.equal(byId[route+'Enough'].default.targetRef.id,route+'Partial');
}
assert.equal(byId.Control_Repeat.outgoing.find(f=>f.name==='Так').targetRef.id,'Control_Duplicate');
assert.equal(byId.OGD_Applicable.default.targetRef.id,'OGD_ApplicabilityWait','Невідома застосовність не є відмовою / відсутністю права');
assert.equal(byId.Intake_WaitFirst.$type,'bpmn:EventBasedGateway');
for (const id of ['Intake_Med','Intake_Admin']) {
  assert.equal(byId[id].$type,'bpmn:IntermediateCatchEvent');
  assert.equal(byId[id].incoming[0].sourceRef.id,'Intake_WaitFirst');
}
for (const n of nodes.filter(n=>n.$type==='bpmn:StartEvent' && n.$parent.$type==='bpmn:SubProcess' && !n.$parent.triggeredByEvent)) {
  assert(!n.eventDefinitions?.length,`Звичайний вкладений subprocess має none-start: ${n.id}`);
}
const roundTrip = await moddle.toXML(definitions, { format: true });
const reread = await moddle.fromXML(roundTrip.xml);
assert.equal(reread.warnings.length, 0, 'Попередження після round-trip');
console.log(JSON.stringify({ status:'ok', diagrams:definitions.diagrams.length, lanes:lanes.length, nodes:nodes.length, sequenceFlows:flows.length, shapes:shapes.size, edges:edges.size, moddleWarnings:0, roundTripWarnings:0 }, null, 2));
