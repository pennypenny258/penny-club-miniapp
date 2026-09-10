-- Forward-only production intake package built directly on the verified 008 baseline.
-- It does not depend on deferred migrations 009-013 and does not enable any HTTP route.
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

ALTER TABLE venture_private.activities
  ADD COLUMN IF NOT EXISTS speaker_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS participant_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS replay_link_ciphertext text,
  ADD COLUMN IF NOT EXISTS minutes_object_key_ciphertext text,
  ADD COLUMN IF NOT EXISTS recording_object_key_ciphertext text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE venture_private.activities
  DROP CONSTRAINT IF EXISTS activities_speaker_summary_check,
  DROP CONSTRAINT IF EXISTS activities_participant_summary_check;
ALTER TABLE venture_private.activities
  ADD CONSTRAINT activities_speaker_summary_check CHECK (jsonb_typeof(speaker_summary)='array' AND jsonb_array_length(speaker_summary)<=30),
  ADD CONSTRAINT activities_participant_summary_check CHECK (jsonb_typeof(participant_summary)='array' AND jsonb_array_length(participant_summary)<=200);

CREATE OR REPLACE VIEW public.venture_activities_public WITH (security_barrier=true) AS
SELECT id,format,title,description,starts_at,ends_at,registration_ends_at,category,city,venue,
       status,created_at,speaker_summary,participant_summary,updated_at,
       (replay_link_ciphertext IS NOT NULL OR minutes_object_key_ciphertext IS NOT NULL OR recording_object_key_ciphertext IS NOT NULL) AS replay_available
FROM venture_private.activities
WHERE status IN ('waiting','completed','registration_open','waitlist_open','ended');

CREATE OR REPLACE FUNCTION public.venture_upsert_activity(
  p_authorization_id text,p_actor_id text,p_activity_id text,p_format text,p_title text,p_description text,
  p_starts_at timestamptz,p_ends_at timestamptz,p_registration_ends_at timestamptz,p_category text,p_city text,p_venue text,
  p_speaker_summary jsonb,p_participant_summary jsonb,p_status text,p_meeting_link_ciphertext text,
  p_replay_link_ciphertext text,p_minutes_object_key_ciphertext text,p_recording_object_key_ciphertext text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$
DECLARE action_auth venture_private.admin_action_authorizations%ROWTYPE; reused boolean:=false;
BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();
  SELECT * INTO action_auth FROM venture_private.admin_action_authorizations WHERE id=p_authorization_id FOR UPDATE;
  IF NOT FOUND OR action_auth.actor_user_id<>p_actor_id OR action_auth.permission_code<>'activity.manage' OR action_auth.expires_at<=now() OR action_auth.status NOT IN ('reserved','consumed') THEN RAISE EXCEPTION 'activity authorization denied'; END IF;
  IF p_activity_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$' OR p_format NOT IN ('online','offline') OR p_status NOT IN ('draft','waiting','completed','cancelled') THEN RAISE EXCEPTION 'invalid activity input'; END IF;
  IF length(trim(p_title))<2 OR length(p_title)>160 OR length(coalesce(p_description,''))>2000 OR (p_ends_at IS NOT NULL AND p_ends_at<p_starts_at) THEN RAISE EXCEPTION 'invalid activity details'; END IF;
  IF jsonb_typeof(coalesce(p_speaker_summary,'[]'::jsonb))<>'array' OR jsonb_array_length(coalesce(p_speaker_summary,'[]'::jsonb))>30 OR jsonb_typeof(coalesce(p_participant_summary,'[]'::jsonb))<>'array' OR jsonb_array_length(coalesce(p_participant_summary,'[]'::jsonb))>200 THEN RAISE EXCEPTION 'invalid activity people summary'; END IF;
  IF p_format='online' AND p_status='waiting' AND p_meeting_link_ciphertext IS NULL THEN RAISE EXCEPTION 'waiting online activity requires protected meeting link'; END IF;
  IF p_format='online' AND p_status='completed' AND p_replay_link_ciphertext IS NULL AND p_minutes_object_key_ciphertext IS NULL AND p_recording_object_key_ciphertext IS NULL THEN RAISE EXCEPTION 'completed online activity requires a protected replay or record'; END IF;
  IF p_format='offline' AND p_status='waiting' AND (nullif(trim(coalesce(p_city,'')),'') IS NULL OR nullif(trim(coalesce(p_venue,'')),'') IS NULL) THEN RAISE EXCEPTION 'waiting offline activity requires city and venue'; END IF;
  reused:=action_auth.status='consumed';
  IF reused AND NOT EXISTS(SELECT 1 FROM venture_private.audit_logs WHERE actor_user_id=p_actor_id AND action='activity.upsert' AND subject_type='activity' AND subject_id=p_activity_id) THEN RAISE EXCEPTION 'activity idempotency conflict'; END IF;
  IF NOT reused THEN
    INSERT INTO venture_private.activities(id,format,title,description,starts_at,ends_at,registration_ends_at,category,city,venue,speaker_summary,participant_summary,status,meeting_link_ciphertext,replay_link_ciphertext,minutes_object_key_ciphertext,recording_object_key_ciphertext,updated_at)
    VALUES(p_activity_id,p_format,trim(p_title),nullif(trim(coalesce(p_description,'')),''),p_starts_at,p_ends_at,p_registration_ends_at,coalesce(nullif(trim(p_category),''),'member_event'),nullif(trim(coalesce(p_city,'')),''),nullif(trim(coalesce(p_venue,'')),''),coalesce(p_speaker_summary,'[]'::jsonb),coalesce(p_participant_summary,'[]'::jsonb),p_status,p_meeting_link_ciphertext,p_replay_link_ciphertext,p_minutes_object_key_ciphertext,p_recording_object_key_ciphertext,now())
    ON CONFLICT(id) DO UPDATE SET format=excluded.format,title=excluded.title,description=excluded.description,starts_at=excluded.starts_at,ends_at=excluded.ends_at,registration_ends_at=excluded.registration_ends_at,category=excluded.category,city=excluded.city,venue=excluded.venue,speaker_summary=excluded.speaker_summary,participant_summary=excluded.participant_summary,status=excluded.status,meeting_link_ciphertext=excluded.meeting_link_ciphertext,replay_link_ciphertext=excluded.replay_link_ciphertext,minutes_object_key_ciphertext=excluded.minutes_object_key_ciphertext,recording_object_key_ciphertext=excluded.recording_object_key_ciphertext,updated_at=now();
    UPDATE venture_private.admin_action_authorizations SET status='consumed' WHERE id=p_authorization_id AND status='reserved';
    INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary)
    VALUES('audit-'||md5(random()::text||clock_timestamp()::text),p_actor_id,'verified_admin','activity.upsert','activity',p_activity_id,jsonb_build_object('format',p_format,'status',p_status,'meeting_link_logged',false,'replay_locator_logged',false,'sensitive_data_included',false));
  END IF;
  RETURN jsonb_build_object('activity_id',p_activity_id,'status',p_status,'reused',reused,'contact_disclosed',false,'private_locator_returned',false);
END $$;

REVOKE ALL ON FUNCTION public.venture_stage_governed_import_chunk(text,jsonb),public.venture_finalize_governed_import_batch(text),public.venture_upsert_activity(text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb,jsonb,text,text,text,text,text) FROM PUBLIC;
DO $production_intake_grants$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON FUNCTION public.venture_stage_governed_import_chunk(text,jsonb),public.venture_finalize_governed_import_batch(text),public.venture_upsert_activity(text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb,jsonb,text,text,text,text,text) FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON FUNCTION public.venture_stage_governed_import_chunk(text,jsonb),public.venture_finalize_governed_import_batch(text),public.venture_upsert_activity(text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb,jsonb,text,text,text,text,text) FROM authenticated; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT ON public.venture_activities_public TO service_role;
    GRANT EXECUTE ON FUNCTION public.venture_stage_governed_import_chunk(text,jsonb),public.venture_finalize_governed_import_batch(text),public.venture_upsert_activity(text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb,jsonb,text,text,text,text,text) TO service_role;
  END IF;
END $production_intake_grants$;

COMMENT ON TABLE venture_private.member_crm_master_profiles IS 'Server-only CRM master projection; names, contacts, payment values and notes remain encrypted';
COMMENT ON FUNCTION public.venture_upsert_activity(text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb,jsonb,text,text,text,text,text) IS 'Service-role-only, formally authorized and audited activity upsert';
COMMIT;
