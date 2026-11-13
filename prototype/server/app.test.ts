import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {get as httpGet} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {Store} from './store.js';
import {createApp,primaryFixture,type AppOptions} from './app.js';
import {signature,type EventEnvelope,type SourceKey} from '../security/core.js';
import type {DemoProfile,SessionView} from '../shared/view.js';

const at=Date.parse('2026-11-13T12:00:00.000Z');
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'mil600-8a-')),path=join(dir,'demo.sqlite'),auditKey=randomBytes(32);
  const source:SourceKey={id:'demo-mis',source:'demo-mis',secret:randomBytes(32),types:new Set(['medical.primary_recorded','care.admitted']),subjects:new Set(['demo-person-01'])};
  const store=new Store(path,auditKey),options:AppOptions={store,keys:new Map([[source.id,source]]),origin:'http://127.0.0.1:0',now:()=>at,readLimit:1000,ingressLimit:1000};
  const server=createApp(options);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert(address&&typeof address!=='string');options.origin=`http://127.0.0.1:${address.port}`;
  let cookie='',csrf='';
  const capture=async(r:Response)=>{const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0]??'';return r;};
  const get=(path:string,extra:Record<string,string>={})=>fetch(options.origin+path,{headers:{cookie,...extra}});
  const post=(path:string,body:unknown,extra:Record<string,string>={})=>fetch(options.origin+path,{method:'POST',headers:{cookie,origin:options.origin,'content-type':'application/json','x-csrf-token':csrf,...extra},body:JSON.stringify(body)});
  const login=async(profile:DemoProfile)=>{const bootstrap=await capture(await get('/api/session'));csrf=(await bootstrap.json() as SessionView).csrf;const r=await capture(await post('/api/demo/session',{profile}));assert.equal(r.status,200);csrf=(await r.json() as SessionView).csrf;};
  const send=(event:EventEnvelope=primaryFixture(),nonce=randomBytes(16).toString('hex'))=>{
    const raw=Buffer.from(JSON.stringify(event)),h={keyId:source.id,timestamp:String(at/1000),nonce};
    return fetch(options.origin+'/api/integration/events',{method:'POST',headers:{'content-type':'application/json','x-key-id':h.keyId,'x-timestamp':h.timestamp,'x-nonce':nonce,'x-signature':signature(source.secret,h,raw)},body:raw});
  };
  const close=async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();await rm(dir,{recursive:true,force:true});};
  return {dir,path,auditKey,store,source,server,options,get,post,login,send,close,get cookie(){return cookie;},get csrf(){return csrf;}};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function use(work:(f:Fixture)=>Promise<void>){const f=await fixture();try{await work(f);}finally{await f.close();}}
test('8а: migration/seed is repeatable; 30 cases, 3 units, 9 providers; database private',async()=>use(async f=>{
  const again=new Store(f.path,f.auditKey);assert.equal(again.row('SELECT COUNT(*) AS n FROM wound_case')?.n,30);again.close();
  assert.equal(f.store.row('SELECT COUNT(*) AS n FROM demo_unit')?.n,3);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM demo_provider')?.n,9);
  assert.equal((await stat(f.path)).mode&0o777,0o600);assert.deepEqual(f.store.rows('PRAGMA foreign_key_check'),[]);
  assert.equal(f.store.row("SELECT COUNT(*) AS n FROM deadline WHERE anchor_status!='confirmed' AND due_date IS NOT NULL")?.n,0);
  assert.equal(f.store.row("SELECT COUNT(DISTINCT c.lifecycle_state) AS n FROM wound_case c JOIN unit_assignment u ON u.subject_id=c.subject_id WHERE u.unit_ref='demo-unit-1'")?.n,6);
  assert.equal(f.store.row("SELECT COUNT(*) AS n FROM deadline d JOIN case_event a ON a.id=d.anchor_event_id JOIN case_event p ON p.case_id=d.case_id AND p.event_type='medical.primary_recorded' WHERE d.anchor_status='confirmed' AND a.occurred_at<p.recorded_at")?.n,0);
}));
test('8а HTTP: unauthenticated, foreign scope, per-request revoked grant, patient own document',async()=>use(async f=>{
  assert.equal((await f.get('/api/patient')).status,401);await f.login('patient');
  assert.equal((await f.get('/api/cases/demo-case-02')).status,404);assert.equal((await f.get('/api/cases/demo-case-01/clinical-document')).status,200);
  f.store.run("UPDATE access_grant SET revoked_at='2026-11-13T00:00:00.000Z' WHERE id='demo-grant-patient'");assert.equal((await f.get('/api/patient')).status,401);
}));
test('8а HTTP: commander/support DTO contains no clinical refs, facility or financial projections',async()=>use(async f=>{
  for(const profile of ['commander','support'] as const){await f.login(profile);assert.equal((await f.get('/api/cases/demo-case-01/clinical-document')).status,403);
    const r=await f.get('/api/staff');assert.equal(r.status,200);const body=await r.json() as {cases:Record<string,unknown>[]};assert.equal(body.cases.length,10);
    assert(body.cases.every(c=>c.care===null&&Array.isArray(c.timeline)&&!c.timeline.length&&Array.isArray(c.checklist)&&!c.checklist.length&&Array.isArray(c.finances)&&!c.finances.length));
    assert(!JSON.stringify(body).includes('demo-record-'));assert(!JSON.stringify(body).includes('demo-provider-'));
    assert.equal((await f.get('/api/cases/demo-case-11')).status,404);
  }
}));
test('8а HTTP: profile rotation invalidates old token; CSRF/Origin/Host/method/query enforce boundaries',async()=>use(async f=>{
  await f.login('patient');const old=f.cookie,token=f.csrf;
  assert.equal((await f.post('/api/demo/session',{profile:'dev'},{'x-csrf-token':'0'.repeat(64)})).status,403);
  assert.equal((await f.post('/api/demo/session',{profile:'dev'},{origin:'https://example.invalid'})).status,403);
  const wrongHost=await new Promise<number>(resolve=>{httpGet(f.options.origin+'/api/patient',{headers:{host:'example.invalid',cookie:f.cookie}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode??0));});});assert.equal(wrongHost,403);
  assert.equal((await f.get('/api/patient?role=dev')).status,400);
  assert.equal((await f.post('/api/demo/session',{profile:'dev',actor:'demo-dev'})).status,400);
  await f.login('dev');assert.notEqual(f.cookie,old);assert.notEqual(f.csrf,token);assert.equal((await f.get('/api/dev',{cookie:old})).status,401);
  assert.equal((await f.get('/api/patient')).status,403);assert.equal((await f.get('/api/analytics')).status,403);
}));
test('8а HTTP: integration uses signature/schema before durable commit; nonce and both dedupe keys survive restart',async()=>use(async f=>{
  const nonce=randomBytes(16).toString('hex');const first=await f.send(primaryFixture(),nonce);assert.equal(first.status,202);assert.deepEqual(await first.json(),{status:'accepted',business_applied:true});
  const s=new Store(f.path,f.auditKey),count=s.row('SELECT COUNT(*) AS n FROM case_event')?.n;
  // Новий Store та новий Ingress у другому сервері: жодного спільного memory-ledger.
  const opts:AppOptions={...f.options,store:s,origin:'http://127.0.0.1:0'},second=createApp(opts);second.listen(0,'127.0.0.1');await once(second,'listening');const addr=second.address();assert(addr&&typeof addr!=='string');opts.origin=`http://127.0.0.1:${addr.port}`;
  try {
    const event={...primaryFixture(),event_id:'demo-new-id-same-revision'},raw=Buffer.from(JSON.stringify(event)),h={keyId:f.source.id,timestamp:String(at/1000),nonce:randomBytes(16).toString('hex')};
    const request=(body:Buffer,meta:typeof h)=>fetch(opts.origin+'/api/integration/events',{method:'POST',headers:{'content-type':'application/json','x-key-id':meta.keyId,'x-timestamp':meta.timestamp,'x-nonce':meta.nonce,'x-signature':signature(f.source.secret,meta,body)},body:body.toString('utf8')});
    const duplicate=await request(raw,h);assert.equal(duplicate.status,200);assert.equal((await duplicate.json() as {status:string}).status,'duplicate');
    assert.equal((await request(Buffer.from(JSON.stringify(primaryFixture())),{...h,nonce})).status,409);
    assert.equal(s.row('SELECT COUNT(*) AS n FROM case_event')?.n,count);assert.equal(s.row('SELECT COUNT(*) AS n FROM outbox')?.n,1);
  }finally{second.closeAllConnections();await new Promise<void>(resolve=>second.close(()=>resolve()));s.close();}
}));
test('8а HTTP: conflict creates review, no overwrite; opaque version cannot silently reorder',async()=>use(async f=>{
  assert.equal((await f.send()).status,202);const count=f.store.row('SELECT COUNT(*) AS n FROM case_event')?.n;
  const conflict=await f.send({...primaryFixture(),payload:{document_kind:'primary_medical_card',document_version:'v2'}});assert.equal(conflict.status,409);
  const later=await f.send({...primaryFixture(),event_id:'demo-later',source_version:'v0'});assert.equal(later.status,202);assert.equal((await later.json() as {status:string}).status,'pending_review');
  assert.equal(f.store.row('SELECT COUNT(*) AS n FROM case_event')?.n,count);assert.equal(f.store.row("SELECT COUNT(*) AS n FROM review_item WHERE reason_code='event_conflict'")?.n,1);
}));
test('8а: audit write failure rolls back inbox, domain, task and outbox; retry with new nonce succeeds',async()=>use(async f=>{
  const before=f.store.row('SELECT COUNT(*) AS n FROM case_event')?.n;
  f.store.db.exec("CREATE TRIGGER reject_accept BEFORE INSERT ON audit_entry WHEN NEW.result_code='accepted' BEGIN SELECT RAISE(ABORT,'synthetic_audit_failure'); END;");
  assert.equal((await f.send()).status,503);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM inbox_event')?.n,0);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM case_event')?.n,before);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM outbox')?.n,0);
  f.store.db.exec('DROP TRIGGER reject_accept');assert.equal((await f.send()).status,202);
  f.store.dispatchLocalOutbox();assert.equal(f.store.row('SELECT state FROM outbox')?.state,'delivered_local');f.store.dispatchLocalOutbox();assert.equal(f.store.row('SELECT attempt_count FROM outbox')?.attempt_count,1);
}));
test('8а HTTP: fixed dev fixture goes through same gateway; no arbitrary payload or grants',async()=>use(async f=>{
  await f.login('commander');assert.equal((await f.post('/api/demo/primary',{})).status,403);
  await f.login('dev');assert.equal((await f.post('/api/demo/primary',{subject_ref:'demo-person-02'})).status,400);
  const grants=f.store.row('SELECT COUNT(*) AS n FROM access_grant')?.n;
  assert.equal((await f.post('/api/demo/primary',{})).status,202);assert.equal((await f.post('/api/demo/primary',{})).status,200);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM inbox_event')?.n,1);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM access_grant')?.n,grants);
}));
test('8а HTTP: strict envelope/subject/source HMAC bounds and fixed analytics without rows/numbers',async()=>use(async f=>{
  assert.equal((await f.send({...primaryFixture(),payload:{...primaryFixture().payload,diagnosis:'TEST_PRIVATE_SENTINEL'}})).status,400);
  assert.equal((await f.send({...primaryFixture(),subject_ref:'demo-person-02'})).status,403);
  assert.equal((await f.send({...primaryFixture(),source_system:'demo-finance'})).status,403);
  await f.login('analyst');const r=await f.get('/api/analytics');assert.equal(r.status,200);const report=await r.json() as {metrics:unknown[]};assert.equal(report.metrics.length,6);assert(!JSON.stringify(report).includes('demo-person-'));assert(!('total'in report));
  assert.equal((await f.get('/api/analytics?unit=demo-unit-1')).status,400);assert.equal((await f.get('/api/cases/demo-case-01')).status,403);
}));
test('8а DB: cross-case evidence, unconfirmed due date, unpaid execution, mutation of audit/packet blocked',async()=>use(async f=>{
  assert.throws(()=>f.store.run("INSERT INTO requirement_evidence VALUES ('demo-bad','demo-case-01','demo-req-primary_medical_card-01','demo-doc-primary_medical_card-02','technical_match','demo-proof')"));
  assert.throws(()=>f.store.run("UPDATE deadline SET due_date='2026-11-15' WHERE id='demo-deadline-01'"));
  assert.throws(()=>f.store.run("UPDATE deadline SET anchor_event_id='demo-receipt-anchor-02' WHERE id='demo-deadline-01'"));
  assert.throws(()=>f.store.run("UPDATE task SET deadline_id='demo-deadline-02' WHERE id='demo-task-01'"));
  assert.throws(()=>f.store.run("UPDATE financial_track SET current_status='executed' WHERE id='demo-finance-ogd-01'"));
  f.store.audit('case_read','allowed','demo-actor','demo-case',at);assert.throws(()=>f.store.run("UPDATE audit_entry SET result_code='allowed'"));assert.throws(()=>f.store.run('DELETE FROM audit_entry'));
  assert.throws(()=>f.store.run("UPDATE case_requirement SET packet_revision='v2' WHERE id='demo-req-primary_medical_card-01'"));
}));
test('8а DB: verified identity/assignment overlap rejected; distinct incidents for same person allowed',async()=>use(async f=>{
  assert.throws(()=>f.store.run("INSERT INTO identity_link VALUES ('demo-bad','demo-person-02','demo-mis','demo-person-01','verified','demo-proof','2026-11-01',NULL)"));
  assert.throws(()=>f.store.run("INSERT INTO unit_assignment VALUES ('demo-bad','demo-person-01','demo-unit-2','2026-11-01',NULL,'demo-proof','verified')"));
  f.store.run("INSERT INTO identity_link VALUES ('demo-pending','demo-person-02','demo-mis','demo-person-01','pending','demo-proof','2026-11-01',NULL)");assert.throws(()=>f.store.run("UPDATE identity_link SET verification_state='verified' WHERE id='demo-pending'"));
  f.store.run("INSERT INTO unit_assignment VALUES ('demo-pending-assignment','demo-person-01','demo-unit-2','2026-11-01',NULL,'demo-proof','pending')");assert.throws(()=>f.store.run("UPDATE unit_assignment SET verification_state='verified' WHERE id='demo-pending-assignment'"));
  f.store.run("INSERT INTO wound_case VALUES ('demo-new','demo-person-01','demo-mis','demo-another-incident','administrative_request',NULL,'unknown','administrative_open',1)");assert.equal(f.store.row("SELECT COUNT(*) AS n FROM wound_case WHERE subject_id='demo-person-01'")?.n,2);
}));
test('8а: foreign database is refused before any schema/data mutation',async()=>use(async f=>{
  const path=join(f.dir,'foreign.sqlite'),db=new DatabaseSync(path);db.exec('CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES (\'keep\')');db.close();
  assert.throws(()=>new Store(path,f.auditKey),/foreign_database_refused/);
  const check=new DatabaseSync(path,{readOnly:true});assert.equal(check.prepare('SELECT value FROM sentinel').get()?.value,'keep');assert.equal(check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get()?.n,1);check.close();
}));
test('8а HTTP: distinct verified incident opens case without invented injury date or new grant; uncertain mapping waits',async()=>use(async f=>{
  const grants=f.store.row('SELECT COUNT(*) AS n FROM access_grant')?.n;
  assert.equal((await f.send({...primaryFixture(),event_id:'demo-second-incident-event',source_stream:'demo-second-incident-stream',incident_ref:'demo-second-incident'})).status,202);
  const added=f.store.row("SELECT id,injury_date,injury_date_assurance FROM wound_case WHERE incident_ref='demo-second-incident'");assert(added);assert.equal(added.injury_date,null);assert.equal(added.injury_date_assurance,'unknown');assert.equal(f.store.row('SELECT COUNT(*) AS n FROM access_grant')?.n,grants);
  await f.login('patient');assert.equal((await f.get('/api/cases/'+String(added.id))).status,404);
  (f.source.subjects as Set<string>).add('demo-unmapped');const unknown=await f.send({...primaryFixture(),event_id:'demo-unmapped-event',source_stream:'demo-unmapped-stream',subject_ref:'demo-unmapped'});assert.equal(unknown.status,202);assert.equal((await unknown.json() as {status:string}).status,'pending_review');assert.equal(f.store.row('SELECT COUNT(*) AS n FROM wound_case')?.n,31);
}));
test('8а HTTP: concurrent deliveries apply one durable effect',async()=>use(async f=>{
  const results=await Promise.all(Array.from({length:5},()=>f.send()));assert.deepEqual(results.map(r=>r.status).sort(),[200,200,200,200,202]);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM inbox_event')?.n,1);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM outbox')?.n,1);
}));
test('8а: app rejects production/non-loopback; CSP/static assets/cookies and audit expose no secrets',async()=>use(async f=>{
  assert.throws(()=>createApp({...f.options,origin:'http://0.0.0.0:4317'}));const home=await f.get('/');assert.equal(home.status,200);assert(home.headers.get('content-security-policy')?.includes("script-src 'self'"));
  await f.login('patient');const all=JSON.stringify(f.store.rows('SELECT * FROM audit_entry'));for(const sentinel of ['TEST_PRIVATE_SENTINEL',f.cookie.split('=')[1]??'missing',f.source.secret.toString('hex'),'demo-person-01'])assert(!all.includes(sentinel));
}));
