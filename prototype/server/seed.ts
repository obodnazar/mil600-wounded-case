import type { DatabaseSync } from 'node:sqlite';

export const DEMO_AS_OF='2026-11-13T12:00:00.000Z';
export const TRAUMA_CERTIFICATE='довідка про обставини травми (додаток 5 до Наказу №402)';
const start='2026-01-01T00:00:00.000Z', end='2027-01-01T00:00:00.000Z';
export function seed(db: DatabaseSync): void {
  if(db.prepare('SELECT id FROM seed_snapshot').get()) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const insert=(table:string,values:Record<string,string|number|null>)=>{
      const names=Object.keys(values);
      db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(()=>'?').join(',')})`).run(...Object.values(values));
    };
    for(let i=1;i<=3;i++) insert('demo_unit',{id:`demo-unit-${i}`,label:`Навчальна група ${['А','Б','В'][i-1]}`});
    for(let i=1;i<=9;i++) insert('demo_provider',{id:`demo-provider-${i}`,label:`Умовний заклад ${String(i).padStart(2,'0')}`});
    for(const profile of ['commander','support','analyst','dev']) {
      insert('subject',{id:`demo-${profile}`,demo_label:`Навчальна роль ${profile}`,state:'active'});
      insert('access_grant',{id:`demo-grant-${profile}`,actor_subject_id:`demo-${profile}`,role:profile,case_id:null,
        unit_ref:['commander','support'].includes(profile)?'demo-unit-1':null,purposes:'demo',valid_from:start,valid_to:end,revoked_at:null,authority_ref:'demo-authority'});
    }
    insert('rule_version',{id:'demo-rule-certificate',rule_key:'certificate-enemy-action',version:'demo-1',route:'certificate',applicability:'enemy_action_only',
      anchor_type:'servicemember_document_received',calendar_unit:'day',interval_value:5,legal_ref:'N16-art260',effective_from:'2026-01-01',effective_to:null,approval_state:'demo_fixture'});
    insert('rule_version',{id:'demo-rule-checklist',rule_key:'technical-checklist',version:'demo-1',route:'vlk',applicability:'synthetic_packet_only',
      anchor_type:'packet_snapshot',calendar_unit:'none',interval_value:1,legal_ref:'demo-not-legal-completeness',effective_from:'2026-01-01',effective_to:null,approval_state:'demo_fixture'});
    for(let i=1;i<=30;i++) {
      const n=String(i).padStart(2,'0'), person=`demo-person-${n}`, c=`demo-case-${n}`, unit=`demo-unit-${1+Math.floor((i-1)/10)}`;
      const state=['care','documents','vlk','service_action','finance','completed'][(i-1)%6] ?? 'care';
      insert('subject',{id:person,demo_label:`Навчальний учасник ${n}`,state:'active'});
      insert('identity_link',{id:`demo-link-${n}`,subject_id:person,source_namespace:'demo-mis',source_subject_token:person,
        verification_state:'verified',proof_ref:`demo-proof-${n}`,valid_from:start,valid_to:null});
      insert('unit_assignment',{id:`demo-assignment-${n}`,subject_id:person,unit_ref:unit,valid_from:start,valid_to:null,source_event_ref:`demo-assignment-proof-${n}`,verification_state:'verified'});
      insert('wound_case',{id:c,subject_id:person,incident_namespace:'demo-mis',incident_ref:`demo-incident-${n}`,origin:'medical_event',
        injury_date:i%7===0?null:'2026-10-20',injury_date_assurance:i%7===0?'unknown':'confirmed',lifecycle_state:state,revision:1});
      // Лише перший учасник має демо-вхід; супровід інших працює незалежно від входу бійця.
      if(i===1) insert('access_grant',{id:'demo-grant-patient',actor_subject_id:person,role:'patient',case_id:c,unit_ref:null,purposes:'demo',valid_from:start,valid_to:end,revoked_at:null,authority_ref:'demo-authority'});
      insert('treatment_episode',{id:`demo-episode-${n}`,case_id:c,source_system:'demo-mis',source_episode_ref:`demo-episode-ref-${n}`,provider_ref:`demo-provider-${1+(i-1)%9}`,
        start_date:i%7===0?null:'2026-10-21',end_date:state==='completed'?'2026-11-10':null,evidence_ref:`demo-care-proof-${n}`,assurance:i%7===0?'unknown':'confirmed'});
      insert('case_event',{id:`demo-seed-event-${n}`,case_id:c,inbox_event_id:null,command_id:null,event_type:'medical.primary_recorded',occurred_at:'2026-10-21T09:00:00.000Z',
        recorded_at:i%3===1?'2026-11-10T09:05:00.000Z':'2026-10-21T09:05:00.000Z',source_ref:'demo-mis',source_version:'seed-v1',assurance:'synthetic_seed',supersedes_id:null});
      const estimated=i%3===1, known=i%3===2;
      if(known)insert('case_event',{id:`demo-receipt-anchor-${n}`,case_id:c,inbox_event_id:null,command_id:null,event_type:'document.received',occurred_at:'2026-11-01T09:00:00.000Z',
        recorded_at:'2026-11-01T09:05:00.000Z',source_ref:'demo-service',source_version:'seed-v1',assurance:'synthetic_patient_receipt_fixture',supersedes_id:null});
      insert('deadline',{id:`demo-deadline-${n}`,case_id:c,rule_version_id:'demo-rule-certificate',anchor_event_id:known?`demo-receipt-anchor-${n}`:estimated?`demo-seed-event-${n}`:null,
        anchor_date:known?'2026-11-01':null,due_date:known?'2026-11-06':null,applicability_state:i%3===0?'unknown':'applicable',
        anchor_status:estimated?'estimated':known?'confirmed':'unknown',provisional_follow_up_date:estimated?'2026-11-15':null,status:known?'review_needed':'clarify',calculation_revision:1});
      insert('task',{id:`demo-task-${n}`,case_id:c,kind:known?'certificate_status_check':'confirm_receipt_date',owner_role:'support',owner_scope:unit,status:'open',deadline_id:`demo-deadline-${n}`,trigger_ref:`demo-seed-trigger-${n}`,resolution_code:null});
      for(const kind of ['primary_medical_card','trauma_certificate']) {
        const req=`demo-req-${kind}-${n}`, doc=`demo-doc-${kind}-${n}`;
        insert('case_requirement',{id:req,case_id:c,route:'vlk',packet_ref:`demo-packet-${n}`,packet_revision:'v1',rule_version_id:'demo-rule-checklist',document_kind:kind,
          instance_scope:'demo-episode-'+n,applicability_state:kind==='trauma_certificate'&&i%5===0?'unknown':'applicable',status:kind==='trauma_certificate'&&i%4===1?'missing':'present'});
        if(kind==='trauma_certificate'&&i%4===1) continue;
        insert('document_ref',{id:doc,case_id:c,source_system:kind==='primary_medical_card'?'demo-mis':'demo-sedo',source_record_ref:`demo-record-${kind}-${n}`,document_version:'v1',kind,
          provenance:i%8===0?'manual_demo_copy':'source_reference',validation_state:'technical_checked',classification:kind==='primary_medical_card'?'clinical_ref':'administrative',supersedes_id:null});
        insert('requirement_evidence',{id:`demo-evidence-${kind}-${n}`,case_id:c,case_requirement_id:req,document_ref_id:doc,evaluation_state:'technical_match',evidence_event_ref:`demo-seed-proof-${n}`});
        insert('delivery',{id:`demo-delivery-${kind}-${n}`,document_ref_id:doc,recipient_ref:'demo-vlk',delivery_kind:'electronic',sent_at:'2026-11-10T10:00:00.000Z',
          received_at:i%4===0?'2026-11-10T10:05:00.000Z':null,receipt_ref:i%4===0?`demo-receipt-${kind}-${n}`:null,state:i%4===0?'received':'sent'});
      }
      for(const kind of ['reward','ogd']) insert('financial_track',{id:`demo-finance-${kind}-${n}`,case_id:c,payment_kind:kind,period_start:'2026-11-01',period_end:'2026-11-30',
        current_status:kind==='reward'?'under_review':i%4===0?'returned':'unknown',reason_code:kind==='reward'?'documents_needed':i%4===0?'documents_needed':'not_available',decision_ref:null,execution_ref:null,source_version:'seed-v1'});
      if(i%4===0) insert('review_item',{id:`demo-review-${n}`,case_id:c,inbox_event_id:null,reason_code:'packet_returned',assigned_scope:unit,state:'open',resolution_event_ref:null});
    }
    insert('support_request',{id:'demo-support-request',case_id:'demo-case-01',category:'next_step',owner_scope:'demo-unit-1',state:'open',result_code:null,authority_checked:1});
    insert('staff_capacity',{id:'demo-capacity',staff_subject_id:'demo-support',reporting_scope:'demo-unit-1',period:'2026-11',fte:1,source_ref:'demo-capacity-proof'});
    insert('work_log',{id:'demo-work-log',case_id:'demo-case-01',staff_subject_id:'demo-support',work_date:'2026-11-12',minutes:15,activity_code:'document_coordination',source_ref:'demo-work-proof'});
    insert('seed_snapshot',{id:'demo-cohort-v1',definition_version:'seed-1',as_of:DEMO_AS_OF,patient_count:30});
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK'); throw error;}
}
