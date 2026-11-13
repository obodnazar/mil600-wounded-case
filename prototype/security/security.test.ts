import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createSecurityServer, type ServerOptions } from './server.js';
import { FileAudit, Limiter, Denied, safeAggregate, requireDemoEnvironment, signature,
  type Role, type Session, type SourceKey, type EventEnvelope } from './core.js';

const at = Date.parse('2026-11-13T08:00:00Z'); // Синтетичний годинник, не бойовий епізод.
function event(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {schema_version:'case-event/1',event_id:'demo-event-one',event_type:'medical.primary_recorded',source_system:'demo-mis',
    source_record_ref:'demo-primary-one',source_stream:'demo-primary-one',source_version:'v1',source_order:1,
    subject_ref:'demo-subject-one',incident_ref:'demo-incident-one',episode_ref:null,
    occurred_at:new Date(at).toISOString(),recorded_at:new Date(at).toISOString(),
    payload:{document_kind:'primary_medical_card',document_version:'v1'},...overrides};
}
async function fixture(options: Partial<ServerOptions> = {}) {
  const dir = await mkdtemp(join(tmpdir(),'mil600-security-'));
  const sessions = new Map<string,Session>(); const tokens = new Map<Role,string>();
  for (const role of ['patient','commander','support','analyst','dev'] as const) {
    const token = randomBytes(32).toString('hex'); tokens.set(role,token);
    sessions.set(token,{actorId:'demo-'+role,role,caseIds:new Set(['demo-case-one']),expiresAt:at+900_000,grantExpiresAt:at+900_000,revoked:false});
  }
  const source: SourceKey = {id:'demo-mis-v1',secret:randomBytes(32),source:'demo-mis',types:new Set(['medical.primary_recorded']),subjects:new Set(['demo-subject-one'])};
  const path = join(dir,'audit.jsonl');
  const server = createSecurityServer({environment:'synthetic-test',sessions,cases:new Map([['demo-case-one',
    {id:'demo-case-one',status:'requires_action',nextAction:'confirm_receipt',freshness:'unknown',clinicalText:'TEST_ONLY_CLINICAL',sourceRef:'TEST_ONLY_REF'}]]),
    keys:new Map([[source.id,source]]),audit:new FileAudit(path),auditKey:randomBytes(32),now:()=>at,...options});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = 'http://127.0.0.1:'+(server.address() as AddressInfo).port;
  return {server,base,path,sessions,tokens,source,
    get:(route:string,role:Role='commander',extra:Record<string,string>={})=>fetch(base+route,{headers:{authorization:'Bearer '+tokens.get(role),...extra}}),
    send:(value:unknown,h:Partial<{nonce:string;timestamp:string;signature:string;keyId:string}>={},rawOverride?:Buffer)=>{
      const raw=rawOverride ?? Buffer.from(JSON.stringify(value));
      const meta={keyId:h.keyId ?? source.id,timestamp:h.timestamp ?? String(at/1000),nonce:h.nonce ?? randomBytes(16).toString('hex')};
      return fetch(base+'/api/integration/events',{method:'POST',body:new Uint8Array(raw),headers:{'content-type':'application/json','x-key-id':meta.keyId,'x-timestamp':meta.timestamp,'x-nonce':meta.nonce,'x-signature':h.signature ?? signature(source.secret,meta,raw)}});
    },
    close:async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await rm(dir,{recursive:true,force:true});}
  };
}
async function use(fn:(f:Awaited<ReturnType<typeof fixture>>)=>Promise<void>, options:Partial<ServerOptions>={}) {
  const f=await fixture(options); try {await fn(f);} finally {await f.close();}
}

test('HTTP: commander/support get 403 for clinical document; source refs absent from DTO',async()=>use(async f=>{
  for(const role of ['commander','support','analyst','dev'] as const) assert.equal((await f.get('/api/cases/demo-case-one/clinical-document',role)).status,403);
  const r=await f.get('/api/cases/demo-case-one'); assert.equal(r.status,200);
  const dto=await r.text(); assert(!dto.includes('TEST_ONLY')); assert(!dto.includes('sourceRef')); assert(!dto.includes('clinical'));
  assert.equal((await f.get('/api/cases/demo-case-one/clinical-document','patient')).status,200);
}));
test('HTTP: role/unit injection, foreign/existing versus absent case, no session',async()=>use(async f=>{
  assert.equal((await f.get('/api/cases/demo-case-one?role=patient')).status,400);
  assert.equal((await f.get('/api/cases/demo-case-one/clinical-document','commander',{'x-role':'patient','x-unit-id':'all'})).status,403);
  assert.equal((await f.get('/api/cases/demo-other')).status,404);
  assert.equal((await f.get('/api/cases/demo-missing')).status,404);
  assert.equal((await fetch(f.base+'/api/cases/demo-case-one')).status,401);
}));
test('HTTP: revocation and expiry checked again after a successful read',async()=>use(async f=>{
  const session=f.sessions.get(f.tokens.get('commander') ?? ''); assert(session);
  assert.equal((await f.get('/api/cases/demo-case-one')).status,200); session.revoked=true;
  assert.equal((await f.get('/api/cases/demo-case-one')).status,401); session.revoked=false;
  session.caseIds.clear(); assert.equal((await f.get('/api/cases/demo-case-one')).status,404);
  session.caseIds.add('demo-case-one'); session.grantExpiresAt=at; assert.equal((await f.get('/api/cases/demo-case-one')).status,401);
}));
test('HTTP: unsafe methods and cross-origin requests denied, security headers on errors',async()=>use(async f=>{
  const r=await f.get('/api/cases/demo-case-one','patient',{origin:'https://example.invalid'}); assert.equal(r.status,403);
  for(const name of ['content-security-policy','x-content-type-options','referrer-policy','cache-control','permissions-policy']) assert(r.headers.has(name));
  assert.equal(r.headers.get('cache-control'),'no-store'); assert(!r.headers.has('access-control-allow-origin'));
  assert.equal((await fetch(f.base+'/api/cases/demo-case-one',{method:'POST',headers:{authorization:'Bearer '+f.tokens.get('patient')}})).status,405);
}));
test('HTTP: signed event validated only, retry idempotent and changed digest conflicts',async()=>use(async f=>{
  const a=await f.send(event()); assert.equal(a.status,200); assert.deepEqual(await a.json(),{status:'validated_only',business_applied:false});
  assert.deepEqual(await (await f.send(event())).json(),{status:'duplicate',business_applied:false});
  const changed=event({payload:{document_kind:'primary_medical_card',document_version:'v2'}});
  assert.equal((await f.send(changed)).status,409);
}));
test('HTTP: same revision with new event id is duplicate; semantic key order irrelevant',async()=>use(async f=>{
  assert.equal((await f.send(event())).status,200);
  const e=event({event_id:'demo-event-two'});const reordered=Object.fromEntries(Object.entries(e).reverse());
  assert.deepEqual(await (await f.send(reordered)).json(),{status:'duplicate',business_applied:false});
}));
test('HTTP: exact transport replay concurrent requests yields one validation',async()=>use(async f=>{
  const nonce=randomBytes(16).toString('hex'); const statuses=await Promise.all([f.send(event(),{nonce}),f.send(event(),{nonce})]);
  assert.deepEqual(statuses.map(r=>r.status).sort(),[200,409]);
}));
test('HTTP: replay remains blocked at the inclusive boundary of a future timestamp',async()=>{
  let clock=at;
  await use(async f=>{
    const h={timestamp:String(at/1000+300),nonce:randomBytes(16).toString('hex')};
    assert.equal((await f.send(event(),h)).status,200);
    clock+=600_000;
    assert.equal((await f.send(event(),h)).status,409);
  },{now:()=>clock});
});
test('HTTP: bad signature, changed raw body, timestamp skew, missing/unknown key',async()=>use(async f=>{
  assert.equal((await f.send(event(),{signature:'0'.repeat(64)})).status,401);
  assert.equal((await f.send(event(),{timestamp:String(at/1000-301)})).status,401);
  assert.equal((await f.send(event(),{timestamp:String(at/1000+301)})).status,401);
  assert.equal((await f.send(event(),{keyId:'unknown'})).status,401);
  const meta={keyId:f.source.id,timestamp:String(at/1000),nonce:randomBytes(16).toString('hex')};
  const sig=signature(f.source.secret,meta,Buffer.from(JSON.stringify(event())));
  assert.equal((await f.send(event(),{...meta,signature:sig},Buffer.from(JSON.stringify(event())+' '))).status,401);
}));
test('HTTP: signed but unauthorized source/type/subject cannot grant authority',async()=>use(async f=>{
  assert.equal((await f.send(event({source_system:'demo-finance'}))).status,403);
  assert.equal((await f.send(event({subject_ref:'demo-other-subject'}))).status,403);
  const e=event({event_type:'service.action_confirmed',payload:{action_ref:'demo-action',action_code:'service_action_completed',evidence_ref:'demo-proof'}});
  assert.equal((await f.send(e)).status,403);
}));
test('HTTP: strict schema rejects clinical extras, access grants, invalid dates and malformed JSON',async()=>use(async f=>{
  for(const e of [ {...event(),diagnosis:'TEST_PRIVATE_SENTINEL'}, {...event(),role:'commander'},
    event({recorded_at:'2026-02-30T00:00:00Z'}),event({payload:{document_kind:'primary_medical_card',document_version:'v1',url:'https://example.invalid',token:'TEST_PRIVATE_SENTINEL'}})]) {
    const r=await f.send(e); assert.equal(r.status,400); assert(!(await r.text()).includes('TEST_PRIVATE_SENTINEL'));
  }
  assert.equal((await f.send(null,{},Buffer.from('{'))).status,400);
  assert.equal((await f.send(null,{},Buffer.from('{"__proto__":{"role":"commander"}}'))).status,400);
}));
test('HTTP: size/content-type bounds; schema cannot smuggle a raw document',async()=>use(async f=>{
  assert.equal((await f.send(null,{},Buffer.alloc(16_385,65))).status,413);
  assert.equal((await fetch(f.base+'/api/integration/events',{method:'POST',body:'{}'})).status,415);
  const e=event({payload:{document_kind:'primary_medical_card',document_version:'v1',base64:'TEST_PRIVATE_SENTINEL'}});
  assert.equal((await f.send(e)).status,400);
}));
test('HTTP: rate limiter ignores spoofed forwarding headers',async()=>use(async f=>{
  assert.equal((await f.get('/api/cases/demo-case-one')).status,200);
  assert.equal((await f.get('/api/cases/demo-case-one','commander',{'x-forwarded-for':'192.0.2.123'})).status,429);
},{readLimit:1}));
test('limiter capacity is bounded and active buckets cannot be evicted to bypass limits',()=>{
  const l=new Limiter(1,1000,1); l.take('one',0);
  assert.throws(()=>l.take('two',1),Denied); assert.throws(()=>l.take('one',1),Denied);
  assert.doesNotThrow(()=>l.take('two',1001));
});
test('HTTP: privacy-safe audit records allow+deny, no input values or tokens; private file',async()=>use(async f=>{
  await f.get('/api/cases/demo-case-one');await f.get('/api/cases/demo-case-one/clinical-document');
  await f.get('/api/cases/demo-case-one?role=patient');
  await f.get('/api/cases/demo-case-one','commander',{origin:'https://example.invalid'});
  await f.send({...event(),diagnosis:'TEST_PRIVATE_SENTINEL'});
  const text=await readFile(f.path,'utf8');const records=text.trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>);
  assert(records.some(r=>r.result==='allowed')); assert(records.some(r=>r.result==='denied'));
  assert.equal(records.length,5);
  for(const sentinel of ['TEST_PRIVATE_SENTINEL','TEST_ONLY_CLINICAL','TEST_ONLY_REF','demo-case-one',f.tokens.get('commander') ?? 'impossible']) assert(!text.includes(sentinel));
  assert.equal((await stat(f.path)).mode & 0o777,0o600);
}));
test('HTTP: source cannot exceed global type policy even if its local type set is overbroad',async()=>use(async f=>{
  const mutable=f.source.types as Set<string>; mutable.add('service.action_confirmed');
  const e=event({event_type:'service.action_confirmed',payload:{action_ref:'demo-action',action_code:'service_action_completed',evidence_ref:'demo-proof'}});
  assert.equal((await f.send(e)).status,403);
}));
test('HTTP: receipt needs evidence; VLK cannot attest receipt by servicemember',async()=>use(async f=>{
  f.source.source='demo-vlk'; const types=f.source.types as Set<string>;types.clear();types.add('document.received');
  const payload={document_ref:'demo-document',document_version:'v1',recipient_ref:'demo-recipient',recipient_kind:'servicemember',received_at:new Date(at).toISOString(),evidence_ref:'demo-proof'};
  assert.equal((await f.send(event({source_system:'demo-vlk',event_type:'document.received',payload}))).status,403);
  const allowed={...payload,recipient_kind:'vlk'};
  assert.equal((await f.send(event({source_system:'demo-vlk',event_type:'document.received',payload:allowed}))).status,200);
  const {evidence_ref: omitted,...noProof}=allowed; assert.equal(omitted,'demo-proof');
  assert.equal((await f.send(event({source_system:'demo-vlk',event_type:'document.received',payload:noProof}))).status,400);
}));
test('HTTP: financial approval is only validated; extra financial/clinical data rejected',async()=>use(async f=>{
  f.source.source='demo-finance'; const types=f.source.types as Set<string>;types.clear();types.add('finance.status_recorded');
  const payload={kind:'ogd',packet_ref:'demo-packet',period:'2026-11',status:'approved',reason_code:'authorized_reason',decision_ref:'demo-decision',evidence_ref:'demo-proof'};
  const r=await f.send(event({source_system:'demo-finance',event_type:'finance.status_recorded',payload}));
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'validated_only',business_applied:false});
  assert.equal((await f.send(event({source_system:'demo-finance',event_type:'finance.status_recorded',payload:{...payload,diagnosis:'TEST_PRIVATE_SENTINEL'}}))).status,400);
}));
test('HTTP: audit failure denies read and does not report event acceptance',async()=>use(async f=>{
  assert.equal((await f.get('/api/cases/demo-case-one')).status,503);
  assert.equal((await f.send(event())).status,503);
},{audit:{write:async()=>{throw new Error('TEST_PRIVATE_SENTINEL');}}}));
test('HTTP: aggregate is fixed, no rows/filter endpoint and unauthorized role denied',async()=>use(async f=>{
  const data=await (await f.get('/api/analytics','analyst')).json(); assert.deepEqual(data,{status:'suppressed'});
  assert.equal((await f.get('/api/analytics?unit=demo-one','analyst')).status,400);
  assert.equal((await f.get('/api/cases/demo-case-one','analyst')).status,403);
  assert.equal((await f.get('/api/analytics','commander')).status,403);
}));
test('aggregate complementary/empty groups suppress total; only synthetic >=5 cells release',()=>{
  for(const counts of [[3,7],[0,10],[4,100],[]]) assert.deepEqual(safeAggregate(counts),{status:'suppressed'});
  assert.deepEqual(safeAggregate([5,5]),{status:'synthetic_fixed_snapshot',groups:[5,5],total:10});
  assert.throws(()=>safeAggregate([5,-1]),Denied); assert.throws(()=>safeAggregate([2,2],1),Denied);
});
test('secrets only env: absent/weak/reused keys and production mode fail closed',()=>{
  const env:NodeJS.ProcessEnv={DEMO_MODE:'true'};
  assert.throws(()=>requireDemoEnvironment(env));
  for(const name of ['DEMO_MIS_HMAC_KEY','DEMO_SEDO_HMAC_KEY','DEMO_VLK_HMAC_KEY','DEMO_FINANCE_HMAC_KEY','DEMO_AUDIT_HMAC_KEY']) env[name]=randomBytes(32).toString('hex');
  assert.equal(requireDemoEnvironment(env).size,5);
  assert.throws(()=>requireDemoEnvironment({...env,NODE_ENV:'production'}));
  assert.throws(()=>requireDemoEnvironment({...env,DEMO_MIS_HMAC_KEY:env.DEMO_AUDIT_HMAC_KEY}));
});
