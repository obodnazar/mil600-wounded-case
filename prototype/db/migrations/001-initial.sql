CREATE TABLE demo_unit(id TEXT PRIMARY KEY, label TEXT NOT NULL) STRICT;
CREATE TABLE demo_provider(id TEXT PRIMARY KEY, label TEXT NOT NULL) STRICT;
CREATE TABLE subject(id TEXT PRIMARY KEY, demo_label TEXT NOT NULL, state TEXT NOT NULL) STRICT;
CREATE TABLE identity_link(
 id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subject(id), source_namespace TEXT NOT NULL,
 source_subject_token TEXT NOT NULL, verification_state TEXT NOT NULL CHECK(verification_state IN ('verified','pending','conflict')),
 proof_ref TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, CHECK(valid_to IS NULL OR valid_to>valid_from)
) STRICT;
CREATE UNIQUE INDEX identity_verified ON identity_link(source_namespace,source_subject_token) WHERE verification_state='verified' AND valid_to IS NULL;
CREATE TRIGGER identity_no_overlap BEFORE INSERT ON identity_link WHEN NEW.verification_state='verified' BEGIN
 SELECT RAISE(ABORT,'identity_overlap') WHERE EXISTS(SELECT 1 FROM identity_link x WHERE x.verification_state='verified' AND x.source_namespace=NEW.source_namespace AND x.source_subject_token=NEW.source_subject_token AND x.valid_from<COALESCE(NEW.valid_to,'9999') AND NEW.valid_from<COALESCE(x.valid_to,'9999'));
END;
CREATE TRIGGER identity_update_no_overlap BEFORE UPDATE ON identity_link WHEN NEW.verification_state='verified' BEGIN
 SELECT RAISE(ABORT,'identity_overlap') WHERE EXISTS(SELECT 1 FROM identity_link x WHERE x.id!=NEW.id AND x.verification_state='verified' AND x.source_namespace=NEW.source_namespace AND x.source_subject_token=NEW.source_subject_token AND x.valid_from<COALESCE(NEW.valid_to,'9999') AND NEW.valid_from<COALESCE(x.valid_to,'9999'));
END;
CREATE TABLE unit_assignment(
 id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subject(id), unit_ref TEXT NOT NULL REFERENCES demo_unit(id),
 valid_from TEXT NOT NULL, valid_to TEXT, source_event_ref TEXT NOT NULL,
 verification_state TEXT NOT NULL CHECK(verification_state IN ('verified','pending','conflict')), CHECK(valid_to IS NULL OR valid_to>valid_from)
) STRICT;
CREATE TRIGGER assignment_no_conflict BEFORE INSERT ON unit_assignment WHEN NEW.verification_state='verified' BEGIN
 SELECT RAISE(ABORT,'assignment_conflict') WHERE EXISTS(SELECT 1 FROM unit_assignment x WHERE x.verification_state='verified' AND x.subject_id=NEW.subject_id AND x.unit_ref!=NEW.unit_ref AND x.valid_from<COALESCE(NEW.valid_to,'9999') AND NEW.valid_from<COALESCE(x.valid_to,'9999'));
END;
CREATE TRIGGER assignment_update_no_conflict BEFORE UPDATE ON unit_assignment WHEN NEW.verification_state='verified' BEGIN
 SELECT RAISE(ABORT,'assignment_conflict') WHERE EXISTS(SELECT 1 FROM unit_assignment x WHERE x.id!=NEW.id AND x.verification_state='verified' AND x.subject_id=NEW.subject_id AND x.unit_ref!=NEW.unit_ref AND x.valid_from<COALESCE(NEW.valid_to,'9999') AND NEW.valid_from<COALESCE(x.valid_to,'9999'));
END;
CREATE TABLE wound_case(
 id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subject(id), incident_namespace TEXT NOT NULL,
 incident_ref TEXT, origin TEXT NOT NULL CHECK(origin IN ('medical_event','administrative_request')),
 injury_date TEXT, injury_date_assurance TEXT NOT NULL, lifecycle_state TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1)
) STRICT;
CREATE UNIQUE INDEX confirmed_incident ON wound_case(subject_id,incident_namespace,incident_ref) WHERE incident_ref IS NOT NULL;
CREATE TABLE access_grant(
 id TEXT PRIMARY KEY, actor_subject_id TEXT NOT NULL REFERENCES subject(id), role TEXT NOT NULL CHECK(role IN ('patient','commander','support','analyst','dev')),
 case_id TEXT REFERENCES wound_case(id), unit_ref TEXT REFERENCES demo_unit(id), purposes TEXT NOT NULL,
 valid_from TEXT NOT NULL, valid_to TEXT NOT NULL, revoked_at TEXT, authority_ref TEXT NOT NULL,
 CHECK(valid_to>valid_from), CHECK(NOT(case_id IS NOT NULL AND unit_ref IS NOT NULL)),
 CHECK((role IN ('analyst','dev') AND case_id IS NULL AND unit_ref IS NULL) OR (role IN ('patient','commander','support') AND (case_id IS NOT NULL OR unit_ref IS NOT NULL))),
 CHECK(role!='patient' OR case_id IS NOT NULL)
) STRICT;
CREATE TABLE treatment_episode(
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES wound_case(id), source_system TEXT NOT NULL,
 source_episode_ref TEXT NOT NULL, provider_ref TEXT REFERENCES demo_provider(id), start_date TEXT, end_date TEXT,
 evidence_ref TEXT NOT NULL, assurance TEXT NOT NULL, UNIQUE(source_system,source_episode_ref), CHECK(end_date IS NULL OR start_date IS NULL OR end_date>=start_date)
) STRICT;
CREATE TABLE inbox_event(
 id TEXT PRIMARY KEY, source_system TEXT NOT NULL, event_id TEXT NOT NULL, source_stream TEXT NOT NULL,
 source_version TEXT NOT NULL, source_order INTEGER CHECK(source_order IS NULL OR source_order>=0), event_type TEXT NOT NULL,
 semantic_digest TEXT NOT NULL, received_at TEXT NOT NULL, minimal_envelope TEXT NOT NULL CHECK(json_valid(minimal_envelope)),
 processing_state TEXT NOT NULL CHECK(processing_state IN ('applied','pending_review','pending_8b')),
 UNIQUE(source_system,event_id), UNIQUE(source_system,source_stream,source_version,event_type)
) STRICT;
CREATE TABLE case_event(
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES wound_case(id), inbox_event_id TEXT REFERENCES inbox_event(id), command_id TEXT,
 event_type TEXT NOT NULL, occurred_at TEXT, recorded_at TEXT NOT NULL, source_ref TEXT NOT NULL,
 source_version TEXT NOT NULL, assurance TEXT NOT NULL, supersedes_id TEXT,
 UNIQUE(id,case_id), FOREIGN KEY(supersedes_id,case_id) REFERENCES case_event(id,case_id)
) STRICT;
CREATE UNIQUE INDEX case_event_inbox ON case_event(inbox_event_id) WHERE inbox_event_id IS NOT NULL;
CREATE TABLE rule_version(
 id TEXT PRIMARY KEY, rule_key TEXT NOT NULL, version TEXT NOT NULL, route TEXT NOT NULL, applicability TEXT NOT NULL,
 anchor_type TEXT NOT NULL, calendar_unit TEXT NOT NULL, interval_value INTEGER NOT NULL CHECK(interval_value>0), legal_ref TEXT NOT NULL,
 effective_from TEXT NOT NULL, effective_to TEXT, approval_state TEXT NOT NULL, UNIQUE(rule_key,version)
) STRICT;
CREATE TABLE case_requirement(
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES wound_case(id), route TEXT NOT NULL, packet_ref TEXT NOT NULL,
 packet_revision TEXT NOT NULL, rule_version_id TEXT NOT NULL REFERENCES rule_version(id), document_kind TEXT NOT NULL,
 instance_scope TEXT NOT NULL, applicability_state TEXT NOT NULL CHECK(applicability_state IN ('applicable','not_applicable','unknown')), status TEXT NOT NULL,
 UNIQUE(case_id,route,packet_ref,packet_revision,rule_version_id,document_kind,instance_scope), UNIQUE(id,case_id)
) STRICT;
CREATE TABLE document_ref(
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES wound_case(id), source_system TEXT NOT NULL, source_record_ref TEXT NOT NULL,
 document_version TEXT NOT NULL, kind TEXT NOT NULL, provenance TEXT NOT NULL, validation_state TEXT NOT NULL,
 classification TEXT NOT NULL, supersedes_id TEXT,
 UNIQUE(case_id,source_system,source_record_ref,document_version), UNIQUE(id,case_id),
 FOREIGN KEY(supersedes_id,case_id) REFERENCES document_ref(id,case_id)
) STRICT;
CREATE TRIGGER requirement_composition_fixed BEFORE UPDATE OF case_id,route,packet_ref,packet_revision,rule_version_id,document_kind,instance_scope ON case_requirement BEGIN SELECT RAISE(ABORT,'immutable_packet_revision'); END;
CREATE TRIGGER requirement_no_delete BEFORE DELETE ON case_requirement BEGIN SELECT RAISE(ABORT,'immutable_packet_revision'); END;
CREATE TABLE requirement_evidence(
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL, case_requirement_id TEXT NOT NULL, document_ref_id TEXT NOT NULL,
 evaluation_state TEXT NOT NULL, evidence_event_ref TEXT NOT NULL,
 FOREIGN KEY(case_requirement_id,case_id) REFERENCES case_requirement(id,case_id),
 FOREIGN KEY(document_ref_id,case_id) REFERENCES document_ref(id,case_id), UNIQUE(case_requirement_id,document_ref_id)
) STRICT;
CREATE TABLE delivery(
 id TEXT PRIMARY KEY, document_ref_id TEXT NOT NULL REFERENCES document_ref(id), recipient_ref TEXT NOT NULL, delivery_kind TEXT NOT NULL,
 sent_at TEXT, received_at TEXT, receipt_ref TEXT, state TEXT NOT NULL CHECK(state IN ('sent','received','unknown')),
 CHECK(state!='received' OR (received_at IS NOT NULL AND receipt_ref IS NOT NULL)), UNIQUE(document_ref_id,recipient_ref,delivery_kind)
) STRICT;
CREATE TABLE deadline(
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES wound_case(id), rule_version_id TEXT NOT NULL REFERENCES rule_version(id),
 anchor_event_id TEXT REFERENCES case_event(id), anchor_date TEXT, due_date TEXT,
 applicability_state TEXT NOT NULL CHECK(applicability_state IN ('applicable','not_applicable','unknown')),
 anchor_status TEXT NOT NULL CHECK(anchor_status IN ('confirmed','estimated','unknown')), provisional_follow_up_date TEXT,
 status TEXT NOT NULL, calculation_revision INTEGER NOT NULL CHECK(calculation_revision>0),
 UNIQUE(id,case_id), FOREIGN KEY(anchor_event_id,case_id) REFERENCES case_event(id,case_id),
 CHECK(due_date IS NULL OR (anchor_status='confirmed' AND anchor_date IS NOT NULL AND applicability_state='applicable')),
 CHECK(anchor_status!='unknown' OR (anchor_date IS NULL AND due_date IS NULL)), UNIQUE(case_id,rule_version_id)
) STRICT;
CREATE TABLE task(
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES wound_case(id), kind TEXT NOT NULL, owner_role TEXT NOT NULL,
 owner_scope TEXT NOT NULL, status TEXT NOT NULL, deadline_id TEXT REFERENCES deadline(id), trigger_ref TEXT NOT NULL, resolution_code TEXT,
 UNIQUE(case_id,trigger_ref,kind,owner_role,owner_scope), FOREIGN KEY(deadline_id,case_id) REFERENCES deadline(id,case_id)
) STRICT;
CREATE TABLE financial_track(
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES wound_case(id), payment_kind TEXT NOT NULL CHECK(payment_kind IN ('reward','ogd')),
 period_start TEXT NOT NULL, period_end TEXT NOT NULL, current_status TEXT NOT NULL, reason_code TEXT NOT NULL,
 decision_ref TEXT, execution_ref TEXT, source_version TEXT NOT NULL, CHECK(period_end>=period_start),
 CHECK(current_status NOT IN ('executed','execution_confirmed','execution_partial') OR execution_ref IS NOT NULL),
 UNIQUE(case_id,payment_kind,period_start,period_end)
) STRICT;
CREATE TABLE support_request(
 id TEXT PRIMARY KEY, case_id TEXT REFERENCES wound_case(id), category TEXT NOT NULL, owner_scope TEXT NOT NULL, state TEXT NOT NULL,
 result_code TEXT, authority_checked INTEGER NOT NULL CHECK(authority_checked IN (0,1))
) STRICT;
CREATE TABLE review_item(
 id TEXT PRIMARY KEY, case_id TEXT REFERENCES wound_case(id), inbox_event_id TEXT REFERENCES inbox_event(id),
 reason_code TEXT NOT NULL, assigned_scope TEXT NOT NULL, state TEXT NOT NULL, resolution_event_ref TEXT,
 CHECK(case_id IS NOT NULL OR inbox_event_id IS NOT NULL)
) STRICT;
CREATE TABLE audit_entry(
 id TEXT PRIMARY KEY, actor_ref TEXT NOT NULL, role TEXT NOT NULL, action_code TEXT NOT NULL, opaque_object_ref TEXT NOT NULL,
 result_code TEXT NOT NULL, occurred_at TEXT NOT NULL, correlation_ref TEXT NOT NULL
) STRICT;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_entry BEGIN SELECT RAISE(ABORT,'append_only_audit'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_entry BEGIN SELECT RAISE(ABORT,'append_only_audit'); END;
CREATE TRIGGER event_no_update BEFORE UPDATE ON case_event BEGIN SELECT RAISE(ABORT,'append_only_events'); END;
CREATE TRIGGER event_no_delete BEFORE DELETE ON case_event BEGIN SELECT RAISE(ABORT,'append_only_events'); END;
CREATE TABLE outbox(
 id TEXT PRIMARY KEY, case_event_id TEXT REFERENCES case_event(id), action_type TEXT NOT NULL, destination_ref TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, minimal_payload TEXT NOT NULL CHECK(json_valid(minimal_payload)), attempt_count INTEGER NOT NULL CHECK(attempt_count>=0),
 next_attempt_at TEXT, state TEXT NOT NULL, UNIQUE(destination_ref,idempotency_key)
) STRICT;
CREATE TABLE staff_capacity(
 id TEXT PRIMARY KEY, staff_subject_id TEXT NOT NULL REFERENCES subject(id), reporting_scope TEXT NOT NULL, period TEXT NOT NULL,
 fte REAL CHECK(fte IS NULL OR fte>0), source_ref TEXT NOT NULL, UNIQUE(staff_subject_id,reporting_scope,period)
) STRICT;
CREATE TABLE work_log(
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES wound_case(id), staff_subject_id TEXT NOT NULL REFERENCES subject(id),
 work_date TEXT NOT NULL, minutes INTEGER NOT NULL CHECK(minutes>0), activity_code TEXT NOT NULL, source_ref TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE demo_session(
 token_hash TEXT PRIMARY KEY, actor_id TEXT REFERENCES subject(id), profile TEXT CHECK(profile IN ('patient','commander','support','analyst','dev')),
 csrf_hash TEXT NOT NULL, csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE transport_nonce(key_id TEXT NOT NULL, nonce_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(key_id,nonce_hash)) STRICT;
CREATE TABLE seed_snapshot(id TEXT PRIMARY KEY, definition_version TEXT NOT NULL, as_of TEXT NOT NULL, patient_count INTEGER NOT NULL) STRICT;
