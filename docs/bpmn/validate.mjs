// Перевірка моделі та DI; залежності встановлюються поза репозиторієм.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const modules = process.argv[2];
if (!modules) throw new Error('Використання: node docs/bpmn/validate.mjs /шлях/до/node_modules [файл.bpmn]');
const require = createRequire(resolve(modules, '../package.json'));
const { BpmnModdle } = require('bpmn-moddle');
const moddle = new BpmnModdle();
const xml = await readFile(process.argv[3] || resolve(here, 'as-is.bpmn'), 'utf8');
const parsed = await moddle.fromXML(xml);
assert.equal(parsed.warnings.length, 0, JSON.stringify(parsed.warnings));
const definitions = parsed.rootElement;
const processModel = definitions.rootElements.find(e => e.$type === 'bpmn:Process');
assert(processModel && processModel.isExecutable === false, 'Потрібна невиконувана модель');
const lanes = processModel.laneSets.flatMap(s => s.lanes);
assert.equal(lanes.length, 7, 'Потрібні сім доріжок');
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
const di = definitions.diagrams[0].plane.planeElement;
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
    if (f.$parent === n) continue;
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
const certificateTimer = all.find(e => e.id === 'Timer_Certificate');
assert(certificateTimer.attachedToRef?.id === 'Task_Certificate' && certificateTimer.cancelActivity === false);
const longSub = all.find(e => e.id === 'EventSubProcess_Long');
assert(longSub.triggeredByEvent && !longSub.incoming?.length && !longSub.outgoing?.length);
const longTimer = all.find(e => e.id === 'Timer_Long');
assert(longTimer.$parent === longSub && longTimer.isInterrupting === false);
for (const timer of [certificateTimer, longTimer]) assert(timer.eventDefinitions[0].timeDate.body, `Немає дати ${timer.id}`);
const roundTrip = await moddle.toXML(definitions, { format: true });
const reread = await moddle.fromXML(roundTrip.xml);
assert.equal(reread.warnings.length, 0, 'Попередження після round-trip');
console.log(JSON.stringify({ status:'ok', lanes:lanes.length, nodes:nodes.length, sequenceFlows:flows.length, shapes:shapes.size, edges:edges.size, moddleWarnings:0, roundTripWarnings:0 }, null, 2));
