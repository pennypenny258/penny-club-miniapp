-- Forward-only preparation for governed CRM/payment/directory imports and membership recomputation.
-- Depends on 004 identity entitlement and 005 service-role self-check. No runtime route is enabled here.
CREATE TABLE IF NOT EXISTS venture_private.governed_import_batches (
  id text PRIMARY KEY,
  domain text NOT NULL CHECK (domain IN ('crm','payment','directory')),
  status text NOT NULL DEFAULT 'staging' CHECK (status IN ('staging','private_review_pending','partially_reviewed','completed','rolled_back','failed')),
  actor_id text NOT NULL REFERENCES venture_private.users(id),
  idempotency_key_hash char(64) NOT NULL UNIQUE CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  csv_sha256 char(64) NOT NULL CHECK (csv_sha256 ~ '^[0-9a-f]{64}$'),
  total_rows integer NOT NULL CHECK (total_rows BETWEEN 0 AND 500),
  staged_rows integer NOT NULL DEFAULT 0 CHECK (staged_rows BETWEEN 0 AND 500),
  error_rows integer NOT NULL DEFAULT 0 CHECK (error_rows BETWEEN 0 AND 500),
  header_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
  CHECK (jsonb_typeof(header_codes)='array')
);

CREATE TABLE IF NOT EXISTS venture_private.governed_import_rows (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES venture_private.governed_import_batches(id),
  row_number integer NOT NULL CHECK (row_number >= 2),
  row_fingerprint char(64) NOT NULL CHECK (row_fingerprint ~ '^[0-9a-f]{64}$'),
  match_key_kind text NOT NULL CHECK (match_key_kind IN ('contact','member_reference')),
  match_key_hash char(64) CHECK (match_key_hash IS NULL OR match_key_hash ~ '^[0-9a-f]{64}$'),
  safe_projection jsonb NOT NULL DEFAULT '{}'::jsonb,
  protected_payload_ciphertext text NOT NULL,
  row_status text NOT NULL CHECK (row_status IN ('error','excluded','needs_human_review','matched','approved','rejected','skipped','rolled_back')),
  match_status text NOT NULL DEFAULT 'unresolved' CHECK (match_status IN ('unresolved','unique_candidate','conflict','matched','not_found','rejected')),
  matched_user_id text REFERENCES venture_private.users(id),
  validation_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  warning_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewed_by text REFERENCES venture_private.users(id), reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,row_number), UNIQUE(batch_id,row_fingerprint),
  CHECK (jsonb_typeof(safe_projection)='object'),
  CHECK (jsonb_typeof(validation_codes)='array'), CHECK (jsonb_typeof(warning_codes)='array')
);

CREATE TABLE IF NOT EXISTS venture_private.member_private_match_tokens (
  id text PRIMARY KEY,user_id text NOT NULL REFERENCES venture_private.users(id),
  token_kind text NOT NULL CHECK (token_kind IN ('contact','member_reference')),
  token_hash char(64) NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by text NOT NULL REFERENCES venture_private.users(id),created_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,
  UNIQUE(token_kind,token_hash,user_id)
);

CREATE TABLE IF NOT EXISTS venture_private.member_match_candidates (
  id bigserial PRIMARY KEY,
  import_row_id text NOT NULL REFERENCES venture_private.governed_import_rows(id) ON DELETE CASCADE,
  candidate_user_id text NOT NULL REFERENCES venture_private.users(id),
  confidence_bucket text NOT NULL CHECK (confidence_bucket IN ('exact_private_token','operator_confirmed','conflict')),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','selected','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(import_row_id,candidate_user_id),
  CHECK (jsonb_typeof(reason_codes)='array')
);

CREATE TABLE IF NOT EXISTS venture_private.membership_recompute_queue (
  id bigserial PRIMARY KEY, user_id text NOT NULL REFERENCES venture_private.users(id),
  trigger_domain text NOT NULL CHECK (trigger_domain IN ('account','crm','payment','group','manual')),
  safe_reason_code text NOT NULL CHECK (safe_reason_code ~ '^[a-z][a-z0-9_]{1,47}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS membership_recompute_one_pending_idx ON venture_private.membership_recompute_queue(user_id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS venture_private.membership_decision_snapshots (
  decision_id text PRIMARY KEY REFERENCES venture_private.membership_decisions(id),
  input_version text NOT NULL,
  account_active boolean NOT NULL, window_current boolean NOT NULL,
  crm_verified boolean NOT NULL, payment_verified boolean NOT NULL,
  payment_reviewed_at timestamptz, group_status text NOT NULL,
  refund_status text NOT NULL, conflict_present boolean NOT NULL,
  manual_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE venture_private.governed_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.governed_import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.governed_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.governed_import_rows FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.member_match_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.member_match_candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.member_private_match_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.member_private_match_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.membership_recompute_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.membership_recompute_queue FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.membership_decision_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.membership_decision_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON venture_private.governed_import_batches,venture_private.governed_import_rows,venture_private.member_private_match_tokens,venture_private.member_match_candidates,venture_private.membership_recompute_queue,venture_private.membership_decision_snapshots FROM PUBLIC;
REVOKE ALL ON SEQUENCE venture_private.member_match_candidates_id_seq,venture_private.membership_recompute_queue_id_seq FROM PUBLIC;

CREATE OR REPLACE FUNCTION venture_private.queue_membership_recompute() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$
DECLARE target_user text; target_domain text;
BEGIN
  IF TG_TABLE_NAME='users' THEN target_user:=NEW.id; ELSE target_user:=NEW.user_id; END IF;
  target_domain:=CASE TG_TABLE_NAME WHEN 'users' THEN 'account' WHEN 'payment_evidence' THEN 'payment' ELSE 'crm' END;
  INSERT INTO venture_private.membership_recompute_queue(user_id,trigger_domain,safe_reason_code)
  VALUES(target_user,target_domain,target_domain||'_fact_changed')
  ON CONFLICT (user_id) WHERE status='pending' DO UPDATE SET trigger_domain=EXCLUDED.trigger_domain,safe_reason_code=EXCLUDED.safe_reason_code,created_at=now();
  INSERT INTO venture_private.membership_decisions(id,user_id,crm_status,payment_evidence_status,expiry_status,group_status,final_status,reason_codes,decided_by)
  VALUES('decision-invalidated-'||md5(random()::text||clock_timestamp()::text),target_user,'needs_review','needs_review','needs_review','unknown','needs_review',jsonb_build_array(target_domain||'_fact_changed'),NULL);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_queue_membership_recompute ON venture_private.users;
CREATE TRIGGER users_queue_membership_recompute AFTER UPDATE OF account_status ON venture_private.users FOR EACH ROW EXECUTE FUNCTION venture_private.queue_membership_recompute();
DROP TRIGGER IF EXISTS crm_queue_membership_recompute ON venture_private.crm_verifications;
CREATE TRIGGER crm_queue_membership_recompute AFTER INSERT OR UPDATE OF verification_status,membership_start,membership_end,group_status ON venture_private.crm_verifications FOR EACH ROW EXECUTE FUNCTION venture_private.queue_membership_recompute();
DROP TRIGGER IF EXISTS payment_queue_membership_recompute ON venture_private.payment_evidence;
CREATE TRIGGER payment_queue_membership_recompute AFTER INSERT OR UPDATE OF evidence_status,product_rule_status,refund_status,reviewed_at ON venture_private.payment_evidence FOR EACH ROW EXECUTE FUNCTION venture_private.queue_membership_recompute();
REVOKE ALL ON FUNCTION venture_private.queue_membership_recompute() FROM PUBLIC;

CREATE OR REPLACE VIEW public.venture_governed_import_review_queue WITH (security_barrier=true) AS
SELECT row.id AS row_id,row.batch_id,batch.domain,row.row_number,row.row_status,row.match_status,
       row.validation_codes,row.warning_codes,count(candidate.id)::integer AS candidate_count,
       row.created_at,row.reviewed_at
FROM venture_private.governed_import_rows row
JOIN venture_private.governed_import_batches batch ON batch.id=row.batch_id
LEFT JOIN venture_private.member_match_candidates candidate ON candidate.import_row_id=row.id AND candidate.status='pending'
WHERE row.row_status IN ('error','needs_human_review','matched')
GROUP BY row.id,batch.domain;

CREATE OR REPLACE VIEW public.venture_membership_recompute_inputs WITH (security_barrier=true) AS
SELECT account.id AS user_id,
  account.account_status='active' AS account_active,
  coalesce(crm.membership_start IS NOT NULL AND crm.membership_end IS NOT NULL AND now()>=crm.membership_start AND now()<crm.membership_end,false) AS window_current,
  coalesce(crm.verification_status='verified',false) AS crm_verified,
  coalesce(crm.group_status,'unknown') AS group_status,
  coalesce(payment.evidence_status='verified' AND payment.product_rule_status='matched' AND payment.refund_status='none' AND payment.reviewed_at IS NOT NULL,false) AS payment_verified,
  payment.reviewed_at AS payment_reviewed_at,coalesce(payment.refund_status,'unknown') AS refund_status,
  EXISTS(SELECT 1 FROM venture_private.governed_import_rows row WHERE row.matched_user_id=account.id AND row.match_status='conflict' AND row.row_status IN ('needs_human_review','matched')) AS conflict_present,
  EXISTS(SELECT 1 FROM venture_private.membership_recompute_queue queue WHERE queue.user_id=account.id AND queue.status='pending') AS recompute_required,
  concat_ws(':',account.updated_at,crm.updated_at,payment.reviewed_at,payment.created_at) AS input_version
FROM venture_private.users account
LEFT JOIN LATERAL (SELECT verification_status,membership_start,membership_end,group_status,updated_at FROM venture_private.crm_verifications WHERE user_id=account.id ORDER BY reviewed_at DESC NULLS LAST,updated_at DESC LIMIT 1) crm ON true
LEFT JOIN LATERAL (SELECT evidence_status,product_rule_status,refund_status,reviewed_at,created_at FROM venture_private.payment_evidence WHERE user_id=account.id ORDER BY reviewed_at DESC NULLS LAST,created_at DESC LIMIT 1) payment ON true;

REVOKE ALL ON public.venture_governed_import_review_queue,public.venture_membership_recompute_inputs FROM PUBLIC;
DO $governed_import_view_grants$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.venture_governed_import_review_queue,public.venture_membership_recompute_inputs FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.venture_governed_import_review_queue,public.venture_membership_recompute_inputs FROM authenticated; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT ON public.venture_governed_import_review_queue,public.venture_membership_recompute_inputs TO service_role; END IF;
END $governed_import_view_grants$;

CREATE OR REPLACE FUNCTION public.venture_begin_governed_import(p_batch_id text,p_domain text,p_actor_id text,p_idempotency_key_hash text,p_csv_sha256 text,p_total_rows integer,p_header_codes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$ DECLARE existing venture_private.governed_import_batches%ROWTYPE; BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();
  SELECT * INTO existing FROM venture_private.governed_import_batches WHERE idempotency_key_hash=p_idempotency_key_hash;
  IF FOUND THEN
    IF existing.actor_id<>p_actor_id OR existing.domain<>p_domain OR existing.csv_sha256<>p_csv_sha256 THEN RAISE EXCEPTION 'idempotency key conflict'; END IF;
    RETURN jsonb_build_object('batch_id',existing.id,'status',existing.status,'reused',true);
  END IF;
  INSERT INTO venture_private.governed_import_batches(id,domain,actor_id,idempotency_key_hash,csv_sha256,total_rows,header_codes) VALUES(p_batch_id,p_domain,p_actor_id,p_idempotency_key_hash,p_csv_sha256,p_total_rows,coalesce(p_header_codes,'[]'::jsonb));
  RETURN jsonb_build_object('batch_id',p_batch_id,'status','staging');
END $$;

CREATE OR REPLACE FUNCTION public.venture_stage_governed_import_rows(p_batch_id text,p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$ DECLARE staged integer; errors integer; batch_status text; BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();
  SELECT status INTO batch_status FROM venture_private.governed_import_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'governed import batch missing'; END IF;
  IF batch_status<>'staging' THEN SELECT staged_rows,error_rows INTO staged,errors FROM venture_private.governed_import_batches WHERE id=p_batch_id; RETURN jsonb_build_object('batch_id',p_batch_id,'status',batch_status,'staged_rows',staged,'error_rows',errors,'reused',true); END IF;
  IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>500 THEN RAISE EXCEPTION 'invalid governed import row payload'; END IF;
  INSERT INTO venture_private.governed_import_rows(id,batch_id,row_number,row_fingerprint,match_key_kind,match_key_hash,safe_projection,protected_payload_ciphertext,row_status,validation_codes,warning_codes)
  SELECT x.row_id,p_batch_id,x.row_number,x.row_fingerprint,x.match_key_kind,x.match_key_hash,x.safe_projection,x.protected_payload_ciphertext,x.row_status,x.validation_codes,x.warning_codes
  FROM jsonb_to_recordset(p_rows) AS x(row_id text,row_number integer,row_fingerprint text,match_key_kind text,match_key_hash text,safe_projection jsonb,protected_payload_ciphertext text,row_status text,validation_codes jsonb,warning_codes jsonb);
  INSERT INTO venture_private.member_match_candidates(import_row_id,candidate_user_id,confidence_bucket,reason_codes)
  SELECT row.id,token.user_id,'exact_private_token',jsonb_build_array('private_token_match')
  FROM venture_private.governed_import_rows row JOIN venture_private.member_private_match_tokens token ON token.token_kind=row.match_key_kind AND token.token_hash=row.match_key_hash AND token.status='active'
  WHERE row.batch_id=p_batch_id AND row.row_status='needs_human_review' ON CONFLICT DO NOTHING;
  UPDATE venture_private.governed_import_rows row SET match_status=CASE matches.count WHEN 0 THEN 'not_found' WHEN 1 THEN 'unique_candidate' ELSE 'conflict' END,updated_at=now()
  FROM (SELECT staged.id,count(candidate.id)::integer AS count FROM venture_private.governed_import_rows staged LEFT JOIN venture_private.member_match_candidates candidate ON candidate.import_row_id=staged.id AND candidate.status='pending' WHERE staged.batch_id=p_batch_id GROUP BY staged.id) matches
  WHERE row.id=matches.id AND row.row_status='needs_human_review';
  SELECT count(*),count(*) FILTER(WHERE row_status='error') INTO staged,errors FROM venture_private.governed_import_rows WHERE batch_id=p_batch_id;
  UPDATE venture_private.governed_import_batches SET staged_rows=staged,error_rows=errors,status='private_review_pending' WHERE id=p_batch_id AND status='staging';
  RETURN jsonb_build_object('batch_id',p_batch_id,'status','private_review_pending','staged_rows',staged,'error_rows',errors);
END $$;

CREATE OR REPLACE FUNCTION public.venture_rollback_governed_import_batch(p_batch_id text,p_actor_id text,p_reason_codes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$ BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();
  UPDATE venture_private.governed_import_batches SET status='rolled_back',reviewed_at=now() WHERE id=p_batch_id AND status IN ('staging','private_review_pending','partially_reviewed');
  IF NOT FOUND THEN RAISE EXCEPTION 'batch not rollbackable'; END IF;
  UPDATE venture_private.governed_import_rows SET row_status='rolled_back',matched_user_id=NULL,updated_at=now() WHERE batch_id=p_batch_id AND row_status NOT IN ('approved','rolled_back');
  UPDATE venture_private.member_match_candidates SET status='rejected' WHERE import_row_id IN (SELECT id FROM venture_private.governed_import_rows WHERE batch_id=p_batch_id) AND status='pending';
  INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary) VALUES('audit-'||md5(random()::text||clock_timestamp()::text),p_actor_id,'verified_admin','governed_import.rollback','governed_import_batch',p_batch_id,jsonb_build_object('reason_codes',coalesce(p_reason_codes,'[]'::jsonb),'sensitive_data_included',false));
  RETURN jsonb_build_object('batch_id',p_batch_id,'status','rolled_back');
END $$;

CREATE OR REPLACE FUNCTION public.venture_review_governed_import_row(p_row_id text,p_reviewer_id text,p_decision text,p_matched_user_id text,p_reason_codes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$ DECLARE next_status text; next_match text; BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();
  IF p_decision NOT IN ('approve_match','reject','skip','rollback') THEN RAISE EXCEPTION 'invalid review decision'; END IF;
  IF p_decision='approve_match' AND p_matched_user_id IS NULL THEN RAISE EXCEPTION 'matched user required'; END IF;
  next_status:=CASE p_decision WHEN 'approve_match' THEN 'matched' WHEN 'reject' THEN 'rejected' WHEN 'skip' THEN 'skipped' ELSE 'rolled_back' END;
  next_match:=CASE p_decision WHEN 'approve_match' THEN 'matched' WHEN 'reject' THEN 'rejected' ELSE 'unresolved' END;
  UPDATE venture_private.governed_import_rows SET row_status=next_status,match_status=next_match,matched_user_id=CASE WHEN p_decision='approve_match' THEN p_matched_user_id ELSE NULL END,reviewed_by=p_reviewer_id,reviewed_at=now(),updated_at=now() WHERE id=p_row_id AND row_status IN ('error','needs_human_review','matched');
  IF NOT FOUND THEN RAISE EXCEPTION 'row not reviewable'; END IF;
  IF p_decision='approve_match' THEN
    INSERT INTO venture_private.member_match_candidates(import_row_id,candidate_user_id,confidence_bucket,reason_codes,status) VALUES(p_row_id,p_matched_user_id,'operator_confirmed',jsonb_build_array('operator_confirmed'),'selected') ON CONFLICT(import_row_id,candidate_user_id) DO UPDATE SET status='selected';
    UPDATE venture_private.member_match_candidates SET status='rejected' WHERE import_row_id=p_row_id AND candidate_user_id<>p_matched_user_id AND status='pending';
  END IF;
  INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary) VALUES('audit-'||md5(random()::text||clock_timestamp()::text),p_reviewer_id,'verified_admin','governed_import.review','governed_import_row',p_row_id,jsonb_build_object('decision',p_decision,'reason_codes',coalesce(p_reason_codes,'[]'::jsonb),'sensitive_data_included',false));
  RETURN jsonb_build_object('row_id',p_row_id,'status',next_status);
END $$;

CREATE OR REPLACE FUNCTION public.venture_record_membership_decision(p_decision_id text,p_user_id text,p_actor_id text,p_final_status text,p_reason_codes jsonb,p_input_version text,p_manual_approved boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,public,pg_catalog AS $$ DECLARE fact public.venture_membership_recompute_inputs%ROWTYPE; BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();
  IF p_final_status NOT IN ('active','needs_review','inactive') THEN RAISE EXCEPTION 'invalid membership decision'; END IF;
  SELECT * INTO fact FROM public.venture_membership_recompute_inputs WHERE user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'membership inputs missing'; END IF;
  IF p_input_version<>fact.input_version THEN RAISE EXCEPTION 'membership inputs changed'; END IF;
  IF p_final_status='active' AND (NOT p_manual_approved OR NOT fact.account_active OR NOT fact.window_current OR NOT fact.crm_verified OR fact.group_status<>'in_group' OR NOT fact.payment_verified OR fact.payment_reviewed_at IS NULL OR fact.refund_status<>'none' OR fact.conflict_present) THEN RAISE EXCEPTION 'membership activation preconditions not met'; END IF;
  INSERT INTO venture_private.membership_decisions(id,user_id,crm_status,payment_evidence_status,expiry_status,group_status,final_status,reason_codes,decided_by) VALUES(p_decision_id,p_user_id,CASE WHEN fact.crm_verified THEN 'verified' ELSE 'needs_review' END,CASE WHEN fact.payment_verified THEN 'verified' ELSE 'needs_review' END,CASE WHEN fact.window_current THEN 'current' ELSE 'not_current' END,fact.group_status,p_final_status,coalesce(p_reason_codes,'[]'::jsonb),p_actor_id);
  INSERT INTO venture_private.membership_decision_snapshots(decision_id,input_version,account_active,window_current,crm_verified,payment_verified,payment_reviewed_at,group_status,refund_status,conflict_present,manual_approved) VALUES(p_decision_id,fact.input_version,fact.account_active,fact.window_current,fact.crm_verified,fact.payment_verified,fact.payment_reviewed_at,fact.group_status,fact.refund_status,fact.conflict_present,p_manual_approved);
  UPDATE venture_private.membership_recompute_queue SET status='completed',completed_at=now() WHERE user_id=p_user_id AND status='pending';
  INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary) VALUES('audit-'||md5(random()::text||clock_timestamp()::text),p_actor_id,'verified_admin','membership.recompute','membership_decision',p_decision_id,jsonb_build_object('final_status',p_final_status,'reason_codes',coalesce(p_reason_codes,'[]'::jsonb),'sensitive_data_included',false));
  RETURN jsonb_build_object('decision_id',p_decision_id,'final_status',p_final_status);
END $$;

REVOKE ALL ON FUNCTION public.venture_begin_governed_import(text,text,text,text,text,integer,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.venture_stage_governed_import_rows(text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.venture_review_governed_import_row(text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.venture_rollback_governed_import_batch(text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.venture_record_membership_decision(text,text,text,text,jsonb,text,boolean) FROM PUBLIC;
DO $governed_import_rpc_grants$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.venture_begin_governed_import(text,text,text,text,text,integer,jsonb),public.venture_stage_governed_import_rows(text,jsonb),public.venture_review_governed_import_row(text,text,text,text,jsonb),public.venture_rollback_governed_import_batch(text,text,jsonb),public.venture_record_membership_decision(text,text,text,text,jsonb,text,boolean) FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.venture_begin_governed_import(text,text,text,text,text,integer,jsonb),public.venture_stage_governed_import_rows(text,jsonb),public.venture_review_governed_import_row(text,text,text,text,jsonb),public.venture_rollback_governed_import_batch(text,text,jsonb),public.venture_record_membership_decision(text,text,text,text,jsonb,text,boolean) FROM authenticated;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT EXECUTE ON FUNCTION public.venture_begin_governed_import(text,text,text,text,text,integer,jsonb),public.venture_stage_governed_import_rows(text,jsonb),public.venture_review_governed_import_row(text,text,text,text,jsonb),public.venture_rollback_governed_import_batch(text,text,jsonb),public.venture_record_membership_decision(text,text,text,text,jsonb,text,boolean) TO service_role;
  END IF;
END $governed_import_rpc_grants$;

COMMENT ON TABLE venture_private.governed_import_rows IS 'Private staged rows: safe projection plus server-encrypted sensitive payload; never expose to clients';
COMMENT ON VIEW public.venture_governed_import_review_queue IS 'Server-only redacted review queue; excludes contact values, raw orders and notes';
COMMENT ON VIEW public.venture_membership_recompute_inputs IS 'Server-only minimum facts for human-approved membership recomputation';
