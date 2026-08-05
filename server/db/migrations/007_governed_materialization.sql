-- Forward-only preparation for independently reviewed, domain-specific fact materialization.
-- Depends on 006. It creates no browser/admin routes and never grants client roles direct fact access.
CREATE TABLE IF NOT EXISTS venture_private.materialization_requests (
  id text PRIMARY KEY,import_row_id text NOT NULL UNIQUE REFERENCES venture_private.governed_import_rows(id),
  domain text NOT NULL CHECK(domain IN ('crm','payment','directory')),
  requester_id text NOT NULL REFERENCES venture_private.users(id),executor_id text REFERENCES venture_private.users(id),
  fact_id text NOT NULL UNIQUE,idempotency_key_hash char(64) NOT NULL UNIQUE CHECK(idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  payload_digest char(64) NOT NULL CHECK(payload_digest ~ '^[0-9a-f]{64}$'),fact_payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'approved_for_execution' CHECK(status IN ('approved_for_execution','executing','applied','failed','compensated')),
  failure_code text,created_at timestamptz NOT NULL DEFAULT now(),executed_at timestamptz,compensated_at timestamptz,
  CHECK(jsonb_typeof(fact_payload)='object'),CHECK(requester_id<>executor_id)
);
CREATE TABLE IF NOT EXISTS venture_private.materialization_effects (
  request_id text PRIMARY KEY REFERENCES venture_private.materialization_requests(id),domain text NOT NULL CHECK(domain IN ('crm','payment','directory')),
  fact_id text NOT NULL UNIQUE,fact_status text NOT NULL CHECK(fact_status IN ('materialized','hidden_pending_publication','published','compensated')),
  applied_by text NOT NULL REFERENCES venture_private.users(id),applied_at timestamptz NOT NULL DEFAULT now(),
  compensated_by text REFERENCES venture_private.users(id),compensated_at timestamptz
);
CREATE TABLE IF NOT EXISTS venture_private.directory_publication_approvals (
  request_id text PRIMARY KEY REFERENCES venture_private.materialization_requests(id),profile_id text NOT NULL REFERENCES venture_private.public_directory_profiles(id),
  approver_id text NOT NULL REFERENCES venture_private.users(id),status text NOT NULL CHECK(status IN ('published','compensated')),
  approved_at timestamptz NOT NULL DEFAULT now(),compensated_at timestamptz
);
ALTER TABLE venture_private.materialization_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.materialization_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.materialization_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.materialization_effects FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.directory_publication_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.directory_publication_approvals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON venture_private.materialization_requests,venture_private.materialization_effects,venture_private.directory_publication_approvals FROM PUBLIC;

CREATE OR REPLACE VIEW public.venture_materialization_source WITH (security_barrier=true) AS
SELECT row.id AS row_id,row.batch_id,batch.domain,row.row_fingerprint,row.row_status,row.match_status,row.matched_user_id,
       row.reviewed_by AS row_reviewed_by,batch.actor_id AS batch_actor_id,row.validation_codes,row.safe_projection,row.protected_payload_ciphertext
FROM venture_private.governed_import_rows row JOIN venture_private.governed_import_batches batch ON batch.id=row.batch_id
WHERE row.row_status='matched' AND row.match_status='matched' AND row.matched_user_id IS NOT NULL AND jsonb_array_length(row.validation_codes)=0;

CREATE OR REPLACE VIEW public.venture_materialization_status WITH (security_barrier=true) AS
SELECT request.id AS request_id,row.id AS row_id,row.batch_id,request.domain,request.status,request.requester_id,request.executor_id,
       batch.actor_id AS batch_actor_id,row.reviewed_by AS row_reviewed_by,row.matched_user_id,request.fact_id,
       effect.fact_status,coalesce(approval.status,'not_applicable') AS directory_publication_status,request.created_at,request.executed_at
FROM venture_private.materialization_requests request
JOIN venture_private.governed_import_rows row ON row.id=request.import_row_id
JOIN venture_private.governed_import_batches batch ON batch.id=row.batch_id
LEFT JOIN venture_private.materialization_effects effect ON effect.request_id=request.id
LEFT JOIN venture_private.directory_publication_approvals approval ON approval.request_id=request.id;

REVOKE ALL ON public.venture_materialization_source,public.venture_materialization_status FROM PUBLIC;
DO $materialization_view_grants$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.venture_materialization_source,public.venture_materialization_status FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.venture_materialization_source,public.venture_materialization_status FROM authenticated; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT ON public.venture_materialization_source,public.venture_materialization_status TO service_role; END IF;
END $materialization_view_grants$;

CREATE OR REPLACE FUNCTION public.venture_request_materialization(p_request_id text,p_row_id text,p_requester_id text,p_fact_id text,p_idempotency_key_hash text,p_payload_digest text,p_fact_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$
DECLARE source record;existing venture_private.materialization_requests%ROWTYPE;allowed text[];
BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();
  SELECT row.*,batch.domain,batch.actor_id AS batch_actor_id INTO source FROM venture_private.governed_import_rows row JOIN venture_private.governed_import_batches batch ON batch.id=row.batch_id WHERE row.id=p_row_id FOR UPDATE OF row;
  IF NOT FOUND OR source.row_status<>'matched' OR source.match_status<>'matched' OR source.matched_user_id IS NULL OR jsonb_array_length(source.validation_codes)<>0 THEN RAISE EXCEPTION 'row not materializable'; END IF;
  IF p_requester_id IN (source.batch_actor_id,source.reviewed_by) THEN RAISE EXCEPTION 'separation of duties required'; END IF;
  SELECT * INTO existing FROM venture_private.materialization_requests WHERE idempotency_key_hash=p_idempotency_key_hash;
  IF FOUND THEN IF existing.import_row_id<>p_row_id OR existing.requester_id<>p_requester_id THEN RAISE EXCEPTION 'materialization idempotency conflict'; END IF;RETURN jsonb_build_object('request_id',existing.id,'status',existing.status,'reused',true);END IF;
  IF jsonb_typeof(p_fact_payload)<>'object' OR p_fact_payload->>'fact_id'<>p_fact_id OR p_fact_payload->>'user_id'<>source.matched_user_id THEN RAISE EXCEPTION 'materialization payload mismatch'; END IF;
  allowed:=CASE source.domain WHEN 'crm' THEN ARRAY['fact_id','user_id','verification_status','membership_start','membership_end','group_status','evidence_note_ciphertext'] WHEN 'payment' THEN ARRAY['fact_id','user_id','source','source_record_fingerprint','amount_band','refund_status','product_rule_status','evidence_status','occurred_at_ciphertext','protected_payload_ciphertext'] ELSE ARRAY['fact_id','user_id','member_reference_hash','public_display_name','organization','city','industry_tracks','interests','investment_stages','expertise','bio','collaboration_preferences','consent_status','contact_mode'] END;
  IF p_fact_payload - allowed <> '{}'::jsonb OR EXISTS(SELECT 1 FROM unnest(allowed) key WHERE NOT p_fact_payload ? key) THEN RAISE EXCEPTION 'materialization payload fields invalid'; END IF;
  IF source.domain='directory' AND (source.safe_projection->>'public_display_consent'<>'yes' OR source.safe_projection->>'contact_mode'<>'request_only' OR coalesce((source.safe_projection->>'eligibleForReview')::boolean,false)<>true OR p_fact_payload->>'consent_status'<>'granted' OR p_fact_payload->>'contact_mode'<>'request_only') THEN RAISE EXCEPTION 'directory consent or contact mode invalid'; END IF;
  INSERT INTO venture_private.materialization_requests(id,import_row_id,domain,requester_id,fact_id,idempotency_key_hash,payload_digest,fact_payload) VALUES(p_request_id,p_row_id,source.domain,p_requester_id,p_fact_id,p_idempotency_key_hash,p_payload_digest,p_fact_payload);
  INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary) VALUES('audit-'||md5(random()::text||clock_timestamp()::text),p_requester_id,'verified_admin','materialization.request','materialization_request',p_request_id,jsonb_build_object('domain',source.domain,'sensitive_data_included',false));
  RETURN jsonb_build_object('request_id',p_request_id,'status','approved_for_execution');
END $$;

CREATE OR REPLACE FUNCTION public.venture_execute_materialization(p_request_id text,p_executor_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$
DECLARE request venture_private.materialization_requests%ROWTYPE;source record;payload jsonb;fact_status text;
BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();
  SELECT * INTO request FROM venture_private.materialization_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR request.status<>'approved_for_execution' THEN RAISE EXCEPTION 'materialization request not executable'; END IF;
  SELECT row.*,batch.actor_id AS batch_actor_id INTO source FROM venture_private.governed_import_rows row JOIN venture_private.governed_import_batches batch ON batch.id=row.batch_id WHERE row.id=request.import_row_id FOR UPDATE OF row;
  IF p_executor_id IN (request.requester_id,source.batch_actor_id,source.reviewed_by) THEN RAISE EXCEPTION 'separation of duties required'; END IF;
  IF source.row_status<>'matched' OR source.match_status<>'matched' THEN RAISE EXCEPTION 'source review changed'; END IF;
  UPDATE venture_private.materialization_requests SET status='executing',executor_id=p_executor_id WHERE id=p_request_id;payload:=request.fact_payload;
  IF request.domain='crm' THEN
    IF payload->>'verification_status' NOT IN ('verified','needs_review','rejected') OR payload->>'group_status' NOT IN ('in_group','left','removed','unknown') OR (payload->>'membership_end')::timestamptz<=(payload->>'membership_start')::timestamptz THEN RAISE EXCEPTION 'invalid CRM fact'; END IF;
    INSERT INTO venture_private.crm_verifications(id,user_id,verification_status,membership_start,membership_end,group_status,evidence_note_ciphertext,reviewed_by,reviewed_at) VALUES(request.fact_id,payload->>'user_id',payload->>'verification_status',(payload->>'membership_start')::timestamptz,(payload->>'membership_end')::timestamptz,payload->>'group_status',payload->>'evidence_note_ciphertext',request.requester_id,now());fact_status:='materialized';
  ELSIF request.domain='payment' THEN
    IF payload->>'evidence_status' NOT IN ('verified','needs_review') OR payload->>'refund_status' NOT IN ('none','partial','full') OR (payload->>'evidence_status'='verified' AND (payload->>'refund_status'<>'none' OR payload->>'product_rule_status'<>'matched')) THEN RAISE EXCEPTION 'invalid payment fact'; END IF;
    INSERT INTO venture_private.payment_evidence(id,user_id,source,source_record_fingerprint,amount_band,refund_status,product_rule_status,evidence_status,occurred_at_ciphertext,protected_payload_ciphertext,reviewed_by,reviewed_at) VALUES(request.fact_id,payload->>'user_id',payload->>'source',payload->>'source_record_fingerprint',payload->>'amount_band',payload->>'refund_status',payload->>'product_rule_status',payload->>'evidence_status',payload->>'occurred_at_ciphertext',payload->>'protected_payload_ciphertext',request.requester_id,now());fact_status:='materialized';
  ELSE
    IF payload->>'consent_status'<>'granted' OR payload->>'contact_mode'<>'request_only' THEN RAISE EXCEPTION 'invalid directory fact'; END IF;
    INSERT INTO venture_private.public_directory_profiles(id,user_id,member_reference,public_display_name,organization,city,industry_tracks,interests,investment_stages,expertise,bio,collaboration_preferences,visibility,consent_status,review_status,contact_mode) VALUES(request.fact_id,payload->>'user_id','ref-'||substring(payload->>'member_reference_hash' from 1 for 24),payload->>'public_display_name',nullif(payload->>'organization',''),nullif(payload->>'city',''),payload->'industry_tracks',payload->'interests',payload->'investment_stages',payload->'expertise',nullif(payload->>'bio',''),payload->'collaboration_preferences','hidden','granted','pending_publication','request_only');fact_status:='hidden_pending_publication';
  END IF;
  UPDATE venture_private.governed_import_rows SET row_status='approved',updated_at=now() WHERE id=request.import_row_id;
  UPDATE venture_private.materialization_requests SET status='applied',executed_at=now() WHERE id=p_request_id;
  INSERT INTO venture_private.materialization_effects(request_id,domain,fact_id,fact_status,applied_by) VALUES(p_request_id,request.domain,request.fact_id,fact_status,p_executor_id);
  UPDATE venture_private.governed_import_batches batch SET status=CASE WHEN EXISTS(SELECT 1 FROM venture_private.governed_import_rows row WHERE row.batch_id=batch.id AND row.row_status NOT IN ('approved','rejected','skipped','rolled_back','excluded')) THEN 'partially_reviewed' ELSE 'completed' END,reviewed_at=now() WHERE batch.id=source.batch_id;
  INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary) VALUES('audit-'||md5(random()::text||clock_timestamp()::text),p_executor_id,'verified_admin','materialization.execute','materialization_request',p_request_id,jsonb_build_object('domain',request.domain,'fact_status',fact_status,'sensitive_data_included',false));
  RETURN jsonb_build_object('request_id',p_request_id,'status','applied','fact_status',fact_status);
END $$;

CREATE OR REPLACE FUNCTION public.venture_compensate_materialization(p_request_id text,p_actor_id text,p_reason_codes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$ DECLARE request venture_private.materialization_requests%ROWTYPE;BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();SELECT * INTO request FROM venture_private.materialization_requests WHERE id=p_request_id FOR UPDATE;
  IF jsonb_typeof(p_reason_codes)<>'array' OR jsonb_array_length(p_reason_codes)>12 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_reason_codes) code WHERE code !~ '^[a-z][a-z0-9_]{1,47}$') THEN RAISE EXCEPTION 'invalid compensation reason codes';END IF;
  IF NOT FOUND OR request.status<>'applied' OR p_actor_id=request.executor_id THEN RAISE EXCEPTION 'materialization not compensatable'; END IF;
  IF request.domain='crm' THEN UPDATE venture_private.crm_verifications SET verification_status='needs_review',group_status='unknown',updated_at=now() WHERE id=request.fact_id;
  ELSIF request.domain='payment' THEN UPDATE venture_private.payment_evidence SET evidence_status='excluded',product_rule_status='compensated',reviewed_by=p_actor_id,reviewed_at=now() WHERE id=request.fact_id;
  ELSE UPDATE venture_private.public_directory_profiles SET visibility='hidden',review_status='compensated',withdrawn_at=now() WHERE id=request.fact_id;UPDATE venture_private.directory_publication_approvals SET status='compensated',compensated_at=now() WHERE request_id=p_request_id;END IF;
  UPDATE venture_private.governed_import_rows SET row_status='needs_human_review',updated_at=now() WHERE id=request.import_row_id;
  UPDATE venture_private.governed_import_batches SET status='partially_reviewed',reviewed_at=now() WHERE id=(SELECT batch_id FROM venture_private.governed_import_rows WHERE id=request.import_row_id);
  UPDATE venture_private.materialization_requests SET status='compensated',compensated_at=now() WHERE id=p_request_id;UPDATE venture_private.materialization_effects SET fact_status='compensated',compensated_by=p_actor_id,compensated_at=now() WHERE request_id=p_request_id;
  INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary) VALUES('audit-'||md5(random()::text||clock_timestamp()::text),p_actor_id,'verified_admin','materialization.compensate','materialization_request',p_request_id,jsonb_build_object('domain',request.domain,'reason_codes',coalesce(p_reason_codes,'[]'::jsonb),'sensitive_data_included',false));RETURN jsonb_build_object('request_id',p_request_id,'status','compensated');
END $$;

CREATE OR REPLACE FUNCTION public.venture_approve_directory_publication(p_request_id text,p_approver_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$ DECLARE request venture_private.materialization_requests%ROWTYPE;source record;BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();SELECT * INTO request FROM venture_private.materialization_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR request.domain<>'directory' OR request.status<>'applied' THEN RAISE EXCEPTION 'directory request not publishable'; END IF;
  SELECT row.reviewed_by,batch.actor_id AS batch_actor_id INTO source FROM venture_private.governed_import_rows row JOIN venture_private.governed_import_batches batch ON batch.id=row.batch_id WHERE row.id=request.import_row_id;
  IF p_approver_id IN (request.requester_id,request.executor_id,source.reviewed_by,source.batch_actor_id) THEN RAISE EXCEPTION 'independent directory approval required'; END IF;
  UPDATE venture_private.public_directory_profiles SET visibility='visible',review_status='approved',reviewed_by=p_approver_id,reviewed_at=now() WHERE id=request.fact_id AND visibility='hidden' AND consent_status='granted' AND contact_mode='request_only';IF NOT FOUND THEN RAISE EXCEPTION 'directory consent or state changed';END IF;
  INSERT INTO venture_private.directory_publication_approvals(request_id,profile_id,approver_id,status) VALUES(p_request_id,request.fact_id,p_approver_id,'published');UPDATE venture_private.materialization_effects SET fact_status='published' WHERE request_id=p_request_id;
  INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary) VALUES('audit-'||md5(random()::text||clock_timestamp()::text),p_approver_id,'verified_admin','directory.publish','public_directory_profile',request.fact_id,jsonb_build_object('contact_mode','request_only','sensitive_data_included',false));RETURN jsonb_build_object('request_id',p_request_id,'status','published');
END $$;

REVOKE ALL ON FUNCTION public.venture_request_materialization(text,text,text,text,text,text,jsonb),public.venture_execute_materialization(text,text),public.venture_compensate_materialization(text,text,jsonb),public.venture_approve_directory_publication(text,text) FROM PUBLIC;
DO $materialization_rpc_grants$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON FUNCTION public.venture_request_materialization(text,text,text,text,text,text,jsonb),public.venture_execute_materialization(text,text),public.venture_compensate_materialization(text,text,jsonb),public.venture_approve_directory_publication(text,text) FROM anon;END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON FUNCTION public.venture_request_materialization(text,text,text,text,text,text,jsonb),public.venture_execute_materialization(text,text),public.venture_compensate_materialization(text,text,jsonb),public.venture_approve_directory_publication(text,text) FROM authenticated;END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT EXECUTE ON FUNCTION public.venture_request_materialization(text,text,text,text,text,text,jsonb),public.venture_execute_materialization(text,text),public.venture_compensate_materialization(text,text,jsonb),public.venture_approve_directory_publication(text,text) TO service_role;END IF;
END $materialization_rpc_grants$;
COMMENT ON TABLE venture_private.materialization_requests IS 'Server-only immutable materialization intent; payload contains allowlisted fields and ciphertext, never client data';
COMMENT ON TABLE venture_private.directory_publication_approvals IS 'Independent consent-preserving publication approval; CRM/payment cannot create this record';
