import {randomUUID,createHash} from 'node:crypto';
import {Denied,checkCase,type EventEnvelope,type Session} from '../security/core.js';
import type {Store} from './store.js';
import {calendarDays,calendarMonths,kyivDate} from './calendar.js';
import type {SQLInputValue} from 'node:sqlite';
export class ReviewRequired extends Error {constructor(readonly reason:string){super(reason);}}
export const uid=()=>`demo-${randomUUID()}`;
export const sources=['demo-mis','demo-sedo','demo-vlk','demo-finance','demo-service','demo-civil-mis'];
export function insert(s:Store,table:string,row:Record<string,SQLInputValue>):void {const cols=Object.keys(row);s.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`,...Object.values(row));}
const str=(p:Record<string,unknown>,key:string)=>typeof p[key]==='string'?String(p[key]):'';
export function task(s:Store,c:string,kind:string,owner:string,trigger:string):void {
 const scope=s.row("SELECT u.unit_ref FROM wound_case c JOIN unit_assignment u ON u.subject_id=c.subject_id WHERE c.id=? AND u.verification_state='verified' AND u.valid_to IS NULL",c)?.unit_ref??'demo-source-review';
 s.run('INSERT OR IGNORE INTO task(id,case_id,kind,owner_role,owner_scope,status,trigger_ref) VALUES (?,?,?,?,?,?,?)',uid(),c,kind,owner,scope,'open',trigger);
}
export function eventLog(s:Store,c:string,type:string,payload:Record<string,unknown>,now:number,inbox:string|null=null,source='demo-user',version='command',occurred:string|null=null,command:string|null=null):string {
 const id=uid();insert(s,'case_event',{id,case_id:c,inbox_event_id:inbox,command_id:command,event_type:type,occurred_at:occurred,recorded_at:new Date(now).toISOString(),source_ref:source,source_version:version,assurance:inbox?'simulated_source':'demo_command',minimal_payload:JSON.stringify(payload)});return id;
}
function queue(s:Store,c:string,ce:string,key:string):void {insert(s,'outbox',{id:uid(),case_event_id:ce,action_type:'project_case',destination_ref:'demo-local-projection',idempotency_key:key,minimal_payload:JSON.stringify({case_id:c}),attempt_count:0,next_attempt_at:null,state:'pending'});}
export function requirements(s:Store,c:string,route:string,packet:string,revision='v1'):void {
 const rule=route==='vlk'?'demo-rule-checklist':'demo-rule-'+route;
 const kinds=route==='ogd'?['trauma_certificate','vlk_decision']:['primary_medical_card','trauma_certificate'];
 for(const kind of kinds){if(s.row('SELECT id FROM case_requirement WHERE case_id=? AND route=? AND packet_ref=? AND packet_revision=? AND document_kind=?',c,route,packet,revision,kind))continue;
  const r=uid();insert(s,'case_requirement',{id:r,case_id:c,route,packet_ref:packet,packet_revision:revision,rule_version_id:rule,document_kind:kind,instance_scope:'demo-case',applicability_state:'applicable',status:'missing'});
  for(const d of s.rows("SELECT id FROM document_ref WHERE case_id=? AND kind=? AND active=1",c,kind))s.run('INSERT OR IGNORE INTO requirement_evidence VALUES (?,?,?,?,?,?)',uid(),c,r,d.id??null,'technical_match','demo-existing-document');
 }
}
function evidence(s:Store,c:string,doc:string,kind:string,proof:string):void {
 for(const r of s.rows('SELECT id FROM case_requirement WHERE case_id=? AND document_kind=?',c,kind))s.run('INSERT OR IGNORE INTO requirement_evidence VALUES (?,?,?,?,?,?)',uid(),c,r.id??null,doc,'technical_match',proof);
}
function doc(s:Store,c:string,source:string,ref:string,version:string,kind:string,state:string,supersedes:string|null=null):string {
 const old=s.row('SELECT id FROM document_ref WHERE case_id=? AND source_system=? AND source_record_ref=? AND document_version=?',c,source,ref,version);
 if(old){const actual=s.row('SELECT kind,active,state FROM document_ref WHERE id=?',old.id??null)!;if(actual.kind!==kind||actual.active!==1||(['issued','corrected'].includes(String(actual.state))&&state==='prepared'))throw new ReviewRequired('document_regression_or_kind_mismatch');s.run('UPDATE document_ref SET state=? WHERE id=?',state,old.id??null);return String(old.id);}
 const id=uid();insert(s,'document_ref',{id,case_id:c,source_system:source,source_record_ref:ref,document_version:version,kind,provenance:'source_reference',validation_state:'source_confirmed',classification:['primary_medical_card','medical_summary','hospital_stay_certificate','vlk_decision'].includes(kind)?'clinical_ref':'administrative',supersedes_id:supersedes,state,active:1});
 evidence(s,c,id,kind,'demo-source-document');return id;
}
function deadline(s:Store,c:string,rule:string,anchor:string|null,due:string|null,follow:string|null,status:string,applicability:string,ce:string):void {
 s.run(`INSERT INTO deadline(id,case_id,rule_version_id,anchor_event_id,anchor_date,due_date,applicability_state,anchor_status,provisional_follow_up_date,status,calculation_revision)
 VALUES (?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(case_id,rule_version_id) DO UPDATE SET anchor_event_id=excluded.anchor_event_id,anchor_date=excluded.anchor_date,due_date=excluded.due_date,applicability_state=excluded.applicability_state,anchor_status=excluded.anchor_status,provisional_follow_up_date=excluded.provisional_follow_up_date,status=excluded.status,calculation_revision=deadline.calculation_revision+1`,uid(),c,rule,ce,anchor,due,applicability,status,follow,due?'review_by_date':'clarify');
}
function certificateClock(s:Store,c:string,ce:string):void {
 const x=s.row('SELECT enemy_action,patient_received_at,source_recorded_at FROM wound_case WHERE id=?',c)!;
 const applies=x.enemy_action==='yes'?'applicable':x.enemy_action==='no'?'not_applicable':'unknown';
 const received=x.patient_received_at?kyivDate(String(x.patient_received_at)):null,recorded=x.source_recorded_at?kyivDate(String(x.source_recorded_at)):null;
 const confirmed=applies==='applicable'&&received;
 deadline(s,c,'demo-rule-certificate',confirmed?received:null,confirmed?calendarDays(received,5):null,applies==='applicable'&&!received&&recorded?calendarDays(recorded,5):null,confirmed?'confirmed':applies==='applicable'&&recorded?'estimated':'unknown',applies,ce);
 if(!confirmed&&applies!=='not_applicable')task(s,c,'confirm_receipt_date','support','demo-certificate-anchor:'+c);
}
export function applyEvent(s:Store,e:EventEnvelope,inbox:string,now:number,confirmedCase?:string):string {
 const at=new Date(now).toISOString(),p=e.payload;
 const link=s.row("SELECT subject_id FROM identity_link WHERE source_namespace=? AND source_subject_token=? AND verification_state='verified' AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)",e.source_system,e.subject_ref,at,at);
 if(!link)throw new ReviewRequired('unknown_identity');
 if(!e.incident_ref&&!confirmedCase)throw new ReviewRequired('missing_incident');
 let c=e.source_system==='demo-mis'?s.row("SELECT * FROM wound_case WHERE subject_id=? AND incident_namespace='demo-mis' AND incident_ref=?",link.subject_id??null,e.incident_ref):s.row('SELECT c.* FROM wound_case c JOIN incident_link l ON l.case_id=c.id WHERE l.source=? AND l.subject_id=? AND l.incident_ref=?',e.source_system,link.subject_id??null,e.incident_ref);
 if(confirmedCase){const target=s.row('SELECT * FROM wound_case WHERE id=? AND subject_id=?',confirmedCase,link.subject_id??null);if(!target||e.incident_ref!==null)throw new ReviewRequired('identity_incident_mismatch');c=target;}
 if(!c&&e.event_type!=='medical.primary_recorded')throw new ReviewRequired('unknown_incident');
 const cursor=s.row('SELECT version FROM source_cursor WHERE source=? AND stream=? AND event_type=?',e.source_system,e.source_stream,e.event_type);
 if(cursor&&e.source_version!==cursor.version&&e.supersedes_version!==cursor.version)throw new ReviewRequired('unproven_revision_order');
 if(!c){const id=uid();insert(s,'wound_case',{id,subject_id:link.subject_id??null,incident_namespace:'demo-mis',incident_ref:e.incident_ref,origin:'medical_event',injury_date:null,injury_date_assurance:'unknown',lifecycle_state:'source_linked',revision:1});c=s.row('SELECT * FROM wound_case WHERE id=?',id)!;}
 const caseId=String(c.id);
 const ce=eventLog(s,caseId,e.event_type,p,now,inbox,e.source_system,e.source_version,e.occurred_at);
 if(e.event_type==='medical.primary_recorded'){
  s.run("UPDATE wound_case SET source_linked=1,source_recorded_at=?,enemy_action=?,injury_date=COALESCE(?,injury_date),injury_date_assurance=CASE WHEN ? IS NULL THEN injury_date_assurance ELSE 'confirmed' END,lifecycle_state=CASE WHEN lifecycle_state='administrative_open' THEN 'source_linked' ELSE lifecycle_state END WHERE id=?",e.recorded_at,str(p,'enemy_action')||String(c.enemy_action),str(p,'injury_date')||null,str(p,'injury_date')||null,caseId);
  for(const route of ['vlk','reward','ogd'])requirements(s,caseId,route,String(s.row('SELECT packet_ref FROM route_packet WHERE case_id=? AND route=?',caseId,route)?.packet_ref??s.row('SELECT packet_ref FROM case_requirement WHERE case_id=? AND route=? LIMIT 1',caseId,route)?.packet_ref??`demo-${route}-packet-`+caseId.slice(-2)));
  s.run("UPDATE task SET status='resolved',resolution_code='primary_source_confirmed' WHERE case_id=? AND kind='await_primary_source'",caseId);
  doc(s,caseId,e.source_system,e.source_record_ref,str(p,'document_version'),'primary_medical_card','recorded');certificateClock(s,caseId,ce);
  task(s,caseId,'prepare_certificate','medical_service','demo-cert-prepare:'+caseId);
 }else if(e.event_type==='source.sync_gap'){
  task(s,caseId,'reconcile_missing_event','support','demo-gap:'+e.source_system+':'+str(p,'expected_type')+':'+str(p,'expected_stream'));
 }else if(e.event_type.startsWith('care.')){
  if(!e.episode_ref||!s.row('SELECT id FROM demo_provider WHERE id=?',str(p,'provider_ref')))throw new ReviewRequired('unknown_episode_or_provider');
  const date=str(p,'date')||null;
  if(e.event_type==='care.start_confirmed'){
   const previous=s.row("SELECT minimal_payload FROM case_event WHERE case_id=? AND event_type='care.start_confirmed' AND id!=? ORDER BY rowid DESC LIMIT 1",caseId,ce);
   if(c.continuous_start&&date!==c.continuous_start&&(!previous||p.supersedes_anchor_evidence_ref!==JSON.parse(String(previous.minimal_payload)).evidence_ref))throw new ReviewRequired('care_anchor_correction_unproven');
   const applies=p.care_applicable===true?'applicable':p.care_applicable===false?'not_applicable':'unknown';
   s.run('UPDATE wound_case SET continuous_start=?,care_applicability=? WHERE id=?',date,applies,caseId);
   deadline(s,caseId,'demo-rule-care',date,date&&applies==='applicable'?calendarMonths(date,4):null,null,date?'confirmed':'unknown',applies,ce);
   if(date&&applies!=='unknown')s.run("UPDATE task SET status='resolved',resolution_code='source_anchor_confirmed' WHERE case_id=? AND kind='clarify_care_start'",caseId);
   if(!date||applies==='unknown')task(s,caseId,'clarify_care_start','support','demo-care-anchor:'+caseId);
  }else if(e.event_type==='care.discharged'){
   if(c.current_episode!==e.episode_ref)throw new ReviewRequired('episode_mismatch');
   s.run('UPDATE treatment_episode SET end_date=? WHERE case_id=? AND source_episode_ref=?',date,caseId,e.episode_ref);s.run('UPDATE wound_case SET current_episode=NULL WHERE id=?',caseId);
  }else{
   if(e.event_type==='care.transferred'&&(!p.previous_episode_ref||c.current_episode!==p.previous_episode_ref))throw new ReviewRequired('transfer_predecessor_missing');
   if(e.event_type==='care.admitted'&&c.current_episode&&c.current_episode!==e.episode_ref)throw new ReviewRequired('admission_conflict');
   if(c.current_episode&&c.current_episode!==e.episode_ref)s.run('UPDATE treatment_episode SET end_date=? WHERE case_id=? AND source_episode_ref=? AND end_date IS NULL',date,caseId,c.current_episode);
   const existing=s.row('SELECT case_id FROM treatment_episode WHERE source_system=? AND source_episode_ref=?',e.source_system,e.episode_ref);
   if(existing&&existing.case_id!==caseId)throw new ReviewRequired('episode_case_mismatch');
   if(!existing)insert(s,'treatment_episode',{id:uid(),case_id:caseId,source_system:e.source_system,source_episode_ref:e.episode_ref,provider_ref:str(p,'provider_ref'),start_date:date,end_date:null,evidence_ref:str(p,'evidence_ref'),assurance:date?'confirmed':'unknown'});
   s.run("UPDATE wound_case SET current_episode=?,lifecycle_state='care' WHERE id=?",e.episode_ref,caseId);
  }
 }else if(['document.prepared','document.issued','document.corrected','document.withdrawn'].includes(e.event_type)){
  const ref=str(p,'document_ref'),version=str(p,'document_version'),kind=str(p,'document_kind');
  if(p.enemy_action!==undefined){if(e.event_type!=='document.prepared'||kind!=='hospital_stay_certificate'||!['demo-mis','demo-civil-mis'].includes(e.source_system)||!p.applicability_evidence_ref)throw new ReviewRequired('hospital_context_proof_missing');s.run('UPDATE wound_case SET enemy_action=? WHERE id=?',str(p,'enemy_action'),caseId);certificateClock(s,caseId,ce);}
  if(e.event_type==='document.issued'){
   if(!s.row("SELECT id FROM case_event WHERE case_id=? AND event_type='command.issue_certificate'",caseId)||!s.row("SELECT id FROM document_ref WHERE case_id=? AND source_record_ref=? AND document_version=? AND state='prepared' AND source_system='demo-mis' AND kind='trauma_certificate'",caseId,ref,version))throw new ReviewRequired('issue_needs_preparation_and_command');
  }
  let previous:string|null=null;
  if(e.event_type==='document.corrected'){
   const old=s.row('SELECT id FROM document_ref WHERE case_id=? AND source_system=? AND source_record_ref=? AND document_version=? AND active=1',caseId,e.source_system,ref,str(p,'supersedes_document_version'));
   if(!old||version===p.supersedes_document_version)throw new ReviewRequired('correction_predecessor_missing');previous=String(old.id);s.run('UPDATE document_ref SET active=0 WHERE id=?',previous);
  }
  if(e.event_type==='document.withdrawn'){
   const old=s.row('SELECT id FROM document_ref WHERE case_id=? AND source_system=? AND source_record_ref=? AND document_version=?',caseId,e.source_system,ref,version);if(!old)throw new ReviewRequired('unknown_document');
   s.run("UPDATE document_ref SET active=0,state='withdrawn' WHERE id=?",old.id??null);task(s,caseId,'clarify_author','support','demo-withdrawn:'+String(old.id));
  }else doc(s,caseId,e.source_system,ref,version,kind,e.event_type==='document.prepared'?'prepared':e.event_type==='document.issued'?'issued':'corrected',previous);
  if(e.event_type==='document.prepared'&&kind==='trauma_certificate'){s.run("UPDATE task SET status='resolved',resolution_code='source_prepared' WHERE case_id=? AND kind='prepare_certificate'",caseId);task(s,caseId,'issue_certificate','commander','demo-cert-issue:'+caseId);}
  if(e.event_type==='document.issued'){s.run("UPDATE task SET status='resolved',resolution_code='source_confirmation' WHERE case_id=? AND kind='await_source_confirmation' AND trigger_ref IN (SELECT command_id FROM case_event WHERE case_id=? AND event_type='command.issue_certificate')",caseId,caseId);s.run("UPDATE document_ref SET active=0 WHERE case_id=? AND source_record_ref=? AND source_system='demo-mis' AND state='prepared'",caseId,ref);s.run("UPDATE task SET status='resolved',resolution_code='source_issued' WHERE case_id=? AND kind='issue_certificate'",caseId);task(s,caseId,'await_recipient_receipt','support','demo-cert-receipt:'+caseId);}
 }else if(e.event_type==='document.sent'){
  const d=s.row("SELECT id FROM document_ref WHERE case_id=? AND source_system=? AND source_record_ref=? AND document_version=? AND active=1 AND state IN ('issued','corrected')",caseId,e.source_system,str(p,'document_ref'),str(p,'document_version'));
  if(!d||!['demo-vlk','demo-finance','demo-part'].includes(str(p,'recipient_ref')))throw new ReviewRequired('dispatch_document_or_recipient_unknown');
  s.run(`INSERT INTO delivery(id,document_ref_id,recipient_ref,delivery_kind,sent_at,state) VALUES (?,?,?,'electronic',?,'sent') ON CONFLICT(document_ref_id,recipient_ref,delivery_kind) DO UPDATE SET sent_at=excluded.sent_at,state=CASE WHEN delivery.received_at IS NULL THEN 'sent' ELSE 'received' END`,uid(),d.id??null,str(p,'recipient_ref'),str(p,'sent_at'));
 }else if(e.event_type==='document.received'){
  const docs=s.rows("SELECT * FROM document_ref WHERE case_id=? AND source_record_ref=? AND document_version=? AND active=1 AND provenance='source_reference' ORDER BY CASE WHEN state IN ('issued','corrected') THEN 0 ELSE 1 END",caseId,str(p,'document_ref'),str(p,'document_version'));
  const d=docs[0];if(d?.kind==='trauma_certificate'&&!['issued','corrected'].includes(String(d.state)))throw new ReviewRequired('receipt_before_issue');if(!d)throw new ReviewRequired('receipt_unknown_version');
  if(p.recipient_kind==='servicemember'&&p.recipient_ref!==c.subject_id)throw new ReviewRequired('receipt_wrong_person');
  if(p.recipient_kind!=='servicemember'&&p.recipient_ref!==({vlk:'demo-vlk',finance:'demo-finance',part:'demo-part'} as Record<string,string>)[str(p,'recipient_kind')])throw new ReviewRequired('receipt_wrong_recipient');
  s.run(`INSERT INTO delivery(id,document_ref_id,recipient_ref,delivery_kind,sent_at,received_at,receipt_ref,state) VALUES (?,?,?,'electronic',NULL,?,?,'received')
   ON CONFLICT(document_ref_id,recipient_ref,delivery_kind) DO UPDATE SET received_at=excluded.received_at,receipt_ref=excluded.receipt_ref,state='received'`,uid(),d.id??null,str(p,'recipient_ref'),str(p,'received_at'),str(p,'evidence_ref'));
  if(p.recipient_kind==='vlk')s.run("UPDATE task SET status='resolved',resolution_code='receipt_confirmed' WHERE case_id=? AND kind='await_recipient_receipt'",caseId);
  if(p.recipient_kind==='servicemember'&&(d.kind==='primary_medical_card'||(d.kind==='hospital_stay_certificate'&&!s.row("SELECT id FROM document_ref WHERE case_id=? AND kind='primary_medical_card' AND active=1",caseId)))){
   s.run('UPDATE wound_case SET patient_received_at=? WHERE id=?',str(p,'received_at'),caseId);certificateClock(s,caseId,ce);s.run("UPDATE task SET status='resolved',resolution_code='receipt_confirmed' WHERE case_id=? AND kind='confirm_receipt_date'",caseId);
  }
 }else if(e.event_type==='referral.issued'){
  if(p.issuer_ref!=='demo-commander'||!s.row("SELECT id FROM case_event WHERE case_id=? AND event_type='command.refer_vlk'",caseId))throw new ReviewRequired('referral_needs_command');
  s.run("UPDATE task SET status='resolved',resolution_code='source_confirmation' WHERE case_id=? AND kind='await_source_confirmation' AND trigger_ref IN (SELECT command_id FROM case_event WHERE case_id=? AND event_type='command.refer_vlk')",caseId,caseId);
  doc(s,caseId,e.source_system,str(p,'document_ref'),str(p,'document_version'),'referral','issued');s.run("UPDATE wound_case SET lifecycle_state='vlk' WHERE id=?",caseId);task(s,caseId,'await_vlk_receipt','support','demo-vlk-receipt:'+caseId);
 }else if(e.event_type==='vlk.package_received'||e.event_type==='vlk.package_returned'||e.event_type==='finance.package_received'){
  const route=e.source_system==='demo-vlk'?'vlk':str(p,'kind'),packet=str(p,'packet_ref'),revision=str(p,'packet_revision');
  const old=s.row('SELECT revision,period,state FROM route_packet WHERE case_id=? AND route=? AND packet_ref=?',caseId,route,packet);
  if(e.event_type.endsWith('returned')&&!old)throw new ReviewRequired('return_without_receipt');
  if(old&&old.period&&p.period!==old.period)throw new ReviewRequired('packet_period_mismatch');
  if(old&&old.revision!==revision&&p.supersedes_revision!==old.revision)throw new ReviewRequired('packet_revision_order_unknown');
  if(p.recipient_ref!==(route==='vlk'?'demo-vlk':'demo-finance'))throw new ReviewRequired('packet_recipient_mismatch');
  s.run(`INSERT INTO route_packet(case_id,route,packet_ref,revision,received_at,reason,state,period) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(case_id,route,packet_ref) DO UPDATE SET revision=excluded.revision,received_at=COALESCE(route_packet.received_at,excluded.received_at),reason=excluded.reason,state=excluded.state`,caseId,route,packet,revision,str(p,'confirmed_at'),str(p,'reason_code')||'received',e.event_type.endsWith('returned')?'returned':'received',str(p,'period')||null);
  requirements(s,caseId,route,packet,revision);
  if(route==='vlk'&&!e.event_type.endsWith('returned'))s.run("UPDATE task SET status='resolved',resolution_code='packet_received' WHERE case_id=? AND kind='await_vlk_receipt'",caseId);
  if(e.event_type.endsWith('returned'))task(s,caseId,'clarify_author','support','demo-return:'+route+':'+packet+':'+revision);
 }else if(e.event_type==='vlk.decision_recorded'){
  if(!s.row("SELECT packet_ref FROM route_packet WHERE case_id=? AND route='vlk' AND state='received'",caseId))throw new ReviewRequired('decision_without_packet_receipt');
  doc(s,caseId,e.source_system,str(p,'document_ref'),str(p,'document_version'),'vlk_decision','recorded');
  if(p.service_code==='clarification_needed')task(s,caseId,'clarify_author','support','demo-vlk-decision-clarify:'+e.event_id);else{
  s.run("UPDATE wound_case SET lifecycle_state='service_action' WHERE id=?",caseId);task(s,caseId,'next_service_action','commander','demo-service-action:'+caseId);}
 }else if(e.event_type==='service.action_confirmed'){
  if(!s.row("SELECT id FROM case_event WHERE case_id=? AND event_type='vlk.decision_recorded' AND json_extract(minimal_payload,'$.service_code')='next_service_action' ORDER BY rowid DESC LIMIT 1",caseId))throw new ReviewRequired('service_without_decision');
  s.run("UPDATE task SET status='resolved',resolution_code='source_execution_confirmed' WHERE case_id=? AND kind='next_service_action'",caseId);
 }else if(e.event_type==='finance.status_recorded'){
  const kind=str(p,'kind'),period=str(p,'period'),start=period+'-01',end=calendarDays(calendarMonths(start,1),-1),status=str(p,'status');
  const packet=s.row('SELECT packet_ref FROM route_packet WHERE case_id=? AND route=? AND packet_ref=? AND period=?',caseId,kind,str(p,'packet_ref'),str(p,'period'));if(!packet)throw new ReviewRequired('finance_without_packet_receipt');
  const prior=s.row('SELECT current_status,decision_ref FROM financial_track WHERE case_id=? AND payment_kind=? AND period_start=?',caseId,kind,start);
  if(status!=='unknown'&&prior?.decision_ref&&p.previous_decision_ref!==prior.decision_ref)throw new ReviewRequired('financial_revision_order_unknown');
  if(prior?.current_status==='execution_partial'&&!['execution_confirmed','unknown'].includes(status))throw new ReviewRequired('execution_regression');
  if(['execution_partial','execution_confirmed'].includes(status)&&!['approved','execution_partial'].includes(String(prior?.current_status)))throw new ReviewRequired('execution_without_approval');
  if(prior?.current_status==='execution_confirmed'&&status!=='unknown')throw new ReviewRequired('completed_period_revision_review');
  if(status==='unknown'&&prior?.decision_ref){task(s,caseId,'clarify_finance','support','demo-finance-unknown:'+kind+':'+period);}else{
  s.run(`INSERT INTO financial_track(id,case_id,payment_kind,period_start,period_end,current_status,reason_code,decision_ref,execution_ref,source_version,packet_ref,source_system,decision_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(case_id,payment_kind,period_start,period_end) DO UPDATE SET current_status=excluded.current_status,reason_code=excluded.reason_code,decision_ref=excluded.decision_ref,execution_ref=excluded.execution_ref,source_version=excluded.source_version,packet_ref=excluded.packet_ref,source_system=excluded.source_system,decision_at=excluded.decision_at`,uid(),caseId,kind,start,end,status,str(p,'reason_code'),str(p,'decision_ref'),status.startsWith('execution_')?str(p,'evidence_ref'):null,e.source_version,str(p,'packet_ref'),e.source_system,e.occurred_at);
  if(['returned','denied','unknown'].includes(status))task(s,caseId,'clarify_finance','support','demo-finance:'+kind+':'+period+':'+status);
  else s.run("UPDATE task SET status='resolved',resolution_code='source_finance_confirmed' WHERE case_id=? AND kind='clarify_finance' AND (trigger_ref LIKE ? OR trigger_ref LIKE ?)",caseId,'demo-finance:'+kind+':'+period+':%','demo-finance-unknown:'+kind+':'+period);
  }
 }else throw new ReviewRequired('unsupported_type');
 s.run("UPDATE task SET status='resolved',resolution_code='source_signal_recovered' WHERE case_id=? AND kind='reconcile_missing_event' AND trigger_ref=?",caseId,'demo-gap:'+e.source_system+':'+e.event_type+':'+e.source_stream);
 s.run(`INSERT INTO source_cursor VALUES (?,?,?,?) ON CONFLICT(source,stream,event_type) DO UPDATE SET version=excluded.version`,e.source_system,e.source_stream,e.event_type,e.source_version);
 s.run("UPDATE wound_case SET revision=revision+1,freshness_state=CASE WHEN EXISTS(SELECT 1 FROM review_item WHERE case_id=? AND state='open') THEN 'conflict' WHEN EXISTS(SELECT 1 FROM task WHERE case_id=wound_case.id AND status='open' AND (kind='reconcile_missing_event' OR trigger_ref LIKE 'demo-finance-unknown:%')) THEN 'stale' ELSE 'fresh' END,last_source_at=? WHERE id=?",caseId,at,caseId);
 queue(s,caseId,ce,e.source_system+':'+e.event_id);return caseId;
}

export interface Command {id:string;case_id:string;action:string;option?:string}
export function command(s:Store,session:Session,input:Command,now:number):Record<string,unknown>{
 return s.transaction(()=>{
  const fresh=s.session(session.role,session.actorId,now);checkCase(fresh,input.case_id);
  const commander=['issue_certificate','refer_vlk'],support=['admin_open','clarify','gap','resolve_support','verify_copy','resolve_review'];
  if((commander.includes(input.action)&&session.role!=='commander')||(support.includes(input.action)&&!['support','commander'].includes(session.role))||(!commander.includes(input.action)&&!support.includes(input.action)&&!['copy','support_request'].includes(input.action)))throw new Denied(403,'command_forbidden');
  if(['copy','support_request'].includes(input.action)&&!['patient','support','commander'].includes(session.role))throw new Denied(403,'command_forbidden');
  const digest=createHash('sha256').update(JSON.stringify({id:input.id,case_id:input.case_id,action:input.action,option:input.option??null})).digest('hex'),old=s.row('SELECT actor,digest,outcome FROM demo_command WHERE id=?',input.id);
  if(old){if(old.actor!==session.actorId||old.digest!==digest)throw new Denied(409,'command_conflict');s.audit('command','duplicate',session.actorId,input.case_id,now,session.role);return {...JSON.parse(String(old.outcome)),duplicate:true};}
  let target=input.case_id;
  if(input.action==='admin_open'){
   if(target!=='demo-case-02'||input.option!=='primary_unavailable')throw new Denied(400,'reserve_fixture_only');
   target='demo-reserve-case';if(!s.row('SELECT id FROM wound_case WHERE id=?',target)){
    insert(s,'wound_case',{id:target,subject_id:'demo-person-02',incident_namespace:'demo-mis',incident_ref:'demo-reserve-02',origin:'administrative_request',injury_date:null,injury_date_assurance:'unknown',lifecycle_state:'administrative_open',revision:1});
    for(const source of sources)insert(s,'incident_link',{source,subject_id:'demo-person-02',incident_ref:'demo-reserve-02',case_id:target,proof:'demo-admin-identity-incident-check'});
    task(s,target,'await_primary_source','support','demo-reserve-primary');
   }
  }
  const ce=eventLog(s,target,'command.'+input.action,{action:input.action,option:input.option??null},now,null,'demo-user','command',new Date(now).toISOString(),input.id);
  if(input.action==='issue_certificate'||input.action==='refer_vlk')task(s,target,'await_source_confirmation','support',input.id);
  else if(input.action==='copy'){
   if(!['trauma_certificate','wrong_kind'].includes(input.option??''))throw new Denied(400,'gallery_only');
   const docId=uid();insert(s,'document_ref',{id:docId,case_id:target,source_system:'demo-gallery',source_record_ref:input.id,document_version:'gallery-v1',kind:'trauma_certificate',provenance:'manual_demo_copy',validation_state:input.option==='wrong_kind'?'wrong_kind':'pending',classification:'administrative',state:'copy',active:1});evidence(s,target,docId,'trauma_certificate','demo-gallery');
   task(s,target,input.option==='wrong_kind'?'clarify_author':'verify_demo_copy','support',input.id);
  }else if(input.action==='verify_copy'){
   s.run("UPDATE document_ref SET validation_state='technical_checked' WHERE case_id=? AND source_system='demo-gallery' AND validation_state='pending'",target);
   s.run("UPDATE task SET status='resolved',resolution_code='technical_copy_checked' WHERE case_id=? AND kind='verify_demo_copy'",target);
  }else if(input.action==='support_request')insert(s,'support_request',{id:uid(),case_id:target,category:input.option==='relative'?'relative_contact_without_access':'status_clarification',owner_scope:s.row("SELECT owner_scope FROM task WHERE case_id=? LIMIT 1",target)?.owner_scope??'demo-source-review',state:'open',result_code:null,authority_checked:0});
  else if(input.action==='resolve_support')s.run("UPDATE support_request SET state='resolved',result_code='clarification_prepared_for_authorized_channel' WHERE case_id=?",target);
  else if(input.action==='gap'){s.run("UPDATE wound_case SET freshness_state='stale' WHERE id=?",target);task(s,target,'reconcile_missing_event','support',input.id);}
  else if(input.action==='clarify')task(s,target,'clarify_author','support',input.id);
  else if(input.action==='resolve_review'){
   const review=s.row('SELECT * FROM review_item WHERE id=? AND state=?',input.option??'','open');if(!review||!s.row("SELECT u.id FROM unit_assignment u JOIN wound_case c ON c.subject_id=u.subject_id WHERE c.id=? AND u.unit_ref=? AND u.verification_state='verified' AND u.valid_to IS NULL",target,review.assigned_scope??null)||review.reason_code!=='missing_incident')throw new Denied(409,'source_review_required');
   const item=s.row('SELECT minimal_envelope FROM inbox_event WHERE id=?',review.inbox_event_id??null);if(!item)throw new Denied(404,'not_found');
   const event=JSON.parse(String(item.minimal_envelope)) as EventEnvelope;
   // Лише вже перевірена особа та явне підтвердження випадку; жодного fuzzy mapping.
   applyEvent(s,event,String(review.inbox_event_id),now,target);s.run("UPDATE inbox_event SET processing_state='applied' WHERE id=?",review.inbox_event_id??null);s.run("UPDATE review_item SET state='resolved',resolution_event_ref=?,case_id=? WHERE id=?",ce,target,review.id??null);s.run("UPDATE wound_case SET freshness_state=CASE WHEN EXISTS(SELECT 1 FROM review_item WHERE case_id=? AND state='open') THEN 'conflict' ELSE 'fresh' END WHERE id=?",target,target);
  }
  queue(s,target,ce,'command:'+input.id);const outcome={status:'recorded',case_id:target,source_confirmed:false};
  insert(s,'demo_command',{id:input.id,actor:session.actorId,case_id:target,digest,outcome:JSON.stringify(outcome)});s.audit('command','allowed',session.actorId,target,now,session.role);return outcome;
 });
}
