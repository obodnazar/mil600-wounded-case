import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {readFileSync, readdirSync, mkdirSync, chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {applyEvent,ReviewRequired,requirements,sources,insert,command,task,resolveCertificateReview,type Command} from './domain.js';
import {kyivDate} from './calendar.js';
import {snapshot,cohort} from './metrics.js';
import {extendView} from './views.js';
import {auditRecord, Denied, semanticDigest, type AuditAction, type AuditResult, type EventEnvelope, type Session, type SignatureHeaders} from '../security/core.js';
import type {AnalyticsView, CaseView, DemoProfile, DevView, StaffView} from '../shared/view.js';
import {seed, TRAUMA_CERTIFICATE} from './seed.js';

type Row=Record<string,string|number|bigint|Uint8Array|null>;
const text=(r:Row,k:string):string=>String(r[k]??'');
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const id=()=>`demo-${randomUUID()}`;
const uid=id;
const names:Record<string,string>={care:'Лікування',documents:'Оформлення документів',vlk:'Розгляд ВЛК',service_action:'Адміністративна дія',finance:'Розгляд виплати',completed:'Завершений етап',source_linked:'Подію еПМК долучено',administrative_open:'Потрібне медичне джерело'};
const documentNames:Record<string,string>={primary_medical_card:'Первинний обліковий медичний документ (еПМК)',trauma_certificate:TRAUMA_CERTIFICATE};
export class Store {
  readonly db:DatabaseSync;
  constructor(path:string,readonly auditKey:Buffer){
    if(auditKey.length<32)throw new Error('invalid_audit_key');
    if(path!==':memory:'){mkdirSync(dirname(path),{recursive:true,mode:0o700});}
    this.db=new DatabaseSync(path,{enableForeignKeyConstraints:true,allowExtension:false});
    const existing=this.rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    if(existing.length&&(!existing.some(t=>t.name==='seed_snapshot')||!existing.some(t=>t.name==='schema_migration')||!this.row("SELECT id FROM seed_snapshot WHERE id='demo-cohort-v1' AND definition_version='seed-1'"))){this.db.close();throw new Error('foreign_database_refused');}
    if(path!==':memory:')chmodSync(path,0o600);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migration(version TEXT PRIMARY KEY,checksum TEXT NOT NULL) STRICT');
    const dir=new URL('../../db/migrations/',import.meta.url);
    for(const file of readdirSync(dir).filter(f=>/^\d{3}-.*\.sql$/.test(f)).sort()){
      const sql=readFileSync(new URL(file,dir),'utf8'), checksum=hash(sql),version=file.slice(0,3),migration=this.row('SELECT checksum FROM schema_migration WHERE version=?',version);
      if(migration&&migration.checksum!==checksum)throw new Error('migration_checksum_mismatch');
      if(!migration)this.transaction(()=>{this.db.exec(sql);this.run('INSERT INTO schema_migration VALUES (?,?)',version,checksum);});
    }
    seed(this.db);
    if(!this.row("SELECT id FROM demo_setting WHERE id='boot-8b'"))this.transaction(()=>{
      const at='2026-01-01T00:00:00.000Z';
      for(const person of this.rows("SELECT id FROM subject WHERE id LIKE 'demo-person-%'"))for(const source of sources){
        if(!this.row('SELECT id FROM identity_link WHERE source_namespace=? AND source_subject_token=?',source,person.id??null))insert(this,'identity_link',{id:uid(),subject_id:person.id??null,source_namespace:source,source_subject_token:person.id??null,verification_state:'verified',proof_ref:'demo-independent-binding-'+source,valid_from:at,valid_to:null});
      }
      for(const c of this.rows('SELECT id,subject_id,incident_ref FROM wound_case')){
        for(const source of sources)this.run('INSERT OR IGNORE INTO incident_link VALUES (?,?,?,?,?)',source,c.subject_id??null,c.incident_ref??'',c.id??null,'demo-independent-incident-binding');
        this.run("UPDATE wound_case SET source_linked=CASE WHEN origin='medical_event' THEN 1 ELSE 0 END WHERE id=?",c.id??null);
        for(const route of ['reward','ogd'])requirements(this,String(c.id),route,`demo-${route}-packet-`+String(c.id).slice(-2));
      }
      this.run('INSERT INTO analytics_snapshot VALUES (?,?)','demo-cohort-v1',JSON.stringify(snapshot()));
      this.run('INSERT INTO analytics_snapshot VALUES (?,?)','demo-small',JSON.stringify(snapshot(cohort.slice(0,3))));
      this.run("INSERT INTO demo_setting VALUES ('boot-8b','complete')");
    });
  }
  row(sql:string,...values:SQLInputValue[]):Row|undefined{return this.db.prepare(sql).get(...values);}
  rows(sql:string,...values:SQLInputValue[]):Row[]{return this.db.prepare(sql).all(...values);}
  run(sql:string,...values:SQLInputValue[]):void {this.db.prepare(sql).run(...values);}
  transaction<T>(work:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const result=work();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  close():void{this.db.close();}
  audit(action:AuditAction,result:AuditResult,actor:string,resource:string,now:number,role='source'):void {
    const r=auditRecord(this.auditKey,action,result,actor,resource,now);
    this.run('INSERT INTO audit_entry VALUES (?,?,?,?,?,?,?,?)',r.request_id,r.actor_tag,role,r.action,r.resource_tag,r.result,r.at,r.request_id);
  }
  session(profile:DemoProfile,actor:string,now:number):Session {
    const at=new Date(now).toISOString();
    const grants=this.rows("SELECT * FROM access_grant WHERE actor_subject_id=? AND role=? AND purposes='demo' AND revoked_at IS NULL AND valid_from<=? AND valid_to>?",actor,profile,at,at);
    if(!grants.length)throw new Denied(401,'authentication_required');
    const cases=new Set<string>();
    for(const grant of grants){
      if(grant.case_id){
        const c=this.row('SELECT subject_id FROM wound_case WHERE id=?',grant.case_id);
        if(c&&(profile!=='patient'||c.subject_id===actor))cases.add(String(grant.case_id));
      }else if(grant.unit_ref)for(const c of this.rows("SELECT c.id FROM wound_case c JOIN unit_assignment u ON u.subject_id=c.subject_id WHERE u.unit_ref=? AND u.verification_state='verified' AND u.valid_from<=? AND (u.valid_to IS NULL OR u.valid_to>?)",grant.unit_ref,at,at))cases.add(text(c,'id'));
    }
    return {actorId:actor,role:profile,caseIds:cases,expiresAt:now+900000,revoked:false,grantExpiresAt:Math.max(...grants.map(g=>Date.parse(String(g.valid_to))))};
  }
  caseView(caseId:string,clinical:boolean):CaseView {
    const c=this.row('SELECT id,subject_id,lifecycle_state FROM wound_case WHERE id=?',caseId);if(!c)throw new Denied(404,'not_found');
    const person=this.row('SELECT demo_label FROM subject WHERE id=?',c.subject_id??null);
    const deadline=this.row('SELECT anchor_status,due_date,provisional_follow_up_date,status FROM deadline WHERE case_id=?',caseId);
    const task=this.row("SELECT kind FROM task WHERE case_id=? AND status='open' ORDER BY id LIMIT 1",caseId);
    const timeline=clinical?this.rows('SELECT event_type,occurred_at,recorded_at,source_ref,assurance FROM case_event WHERE case_id=? ORDER BY recorded_at DESC,id DESC',caseId).map(r=>({title:r.event_type==='medical.primary_recorded'?'Джерело еПМК долучено':'Джерельна подія',at:r.occurred_at===null?null:text(r,'occurred_at'),source:text(r,'source_ref'),state:r.assurance==='synthetic_seed'?'ВИГАДАНИЙ SEED':'СИМУЛЯЦІЯ'})):[];
    const checklist=clinical?this.rows(`SELECT r.document_kind,r.status,d.provenance,l.state AS delivery_state FROM case_requirement r
      LEFT JOIN requirement_evidence e ON e.case_requirement_id=r.id LEFT JOIN document_ref d ON d.id=e.document_ref_id
      LEFT JOIN delivery l ON l.document_ref_id=d.id AND l.recipient_ref='demo-vlk' WHERE r.case_id=? ORDER BY r.document_kind`,caseId).map(r=>({title:documentNames[text(r,'document_kind')]??'Документ',state:r.status==='present'?'Технічно звірено':'Бракує',provenance:r.provenance==='manual_demo_copy'?'Навчальна копія':r.provenance?'Посилання джерела':'Очікуємо джерело',delivery:r.delivery_state==='received'?'Отримання ВЛК підтверджене':r.delivery_state==='sent'?'Надіслано; отримання не підтверджене':'Не передано'})):[];
    const episode=clinical?this.row('SELECT p.label FROM treatment_episode e JOIN demo_provider p ON p.id=e.provider_ref WHERE e.case_id=? AND e.end_date IS NULL ORDER BY e.start_date DESC LIMIT 1',caseId):undefined;
    return extendView(this,caseId,clinical,{id:caseId,label:person?text(person,'demo_label'):'Навчальний учасник',status:names[text(c,'lifecycle_state')]??'Потребує уточнення',
      nextAction:task?.kind==='confirm_receipt_date'?'Підтвердити дату отримання документа':'Перевірити стан оформлення документа',owner:'Служба супроводу',
      freshness:'Навчальний зріз · 13.11.2026',timeline,checklist,deadline:{anchor:deadline?text(deadline,'anchor_status'):'unknown',
        due:deadline?.due_date?text(deadline,'due_date'):null,followUp:deadline?.provisional_follow_up_date?text(deadline,'provisional_follow_up_date'):null,status:deadline?text(deadline,'status'):'unknown'},
      care:episode?text(episode,'label'):null,finances:clinical?this.rows('SELECT payment_kind,period_start,current_status FROM financial_track WHERE case_id=? ORDER BY payment_kind',caseId).map(r=>({kind:text(r,'payment_kind'),period:text(r,'period_start'),status:text(r,'current_status')})):[]});
  }
  staffView(session:Session):StaffView {
    if(session.role!=='commander'&&session.role!=='support')throw new Denied(403,'forbidden');
    return {profile:session.role,scope:'Призначена навчальна область',cases:[...session.caseIds].sort().map(c=>this.caseView(c,false))};
  }
  analytics():AnalyticsView {const row=this.row('SELECT payload FROM analytics_snapshot WHERE id=(SELECT value FROM demo_setting WHERE id=?)','analytics');if(!row)throw new Denied(503,'analytics_unavailable');return JSON.parse(String(row.payload)) as AnalyticsView;}
  command(session:Session,input:Command,now:number){return command(this,session,input,now);}
  devView():DevView {return {fixture:'ЕПМК · один перевірений навчальний випадок',source:'МІС ЗСУ · симуляція',stages:['Типізована подія','HMAC і схема','Стійкий inbox','Кейс · задача · outbox'],
    pending:Number(this.row("SELECT COUNT(*) AS n FROM inbox_event WHERE processing_state!='applied'")?.n??0),accepted:Number(this.row('SELECT COUNT(*) AS n FROM inbox_event')?.n??0)};}
  accept(event:EventEnvelope,h:SignatureHeaders,now:number):{http:number;status:string;business_applied:boolean} {
    return this.transaction(()=>{
      this.run('DELETE FROM transport_nonce WHERE expires_at<=?',now);
      const nonce=hash(h.nonce);
      if(this.row('SELECT 1 FROM transport_nonce WHERE key_id=? AND nonce_hash=?',h.keyId,nonce))throw new Denied(409,'transport_replay');
      this.run('INSERT INTO transport_nonce VALUES (?,?,?)',h.keyId,nonce,now+601000);
      const digest=semanticDigest(event);
      const previous=this.rows('SELECT id,semantic_digest FROM inbox_event WHERE (source_system=? AND event_id=?) OR (source_system=? AND source_stream=? AND source_version=? AND event_type=?)',event.source_system,event.event_id,event.source_system,event.source_stream,event.source_version,event.event_type);
      if(previous.some(r=>r.semantic_digest!==digest)){
        const original=this.row('SELECT case_id FROM case_event WHERE inbox_event_id=? LIMIT 1',previous[0]?.id??null);
        const scope=original?this.row("SELECT u.unit_ref FROM unit_assignment u JOIN wound_case c ON c.subject_id=u.subject_id WHERE c.id=? AND u.verification_state='verified' AND u.valid_to IS NULL",original.case_id??null):undefined;
        this.run('INSERT INTO review_item VALUES (?,?,?,?,?,?,?)',id(),original?.case_id??null,previous[0]?.id??null,'event_conflict',scope?.unit_ref??'demo-source-review','open',null);
        if(original)this.run("UPDATE wound_case SET freshness_state='conflict' WHERE id=?",original.case_id??null);
        this.audit('event_validate','denied',event.source_system,event.event_id,now);
        return {http:409,status:'event_conflict',business_applied:false};
      }
      if(previous.length){this.audit('event_validate','duplicate',event.source_system,event.event_id,now);return {http:200,status:'duplicate',business_applied:false};}
      if(Number(this.row('SELECT COUNT(*) AS n FROM inbox_event')?.n??0)>=1000)throw new Denied(429,'ingress_capacity');
      const inbox=id(),at=new Date(now).toISOString();
      this.run('INSERT INTO inbox_event VALUES (?,?,?,?,?,?,?,?,?,?,?)',inbox,event.source_system,event.event_id,event.source_stream,event.source_version,event.source_order,event.event_type,digest,at,JSON.stringify(event),'pending_review');
      this.db.exec('SAVEPOINT domain_apply');
      try {
        applyEvent(this,event,inbox,now);
        this.db.exec('RELEASE domain_apply');this.run("UPDATE inbox_event SET processing_state='applied' WHERE id=?",inbox);
        this.audit('event_validate','accepted',event.source_system,event.event_id,now);
        return {http:202,status:'accepted',business_applied:true};
      }catch(error){
        this.db.exec('ROLLBACK TO domain_apply');this.db.exec('RELEASE domain_apply');
        if(!(error instanceof ReviewRequired))throw error;
        const person=this.row("SELECT subject_id FROM identity_link WHERE source_namespace=? AND source_subject_token=? AND verification_state='verified' AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)",event.source_system,event.subject_ref,at,at);
        const c=person&&event.incident_ref?this.row("SELECT id FROM wound_case WHERE subject_id=? AND incident_namespace='demo-mis' AND incident_ref=?",person.subject_id??null,event.incident_ref):undefined;
        const assignment=person?this.row("SELECT unit_ref FROM unit_assignment WHERE subject_id=? AND verification_state='verified' AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)",person.subject_id??null,at,at):undefined;
        insert(this,'review_item',{id:id(),case_id:c?.id??null,inbox_event_id:inbox,reason_code:error.reason,assigned_scope:assignment?.unit_ref??'demo-source-review',state:'open',resolution_event_ref:null});
        if(c)this.run("UPDATE wound_case SET freshness_state='conflict' WHERE id=?",c.id??null);
        this.audit('event_validate','pending',event.source_system,event.event_id,now);return {http:202,status:'pending_review',business_applied:false};
      }
    });
  }
  refreshDeadlines(now:number):void {
    this.transaction(()=>{
      for(const c of this.rows("SELECT DISTINCT case_id FROM document_ref WHERE kind='trauma_certificate' AND active=1 AND state IN ('issued','corrected') AND provenance='source_reference'"))resolveCertificateReview(this,String(c.case_id));
      for(const d of this.rows("SELECT id,case_id,calculation_revision FROM deadline WHERE anchor_status='confirmed' AND applicability_state='applicable' AND due_date<? AND NOT (rule_version_id='demo-rule-certificate' AND EXISTS(SELECT 1 FROM document_ref r WHERE r.case_id=deadline.case_id AND r.kind='trauma_certificate' AND r.active=1 AND r.state IN ('issued','corrected') AND r.provenance='source_reference'))",kyivDate(new Date(now).toISOString()))){
      const trigger='demo-deadline:'+String(d.id)+':'+String(d.calculation_revision);
      if(this.row('SELECT id FROM task WHERE case_id=? AND trigger_ref=?',d.case_id??null,trigger))continue;
      task(this,String(d.case_id),'review_deadline','support',trigger);this.audit('event_validate','allowed','demo-calendar',String(d.id),now,'worker');
    }});
  }
  dispatchLocalOutbox():void {
    this.transaction(()=>{
      // Проєкції читають актуальну БД; worker підтверджує лише локальне повідомлення, без зовнішньої доставки.
      for(const item of this.rows("SELECT id FROM outbox WHERE state='pending' AND destination_ref='demo-local-projection' AND attempt_count<3 LIMIT 10"))this.run("UPDATE outbox SET state='delivered_local',attempt_count=attempt_count+1 WHERE id=?",item.id??null);
    });
  }
}
