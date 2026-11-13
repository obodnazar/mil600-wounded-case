import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {readFileSync, mkdirSync, chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {auditRecord, Denied, semanticDigest, type AuditAction, type AuditResult, type EventEnvelope, type Session, type SignatureHeaders} from '../security/core.js';
import type {AnalyticsView, CaseView, DemoProfile, DevView, StaffView} from '../shared/view.js';
import {seed, DEMO_AS_OF, TRAUMA_CERTIFICATE} from './seed.js';

type Row=Record<string,string|number|bigint|Uint8Array|null>;
const text=(r:Row,k:string):string=>String(r[k]??'');
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const id=()=>`demo-${randomUUID()}`;
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
    const sql=readFileSync(new URL('../../db/migrations/001-initial.sql',import.meta.url),'utf8'), checksum=hash(sql);
    const migration=this.row('SELECT checksum FROM schema_migration WHERE version=?','001');
    if(migration&&migration.checksum!==checksum)throw new Error('migration_checksum_mismatch');
    if(!migration)this.transaction(()=>{this.db.exec(sql);this.run('INSERT INTO schema_migration VALUES (?,?)','001',checksum);});
    seed(this.db);
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
    return {id:caseId,label:person?text(person,'demo_label'):'Навчальний учасник',status:names[text(c,'lifecycle_state')]??'Потребує уточнення',
      nextAction:task?.kind==='confirm_receipt_date'?'Підтвердити дату отримання документа':'Перевірити стан оформлення документа',owner:'Служба супроводу',
      freshness:'Навчальний зріз · 13.11.2026',timeline,checklist,deadline:{anchor:deadline?text(deadline,'anchor_status'):'unknown',
        due:deadline?.due_date?text(deadline,'due_date'):null,followUp:deadline?.provisional_follow_up_date?text(deadline,'provisional_follow_up_date'):null,status:deadline?text(deadline,'status'):'unknown'},
      care:episode?text(episode,'label'):null,finances:clinical?this.rows('SELECT payment_kind,period_start,current_status FROM financial_track WHERE case_id=? ORDER BY payment_kind',caseId).map(r=>({kind:text(r,'payment_kind'),period:text(r,'period_start'),status:text(r,'current_status')})):[]};
  }
  staffView(session:Session):StaffView {
    if(session.role!=='commander'&&session.role!=='support')throw new Denied(403,'forbidden');
    return {profile:session.role,scope:'Призначена навчальна область',cases:[...session.caseIds].sort().map(c=>this.caseView(c,false))};
  }
  analytics():AnalyticsView {
    // BO ще не реалізовані: не публікуємо чисел / total / довільних зрізів під виглядом готового виміру.
    return {status:'definitions_only',cohort:'demo-cohort-v1 · фіксований вигаданий набір',asOf:DEMO_AS_OF,minimum:5,metrics:[
      {id:'BO-1',title:'Час до постанови ВЛК',value:'[TBD]',detail:'Медіана від підтвердженої дати поранення; відкриті кейси й невідомі дати окремо.',state:'planned'},
      {id:'BO-2',title:'Пакети з поверненням',value:'[TBD]',detail:'Унікальні отримані пакети; ВЛК та ОГД окремо, з горизонтом спостереження.',state:'planned'},
      {id:'BO-3',title:'Підтверджені зупинки виплат',value:'[TBD]',detail:'Лише підтверджена причина; нагадування не є зупинкою виплати.',state:'planned'},
      {id:'BO-4',title:'Контекст звернень',value:'Окреме джерело',detail:'Зовнішній контекст, без висновку про ефект продукту чи індивідуальних скарг.',state:'context'},
      {id:'BO-5',title:'Документи без кур’єра',value:'[TBD]',detail:'Усі потрібні документи в знаменнику; потрібне отримання визначеної версії ВЛК.',state:'planned'},
      {id:'BO-6',title:'Навантаження супроводу',value:'[TBD]',detail:'Активні кейси / погоджений FTE й окремо фактичні хвилини роботи на кейс.',state:'planned'}]};
  }
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
        this.run('INSERT INTO review_item VALUES (?,?,?,?,?,?,?)',id(),null,previous[0]?.id??null,'event_conflict','demo-source-review','open',null);
        this.audit('event_validate','denied',event.source_system,event.event_id,now);
        return {http:409,status:'event_conflict',business_applied:false};
      }
      if(previous.length){this.audit('event_validate','duplicate',event.source_system,event.event_id,now);return {http:200,status:'duplicate',business_applied:false};}
      if(Number(this.row('SELECT COUNT(*) AS n FROM inbox_event')?.n??0)>=1000)throw new Denied(429,'ingress_capacity');
      const inbox=id(),at=new Date(now).toISOString();
      const link=this.row("SELECT subject_id FROM identity_link WHERE source_namespace=? AND source_subject_token=? AND verification_state='verified' AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)",event.source_system,event.subject_ref,at,at);
      const earlier=this.row('SELECT id FROM inbox_event WHERE source_system=? AND source_stream=?',event.source_system,event.source_stream);
      const applicable=event.event_type==='medical.primary_recorded'&&link&&event.incident_ref&&!earlier;
      const state=applicable?'applied':!link||!event.incident_ref||earlier?'pending_review':'pending_8b';
      this.run('INSERT INTO inbox_event VALUES (?,?,?,?,?,?,?,?,?,?,?)',inbox,event.source_system,event.event_id,event.source_stream,event.source_version,event.source_order,event.event_type,digest,at,JSON.stringify(event),state);
      if(!applicable){
        this.run('INSERT INTO review_item VALUES (?,?,?,?,?,?,?)',id(),null,inbox,state==='pending_8b'?'handler_pending_8b':'identity_incident_or_revision_review','demo-source-review','open',null);
        this.audit('event_validate','pending',event.source_system,event.event_id,now);
        return {http:202,status:state,business_applied:false};
      }
      let c=this.row('SELECT id,revision FROM wound_case WHERE subject_id=? AND incident_namespace=? AND incident_ref=?',link.subject_id??null,event.source_system,event.incident_ref);
      if(!c){const caseId=id();this.run('INSERT INTO wound_case VALUES (?,?,?,?,?,?,?,?,?)',caseId,link.subject_id??null,event.source_system,event.incident_ref,'medical_event',null,'unknown','source_linked',1);c={id:caseId,revision:1};}
      else this.run("UPDATE wound_case SET lifecycle_state=CASE WHEN lifecycle_state='administrative_open' THEN 'source_linked' ELSE lifecycle_state END,revision=revision+1 WHERE id=?",c.id??null);
      const caseId=text(c,'id'),ce=id();
      this.run('INSERT INTO case_event VALUES (?,?,?,?,?,?,?,?,?,?,?)',ce,caseId,inbox,null,event.event_type,event.occurred_at,event.recorded_at,event.source_system,event.source_version,'simulated_source',null);
      const assignment=this.row("SELECT unit_ref FROM unit_assignment WHERE subject_id=? AND verification_state='verified' AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)",link.subject_id??null,at,at);
      this.run('INSERT OR IGNORE INTO task VALUES (?,?,?,?,?,?,?,?,?)',id(),caseId,'confirm_receipt_date','support',assignment?.unit_ref??'demo-source-review','open',null,'demo-primary:'+caseId,null);
      this.run('INSERT INTO outbox VALUES (?,?,?,?,?,?,?,?,?)',id(),ce,'project_case','demo-local-projection',event.source_system+':'+event.event_id,JSON.stringify({case_id:caseId}),0,at,'pending');
      this.audit('event_validate','accepted',event.source_system,event.event_id,now);
      return {http:202,status:'accepted',business_applied:true};
    });
  }
  dispatchLocalOutbox():void {
    this.transaction(()=>{
      // Проєкції читають актуальну БД; worker підтверджує лише локальне повідомлення, без зовнішньої доставки.
      for(const item of this.rows("SELECT id FROM outbox WHERE state='pending' AND destination_ref='demo-local-projection' AND attempt_count<3 LIMIT 10"))this.run("UPDATE outbox SET state='delivered_local',attempt_count=attempt_count+1 WHERE id=?",item.id??null);
    });
  }
}
