-- Forward-only CRM master/import preparation. Do not run in anonymous staging.
-- Depends on recorded 004-009. It changes no existing business rows and exposes no client data.
BEGIN;

ALTER TABLE venture_private.governed_import_batches
  DROP CONSTRAINT IF EXISTS governed_import_batches_total_rows_check,
  DROP CONSTRAINT IF EXISTS governed_import_batches_staged_rows_check,
  DROP CONSTRAINT IF EXISTS governed_import_batches_error_rows_check;
ALTER TABLE venture_private.governed_import_batches
  ADD CONSTRAINT governed_import_batches_total_rows_check CHECK (total_rows BETWEEN 0 AND 10000),
  ADD CONSTRAINT governed_import_batches_staged_rows_check CHECK (staged_rows BETWEEN 0 AND 10000),
  ADD CONSTRAINT governed_import_batches_error_rows_check CHECK (error_rows BETWEEN 0 AND 10000);

CREATE TABLE IF NOT EXISTS venture_private.member_crm_master_profiles (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES venture_private.users(id),
  identity_profile_ciphertext text NOT NULL,
  renewal_terms_ciphertext text NOT NULL,
  membership_tier text CHECK (membership_tier IS NULL OR membership_tier IN ('angel_shareholder','a1_shareholder','a2_shareholder','honorary_director')),
  membership_expiry_month date CHECK (membership_expiry_month IS NULL OR membership_expiry_month=date_trunc('month',membership_expiry_month)::date),
  first_group_entry_month date CHECK (first_group_entry_month IS NULL OR first_group_entry_month=date_trunc('month',first_group_entry_month)::date),
  accumulated_group_months integer CHECK (accumulated_group_months IS NULL OR accumulated_group_months BETWEEN 0 AND 1200),
  notice_status text CHECK (notice_status IS NULL OR notice_status IN ('not_notified','follow_up_pending','notified','notified_overdue')),
  latest_notice_month date CHECK (latest_notice_month IS NULL OR latest_notice_month=date_trunc('month',latest_notice_month)::date),
  payment_status text CHECK (payment_status IS NULL OR payment_status IN ('unpaid','paid','needs_review')),
  payment_month date CHECK (payment_month IS NULL OR payment_month=date_trunc('month',payment_month)::date),
  group_status text NOT NULL DEFAULT 'unknown' CHECK (group_status IN ('in_group','left','removed','unknown')),
  source_import_row_id text UNIQUE REFERENCES venture_private.governed_import_rows(id),
  reviewed_by text REFERENCES venture_private.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE venture_private.member_crm_master_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.member_crm_master_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON venture_private.member_crm_master_profiles FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.venture_stage_governed_import_chunk(p_batch_id text,p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$
DECLARE staged integer; errors integer; expected integer; batch_status text;
BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();
  SELECT status,total_rows INTO batch_status,expected FROM venture_private.governed_import_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'governed import batch missing'; END IF;
  IF batch_status<>'staging' THEN RAISE EXCEPTION 'governed import batch no longer accepts chunks'; END IF;
  IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)<1 OR jsonb_array_length(p_rows)>500 THEN RAISE EXCEPTION 'invalid governed import chunk'; END IF;
  IF (SELECT count(*) FROM venture_private.governed_import_rows WHERE batch_id=p_batch_id)+jsonb_array_length(p_rows)>expected THEN RAISE EXCEPTION 'governed import chunk exceeds declared total'; END IF;
  INSERT INTO venture_private.governed_import_rows(id,batch_id,row_number,row_fingerprint,match_key_kind,match_key_hash,safe_projection,protected_payload_ciphertext,row_status,validation_codes,warning_codes)
  SELECT x.row_id,p_batch_id,x.row_number,x.row_fingerprint,x.match_key_kind,x.match_key_hash,x.safe_projection,x.protected_payload_ciphertext,x.row_status,x.validation_codes,x.warning_codes
  FROM jsonb_to_recordset(p_rows) AS x(row_id text,row_number integer,row_fingerprint text,match_key_kind text,match_key_hash text,safe_projection jsonb,protected_payload_ciphertext text,row_status text,validation_codes jsonb,warning_codes jsonb)
  ON CONFLICT(batch_id,row_fingerprint) DO NOTHING;
  SELECT count(*),count(*) FILTER(WHERE row_status='error') INTO staged,errors FROM venture_private.governed_import_rows WHERE batch_id=p_batch_id;
  UPDATE venture_private.governed_import_batches SET staged_rows=staged,error_rows=errors WHERE id=p_batch_id;
  RETURN jsonb_build_object('batch_id',p_batch_id,'status','staging','staged_rows',staged,'error_rows',errors,'expected_rows',expected);
END $$;

CREATE OR REPLACE FUNCTION public.venture_finalize_governed_import_batch(p_batch_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$
DECLARE staged integer; errors integer; expected integer; batch_status text;
BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();
  SELECT status,total_rows INTO batch_status,expected FROM venture_private.governed_import_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'governed import batch missing'; END IF;
  IF batch_status='private_review_pending' THEN RETURN jsonb_build_object('batch_id',p_batch_id,'status',batch_status,'reused',true); END IF;
  IF batch_status<>'staging' THEN RAISE EXCEPTION 'governed import batch cannot be finalized'; END IF;
  SELECT count(*),count(*) FILTER(WHERE row_status='error') INTO staged,errors FROM venture_private.governed_import_rows WHERE batch_id=p_batch_id;
  IF staged<>expected THEN RAISE EXCEPTION 'governed import batch is incomplete'; END IF;
  INSERT INTO venture_private.member_match_candidates(import_row_id,candidate_user_id,confidence_bucket,reason_codes)
  SELECT row.id,token.user_id,'exact_private_token',jsonb_build_array('private_token_match')
  FROM venture_private.governed_import_rows row JOIN venture_private.member_private_match_tokens token ON token.token_kind=row.match_key_kind AND token.token_hash=row.match_key_hash AND token.status='active'
  WHERE row.batch_id=p_batch_id AND row.row_status='needs_human_review' ON CONFLICT DO NOTHING;
  UPDATE venture_private.governed_import_rows row SET match_status=CASE matches.count WHEN 0 THEN 'not_found' WHEN 1 THEN 'unique_candidate' ELSE 'conflict' END,updated_at=now()
  FROM (SELECT staged_row.id,count(candidate.id)::integer AS count FROM venture_private.governed_import_rows staged_row LEFT JOIN venture_private.member_match_candidates candidate ON candidate.import_row_id=staged_row.id AND candidate.status='pending' WHERE staged_row.batch_id=p_batch_id GROUP BY staged_row.id) matches
  WHERE row.id=matches.id AND row.row_status='needs_human_review';
  UPDATE venture_private.governed_import_batches SET staged_rows=staged,error_rows=errors,status='private_review_pending' WHERE id=p_batch_id;
  RETURN jsonb_build_object('batch_id',p_batch_id,'status','private_review_pending','staged_rows',staged,'error_rows',errors);
END $$;

REVOKE ALL ON FUNCTION public.venture_stage_governed_import_chunk(text,jsonb),public.venture_finalize_governed_import_batch(text) FROM PUBLIC;
DO $crm_import_grants$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON FUNCTION public.venture_stage_governed_import_chunk(text,jsonb),public.venture_finalize_governed_import_batch(text) FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON FUNCTION public.venture_stage_governed_import_chunk(text,jsonb),public.venture_finalize_governed_import_batch(text) FROM authenticated; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT EXECUTE ON FUNCTION public.venture_stage_governed_import_chunk(text,jsonb),public.venture_finalize_governed_import_batch(text) TO service_role; END IF;
END $crm_import_grants$;

COMMENT ON TABLE venture_private.member_crm_master_profiles IS 'Server-only CRM master projection; contact, names, payment values and notes remain encrypted and never enter member responses';
COMMIT;
