import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {Store} from './store.js';
import {createApp,type AppOptions} from './app.js';
import {fixtures} from './fixtures.js';
import {signature,type EventEnvelope,type SourceKey} from '../security/core.js';
import {calendarDays,calendarMonths,kyivDate} from './calendar.js';
import {snapshot,cohort,ratio} from './metrics.js';
import {validateEvent} from '../security/protocol.js';
import type {CaseView,SessionView,DemoProfile,AnalyticsView} from '../shared/view.js';
const now=Date.parse('2026-11-13T12:00:00Z');
const fixture=(id:string):EventEnvelope=>structuredClone(fixtures.find(f=>f.id===id)!.event);
async function use(work:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>){const f=await setup();try{await work(f);}finally{f.server.closeAllConnections();await new Promise<void>(r=>f.server.close(()=>r()));f.store.close();}}
async function setup(){
 const store=new Store(':memory:',randomBytes(32)),keys=new Map<string,SourceKey>();
 for(const source of new Set(fixtures.map(f=>f.event.source_system)))keys.set(source,{id:source,source,secret:randomBytes(32),types:new Set(fixtures.map(f=>f.event.event_type)),subjects:new Set(Array.from({length:30},(_,i)=>'demo-person-'+String(i+1).padStart(2,'0')))});
 const options:AppOptions={store,keys,origin:'http://127.0.0.1:0',now:()=>now,readLimit:10000,ingressLimit:10000};
 const server=createApp(options);server.listen(0,'127.0.0.1');await once(server,'listening');const a=server.address();assert(a&&typeof a!=='string');options.origin=`http://127.0.0.1:${a.port}`;
 let cookie='',csrf='';
 const get=(path:string)=>fetch(options.origin+path,{headers:{cookie}});
 const post=(path:string,body:unknown)=>fetch(options.origin+path,{method:'POST',headers:{cookie,origin:options.origin,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body)});
 const capture=async(r:Response)=>{cookie=r.headers.get('set-cookie')!.split(';')[0]!;csrf=(await r.json() as SessionView).csrf;};
 const login=async(profile:DemoProfile)=>{const r=await get('/api/session');if(r.headers.has('set-cookie'))await capture(r);else csrf=(await r.json() as SessionView).csrf;const changed=await post('/api/demo/session',{profile});assert.equal(changed.status,200);await capture(changed);};
 const send=async(value:string|EventEnvelope)=>{const e=typeof value==='string'?fixture(value):value,key=keys.get(e.source_system)!,raw=Buffer.from(JSON.stringify(e)),h={keyId:key.id,timestamp:String(now/1000),nonce:randomBytes(16).toString('hex')};return fetch(options.origin+'/api/integration/events',{method:'POST',headers:{'content-type':'application/json','x-key-id':key.id,'x-timestamp':h.timestamp,'x-nonce':h.nonce,'x-signature':signature(key.secret,h,raw)},body:raw});};
 const accepted=async(value:string|EventEnvelope)=>{const r=await send(value),body=await r.json();assert.equal(r.status,202,JSON.stringify(body));assert.deepEqual(body,{status:'accepted',business_applied:true},typeof value==='string'?value:JSON.stringify(value));};
 const command=async(action:string,case_id='demo-case-01',option?:string,id='demo-'+randomUUID())=>post('/api/commands',{id,case_id,action,...(option?{option}:{})});
 const counts=()=>['wound_case','case_event','task','outbox','document_ref','access_grant'].map(t=>store.row(`SELECT COUNT(*) n FROM ${t}`)?.n);
 return {store,server,keys,get,post,login,send,accepted,command,counts};
}
test('8б: усі fixtures мають строгі схеми; довільний медичний body відхиляється',()=>{
 for(const f of fixtures)assert(validateEvent(f.event),f.id+': '+JSON.stringify(validateEvent.errors));
 const e=fixture('primary');e.payload.diagnosis='SYNTHETIC_FORBIDDEN';assert.equal(validateEvent(e),false);
 const bad=fixture('civil');delete bad.payload.source_channel;assert.equal(validateEvent(bad),false);
});
test('8б D1: повний шлях, винагорода до ВЛК, ОГД та незакритий інший період',async()=>use(async f=>{
 for(const e of ['primary','admit','care-start','transfer','patient-receipt','certificate-prepared'])await f.accepted(e);
 await f.login('commander');assert.equal((await f.command('issue_certificate')).status,200);
 for(const e of ['certificate-issued','certificate-sent','certificate-received','reward-packet','reward-approved','reward-execution_partial','reward-execution_confirmed'])await f.accepted(e);
 assert.equal(f.store.row("SELECT COUNT(*) n FROM case_event WHERE case_id='demo-case-01' AND event_type='vlk.decision_recorded'")?.n,0);
 assert.equal((await f.command('refer_vlk')).status,200);
 for(const e of ['referral','vlk-received','vlk-decision','service-executed','ogd-packet','ogd-returned','ogd-approved-after-returned','ogd-execution_partial','ogd-execution_confirmed','ogd-oct-packet','ogd-oct-approved'])await f.accepted(e);
 const rows=f.store.rows("SELECT payment_kind,period_start,current_status FROM financial_track WHERE case_id='demo-case-01' ORDER BY payment_kind,period_start");
 assert.deepEqual(rows.map(r=>[r.payment_kind,r.period_start,r.current_status]),[['ogd','2026-10-01','approved'],['ogd','2026-11-01','execution_confirmed'],['reward','2026-11-01','execution_confirmed']]);
 const before=f.counts();assert.equal((await f.send('primary')).status,200);assert.deepEqual(f.counts(),before);
 assert.equal(f.store.row("SELECT due_date FROM deadline WHERE case_id='demo-case-01' AND rule_version_id='demo-rule-care'")?.due_date,'2027-02-21');
 await f.login('patient');const view=await (await f.get('/api/patient')).json() as CaseView;assert(view.timeline.some(t=>t.title==='Адміністративну дію виконано'));assert(view.checklist.some(d=>d.route==='ogd'&&d.version==='v1'));assert.equal(view.care,'Умовний заклад 02');
 assert.equal(f.store.row("SELECT COUNT(*) n FROM task WHERE case_id='demo-case-01' AND kind='next_service_action' AND status='open'")?.n,0);
 assert.deepEqual(f.store.rows('PRAGMA foreign_key_check'),[]);
}));
test('8б AC01/07: резерв без входу бійця, пізня еПМК долучається, нових grants немає',async()=>use(async f=>{
 const grants=f.store.row('SELECT COUNT(*) n FROM access_grant')?.n;await f.login('support');assert.equal((await f.command('admin_open','demo-case-02','primary_unavailable')).status,200);
 assert.equal(f.store.row("SELECT source_linked FROM wound_case WHERE id='demo-reserve-case'")?.source_linked,0);
 assert.equal(f.store.row("SELECT injury_date FROM wound_case WHERE id='demo-reserve-case'")?.injury_date,null);
 await f.accepted('reserve-primary');assert.equal(f.store.row('SELECT COUNT(*) n FROM wound_case')?.n,31);assert.equal(f.store.row("SELECT source_linked FROM wound_case WHERE id='demo-reserve-case'")?.source_linked,1);
 assert.equal(f.store.row('SELECT COUNT(*) n FROM access_grant')?.n,grants);
 assert.equal((await f.command('support_request','demo-reserve-case','relative')).status,200);assert.equal((await f.command('resolve_support','demo-reserve-case')).status,200);
 assert.equal(f.store.row('SELECT COUNT(*) n FROM access_grant')?.n,grants);assert.equal((await f.get('/api/guide')).status,200);
}));
test('8б AC01/10: невизначений випадок не зливається; scoped review лише після явної звірки',async()=>use(async f=>{
 const r=await f.send('uncertain');assert.equal((await r.json() as {status:string}).status,'pending_review');
 await f.login('patient');const patient=await (await f.get('/api/patient')).json() as CaseView;assert.equal(patient.reviews?.length,0);
 await f.login('support');const review=String(f.store.row("SELECT id FROM review_item WHERE reason_code='missing_incident'")?.id);
 assert.equal((await f.command('resolve_review','demo-case-02',review)).status,409);assert.equal((await f.command('resolve_review','demo-case-11',review)).status,404);
 assert.equal((await f.command('resolve_review','demo-case-01',review)).status,200);assert.equal(f.store.row("SELECT state FROM review_item WHERE id=?",review)?.state,'resolved');
 assert.equal(f.store.row('SELECT COUNT(*) n FROM wound_case')?.n,30);
}));
test('8б AC04: п’ять календарних днів тільки після підтвердженого отримання; противник / невідоме / ні',async()=>use(async f=>{
 await f.accepted('primary');let v=f.store.caseView('demo-case-01',true);assert.equal(v.deadline.due,null);assert.equal(v.deadline.followUp,'2026-11-14');
 await f.accepted('patient-receipt');v=f.store.caseView('demo-case-01',true);assert.equal(v.deadline.due,'2026-11-15');
 for(const [i,enemy] of [[2,'no'],[3,'unknown']] as const){const e=fixture('primary');e.event_id='demo-enemy-'+i;e.source_stream=e.event_id;e.subject_ref='demo-person-0'+i;e.incident_ref='demo-incident-0'+i;e.payload.enemy_action=enemy;await f.accepted(e);assert.equal(f.store.caseView('demo-case-0'+i,true).deadline.due,null);assert.equal(f.store.caseView('demo-case-0'+i,true).deadline.followUp,null);}
 const wrong=fixture('patient-receipt');wrong.event_id='demo-wrong-person';wrong.source_stream=wrong.event_id;wrong.payload.recipient_ref='demo-person-02';assert.equal((await (await f.send(wrong)).json() as {status:string}).status,'pending_review');
 assert.equal(f.store.row("SELECT patient_received_at FROM wound_case WHERE id='demo-case-02'")?.patient_received_at,null);
}));
test('8б календар: кінець місяця, високосний рік, Europe/Kyiv та DST без 120 діб',()=>{
 assert.equal(calendarMonths('2026-10-31',4),'2027-02-28');assert.equal(calendarMonths('2023-10-31',4),'2024-02-29');assert.equal(calendarDays('2026-10-24',5),'2026-10-29');assert.equal(kyivDate('2026-10-24T22:30:00Z'),'2026-10-25');assert.throws(()=>calendarDays('2026-02-30',5));
});
test('8б AC04: відсутня дата не стає строком; переведення не скидає початок; суперечлива дата на розбір',async()=>use(async f=>{
 await f.accepted('care-unknown');assert.equal(f.store.caseView('demo-case-03',true).careDeadline?.due,null);
 for(const e of ['primary','admit','care-start','transfer','civil','civil-summary','discharge'])await f.accepted(e);
 assert.equal(f.store.caseView('demo-case-01',true).careDeadline?.due,'2027-02-21');assert.equal(f.store.caseView('demo-case-01',true).care,null);
 const e=fixture('care-start');e.event_id='demo-conflicting-anchor';e.source_stream=e.event_id;e.payload.date='2026-11-12';assert.equal((await (await f.send(e)).json() as {status:string}).status,'pending_review');assert.equal(f.store.caseView('demo-case-01',true).careDeadline?.anchor,'2026-10-21');
}));
test('8б AC03/05: підготовка ≠ видача ≠ надсилання ≠ квитанція; нова версія не успадковує отримання',async()=>use(async f=>{
 await f.accepted('primary');await f.accepted('certificate-prepared');
 assert.equal((await (await f.send('certificate-received')).json() as {status:string}).status,'pending_review');
 await f.login('commander');assert.equal((await f.command('issue_certificate')).status,200);await f.accepted('certificate-issued');await f.accepted('certificate-sent');
 assert(f.store.caseView('demo-case-01',true).checklist.some(d=>d.title.startsWith('довідка')&&d.delivery.startsWith('Надіслано')));
 const receipt=fixture('certificate-received');receipt.event_id='demo-later-receipt';receipt.source_stream=receipt.event_id;await f.accepted(receipt);
 await f.accepted('certificate-corrected');let docs=f.store.caseView('demo-case-01',true).checklist.filter(d=>d.title.startsWith('довідка'));assert(docs.every(d=>d.version==='v2'&&d.delivery==='Отримання не підтверджене'));
 await f.accepted('certificate-withdrawn');docs=f.store.caseView('demo-case-01',true).checklist.filter(d=>d.title.startsWith('довідка'));assert(docs.every(d=>d.state==='Бракує'));
}));
test('8б AC03: галерея лише фіксована; помилковий зразок, копія та оригінал розділені',async()=>use(async f=>{
 await f.login('patient');assert.equal((await f.command('copy','demo-case-01','arbitrary')).status,400);assert.equal((await f.command('copy','demo-case-01','wrong_kind')).status,200);
 assert(f.store.caseView('demo-case-01',true).checklist.some(d=>d.state.startsWith('Помилка')));
 assert.equal((await f.command('copy','demo-case-01','trauma_certificate')).status,200);assert(f.store.caseView('demo-case-01',true).checklist.some(d=>d.state==='Копія очікує перевірки'));
 await f.login('support');assert.equal((await f.command('verify_copy')).status,200);assert(f.store.caseView('demo-case-01',true).checklist.some(d=>d.state==='Копію технічно звірено'&&d.provenance.includes('не джерельний')));
}));
test('8б AC05/10: ролі дій, неповний пакет не блокує направлення, поточний scope і відкликання перед повтором',async()=>use(async f=>{
 await f.login('support');assert.equal((await f.command('issue_certificate')).status,403);assert.equal((await f.command('refer_vlk')).status,403);
 await f.login('commander');const id='demo-retry-command';assert.equal((await f.command('refer_vlk','demo-case-01',undefined,id)).status,200);const before=f.counts();assert.equal((await f.command('refer_vlk','demo-case-01',undefined,id)).status,200);assert.deepEqual(f.counts(),before);
 await f.accepted('referral');assert.equal(f.store.row("SELECT COUNT(*) n FROM case_event WHERE event_type='vlk.decision_recorded'")?.n,0);
 f.store.run("UPDATE unit_assignment SET valid_to='2026-11-12T12:00:00Z' WHERE id='demo-assignment-01'");assert.equal((await f.command('refer_vlk','demo-case-01',undefined,id)).status,404);
 f.store.run("UPDATE access_grant SET revoked_at='2026-11-13T00:00:00Z' WHERE id='demo-grant-commander'");assert.equal((await f.command('refer_vlk','demo-case-02')).status,401);
}));
test('8б AC06: повернення, відмова, схвалення, часткове й повне виконання не зливаються',async()=>use(async f=>{
 for(const e of ['ogd-packet','ogd-returned','ogd-denied','ogd-approved-after-denied','ogd-execution_partial'])await f.accepted(e);
 const view=()=>f.store.caseView('demo-case-01',true).finances.find(x=>x.kind==='ogd')!;assert.equal(view().status,'execution_partial');assert(view().execution?.includes('доказ'));
 await f.accepted('ogd-unknown');assert.equal(view().status,'execution_partial');assert.equal(f.store.caseView('demo-case-01',true).freshnessState,'stale');await f.accepted('ogd-execution_confirmed');assert.equal(view().status,'execution_confirmed');
 const bad=fixture('reward-approved');bad.payload.packet_ref='demo-ogd-packet-01';assert.equal((await (await f.send(bad)).json() as {status:string}).status,'pending_review');
}));
test('8б AC06: фінансові перестановки та виконання без рішення не перезаписують підтвердження',async()=>use(async f=>{
 await f.accepted('reward-packet');const no=await f.send('reward-execution_partial');assert.equal((await no.json() as {status:string}).status,'pending_review');await f.accepted('reward-approved');
 const wrong=fixture('reward-denied');wrong.event_id='demo-wrong-predecessor';assert.equal((await (await f.send(wrong)).json() as {status:string}).status,'pending_review');assert.equal(f.store.caseView('demo-case-01',true).finances.find(x=>x.kind==='reward')?.status,'approved');
}));
test('8б AC09: прогалина зберігає підтвердження; чужий сигнал її не закриває, потрібний відновлює',async()=>use(async f=>{
 await f.accepted('primary');await f.accepted('gap');assert.equal(f.store.caseView('demo-case-01',true).freshnessState,'stale');await f.accepted('care-start');assert.equal(f.store.caseView('demo-case-01',true).freshnessState,'stale');await f.accepted('gap-recovered');assert.equal(f.store.caseView('demo-case-01',true).freshnessState,'fresh');
 await f.login('dev');const result=await f.post('/api/demo/events',{fixture:'primary',mode:'conflict'});assert.equal(result.status,409);assert.equal(f.store.caseView('demo-case-01',true).freshnessState,'conflict');
}));
test('8б AC09: dev дійсно проходить HMAC/schema/source policy; інших ролей та довільного JSON немає',async()=>use(async f=>{
 await f.login('support');assert.equal((await f.post('/api/demo/events',{fixture:'primary'})).status,403);await f.login('dev');assert.equal((await f.post('/api/demo/events',{fixture:'primary',payload:{}})).status,400);assert.equal((await f.post('/api/demo/events',{fixture:'primary'})).status,202);
 const bad=fixture('certificate-issued');bad.source_system='demo-mis';assert.equal((await f.send(bad)).status,403);
}));
test('8б AC10: audit failure відкочує команду та всі доменні зміни',async()=>use(async f=>{
 await f.login('support');const before=f.counts();f.store.db.exec("CREATE TRIGGER reject_command BEFORE INSERT ON audit_entry WHEN NEW.action_code='command' AND NEW.result_code='allowed' BEGIN SELECT RAISE(ABORT,'demo_failure'); END;");assert.equal((await f.command('admin_open','demo-case-02','primary_unavailable')).status,503);assert.deepEqual(f.counts(),before);assert.equal(f.store.row('SELECT COUNT(*) n FROM demo_command')?.n,0);
}));
test('8б AC08: BO розрахунки з відомими знаменниками, невідомим, порогом та порожнім знаменником',()=>{
 const m=snapshot().metrics;assert.equal(m.find(m=>m.id==='BO-1')?.value,'14 днів');assert.equal(m.find(m=>m.id==='BO-2')?.value,'ВЛК 40% · ОГД 25%');assert.equal(m.find(m=>m.id==='BO-3')?.value,'5/20');assert.equal(m.find(m=>m.id==='BO-5')?.value,'44.4%');assert.equal(m.find(m=>m.id==='BO-6')?.value,'6 кейсів/FTE · 10 хв/кейс');
 assert.equal(ratio(1,0),null);assert(snapshot([]).metrics.filter(m=>m.id!=='BO-4').every(m=>m.state==='insufficient'&&m.value==='Недостатньо даних'));
 assert(snapshot(cohort.slice(0,3)).metrics.filter(m=>m.id!=='BO-4').every(m=>m.state==='suppressed'&&m.value==='Приховано'&&!/\d/.test(m.coverage??'')));
 assert.equal(snapshot(cohort,null).metrics.find(m=>m.id==='BO-6')?.state,'insufficient');
 const small=cohort.map((r,i)=>({...r,vlkReturned:i<4}));assert.equal(snapshot(small).metrics.find(m=>m.id==='BO-2')?.state,'suppressed');
});
test('8б AC08/10: фіксований snapshot не рухається від D1; аналітик без рядків / фільтрів',async()=>use(async f=>{
 await f.login('analyst');const before=await (await f.get('/api/analytics')).json();await f.accepted('primary');assert.deepEqual(await (await f.get('/api/analytics')).json(),before);assert.equal((await f.get('/api/cases/demo-case-01')).status,403);assert.equal((await f.get('/api/analytics?unit=demo-unit-1')).status,400);
 await f.login('dev');assert.equal((await f.post('/api/demo/analytics',{snapshot:'demo-small'})).status,200);await f.login('analyst');const small=await (await f.get('/api/analytics')).json() as AnalyticsView;assert(small.metrics.filter(m=>m.id!=='BO-4').every(m=>m.value==='Приховано'));
 assert.throws(()=>f.store.run("UPDATE analytics_snapshot SET payload='{}'"),/immutable_snapshot/);
}));

test('8б календарний worker: лише задача людині, повтор без дубля, стан виплат та служби незмінний',async()=>use(async f=>{
 for(const id of ['primary','patient-receipt','care-start'])await f.accepted(id);
 const before=f.store.rows("SELECT payment_kind,current_status FROM financial_track WHERE case_id='demo-case-01'");const state=f.store.row("SELECT lifecycle_state FROM wound_case WHERE id='demo-case-01'")?.lifecycle_state;
 f.store.refreshDeadlines(Date.parse('2027-03-01T12:00:00Z'));const count=f.store.row("SELECT COUNT(*) n FROM task WHERE kind='review_deadline'")?.n;assert(Number(count)>0);f.store.refreshDeadlines(Date.parse('2027-03-01T12:00:00Z'));assert.equal(f.store.row("SELECT COUNT(*) n FROM task WHERE kind='review_deadline'")?.n,count);
 assert.deepEqual(f.store.rows("SELECT payment_kind,current_status FROM financial_track WHERE case_id='demo-case-01'"),before);assert.equal(f.store.row("SELECT lifecycle_state FROM wound_case WHERE id='demo-case-01'")?.lifecycle_state,state);
}));

test('8б AC04: за відсутньої еПМК строк може початися від отримання довідки про перебування',async()=>use(async f=>{
 await f.login('support');assert.equal((await f.command('admin_open','demo-case-02','primary_unavailable')).status,200);await f.accepted('reserve-hospital');assert.equal(f.store.caseView('demo-reserve-case',false).deadline.due,null);await f.accepted('reserve-hospital-receipt');assert.equal(f.store.caseView('demo-reserve-case',false).deadline.due,'2026-11-18');assert.equal(f.store.row("SELECT source_linked FROM wound_case WHERE id='demo-reserve-case'")?.source_linked,0);
}));

test('8б AC05: повернений пакет уточнюється новою ревізією; зауваження не стає виконаною службовою дією',async()=>use(async f=>{
 for(const id of ['vlk-received','vlk-returned'])await f.accepted(id);assert.equal(f.store.row("SELECT state FROM route_packet WHERE case_id='demo-case-01' AND route='vlk'")?.state,'returned');await f.accepted('vlk-resubmitted');assert.equal(f.store.row("SELECT revision FROM route_packet WHERE case_id='demo-case-01' AND route='vlk'")?.revision,'v2');
 const e=fixture('vlk-decision');e.payload.service_code='clarification_needed';await f.accepted(e);assert.equal((await (await f.send('service-executed')).json() as {status:string}).status,'pending_review');
}));
