-- Forward-only preparation for persistent resource uploads and private object references.
-- Object bytes stay in CloudBase PG Storage; only encrypted locators and integrity metadata live here.
CREATE TABLE IF NOT EXISTS venture_private.resource_upload_intents (
  id text PRIMARY KEY,
  resource_id text NOT NULL REFERENCES venture_private.resources(id),
  import_item_id text NOT NULL REFERENCES venture_private.import_items(id),
  actor_id text NOT NULL,
  expected_extension text NOT NULL,
  expected_mime_type text NOT NULL,
  expected_size_bytes bigint NOT NULL CHECK (expected_size_bytes BETWEEN 1 AND 26214400),
  expected_sha256 char(64) NOT NULL CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  requested_download_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated','stored_pending_review','failed','abandoned')),
  failure_code text,
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '30 minutes'),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resource_upload_intents_status_expiry_idx
  ON venture_private.resource_upload_intents(status,expires_at);

CREATE TABLE IF NOT EXISTS venture_private.resource_files (
  id text PRIMARY KEY,
  resource_id text NOT NULL REFERENCES venture_private.resources(id),
  upload_intent_id text NOT NULL UNIQUE REFERENCES venture_private.resource_upload_intents(id),
  storage_provider text NOT NULL CHECK (storage_provider='cloudbase_pg_storage'),
  object_ref_ciphertext text NOT NULL,
  object_ref_hash char(64) NOT NULL UNIQUE CHECK (object_ref_hash ~ '^[0-9a-f]{64}$'),
  file_extension text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 26214400),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'stored_pending_review' CHECK (status IN ('stored_pending_review','ready','quarantined','deleted')),
  security_review_status text NOT NULL DEFAULT 'pending_manual_security_review'
    CHECK (security_review_status IN ('pending_manual_security_review','manual_confirmed','scanner_passed','rejected')),
  preview_status text NOT NULL DEFAULT 'preview_not_configured'
    CHECK (preview_status IN ('preview_not_configured','preview_processing','preview_ready','preview_failed')),
  verified_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resource_files_resource_status_idx
  ON venture_private.resource_files(resource_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS venture_private.resource_review_records (
  id text PRIMARY KEY,
  resource_id text NOT NULL REFERENCES venture_private.resources(id),
  reviewer_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('publish','reject')),
  copyright_confirmed boolean NOT NULL DEFAULT false,
  security_review_status text NOT NULL CHECK (security_review_status IN ('manual_confirmed','scanner_passed','rejected')),
  download_enabled boolean NOT NULL DEFAULT false,
  preview_status text NOT NULL DEFAULT 'preview_not_configured',
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resource_review_records_resource_time_idx
  ON venture_private.resource_review_records(resource_id,reviewed_at DESC);

ALTER TABLE venture_private.resource_upload_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.resource_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.resource_review_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON venture_private.resource_upload_intents FROM PUBLIC;
REVOKE ALL ON venture_private.resource_files FROM PUBLIC;
REVOKE ALL ON venture_private.resource_review_records FROM PUBLIC;
DO $resource_private_role_denials$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON venture_private.resource_upload_intents FROM anon;
    REVOKE ALL ON venture_private.resource_files FROM anon;
    REVOKE ALL ON venture_private.resource_review_records FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON venture_private.resource_upload_intents FROM authenticated;
    REVOKE ALL ON venture_private.resource_files FROM authenticated;
    REVOKE ALL ON venture_private.resource_review_records FROM authenticated;
  END IF;
END $resource_private_role_denials$;

CREATE OR REPLACE FUNCTION venture_private.assert_cloudbase_service_role() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE claims_text text; claims jsonb;
BEGIN
  claims_text:=current_setting('request.jwt.claims',true);
  IF claims_text IS NULL OR claims_text='' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  claims:=claims_text::jsonb;
  IF claims->>'role'<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION venture_private.assert_cloudbase_service_role() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.venture_begin_resource_upload(
  p_intent_id text,p_resource_id text,p_import_item_id text,p_batch_id text,p_actor_id text,
  p_title text,p_summary text,p_tags jsonb,p_type text,p_mobile_section text,
  p_expected_extension text,p_expected_mime_type text,p_expected_size_bytes bigint,
  p_expected_sha256 text,p_requested_download_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,venture_private AS $$
BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 120 OR
     p_summary IS NULL OR length(p_summary)>300 OR
     jsonb_typeof(p_tags)<>'array' OR jsonb_array_length(p_tags)>10 OR
     p_type NOT IN ('meeting_replay','industry_report','book','tool','benefit_update') OR
     p_mobile_section NOT IN ('replays','reports_digest','books','files_templates','benefits') OR
     p_expected_extension NOT IN ('pdf','docx','xlsx','pptx','mp4','mp3','m4a','png','jpg','jpeg','md','txt','zip') OR
     p_expected_mime_type NOT IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','video/mp4','audio/mpeg','audio/mp4','image/png','image/jpeg','text/markdown','text/plain','application/zip') OR
     p_expected_size_bytes NOT BETWEEN 1 AND 26214400 OR p_expected_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid resource upload contract' USING ERRCODE='22023';
  END IF;
  INSERT INTO venture_private.import_batches(id,kind,source,status,total_rows,valid_rows,error_rows,mapping,created_at)
  VALUES(p_batch_id,'local_materials','computer_upload','uploading',1,0,0,'{}'::jsonb,now());
  INSERT INTO venture_private.resources(id,type,title,summary,tags,access_level,mobile_section,status,preview_status,download_enabled,rights_review_status,created_at,updated_at)
  VALUES(p_resource_id,p_type,btrim(p_title),p_summary,p_tags,'active_member',p_mobile_section,'draft','preview_not_configured',false,'pending',now(),now());
  INSERT INTO venture_private.import_items(id,batch_id,kind,status,normalized_safe_data,validation_errors,validation_warnings,created_at,updated_at)
  VALUES(p_import_item_id,p_batch_id,'knowledge','uploading',jsonb_build_object('resource_id',p_resource_id,'attachment_status','uploading'),'[]'::jsonb,'[]'::jsonb,now(),now());
  INSERT INTO venture_private.resource_upload_intents(id,resource_id,import_item_id,actor_id,expected_extension,expected_mime_type,expected_size_bytes,expected_sha256,requested_download_enabled)
  VALUES(p_intent_id,p_resource_id,p_import_item_id,p_actor_id,p_expected_extension,p_expected_mime_type,p_expected_size_bytes,p_expected_sha256,p_requested_download_enabled);
  RETURN jsonb_build_object('intent_id',p_intent_id,'resource_id',p_resource_id,'status','initiated');
END $$;

CREATE OR REPLACE FUNCTION public.venture_complete_resource_upload(
  p_intent_id text,p_file_id text,p_object_ref_ciphertext text,p_object_ref_hash text,
  p_actual_size_bytes bigint,p_actual_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,venture_private AS $$
DECLARE intent venture_private.resource_upload_intents%ROWTYPE;
BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();
  SELECT * INTO intent FROM venture_private.resource_upload_intents WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND OR intent.status<>'initiated' OR intent.expires_at<=now() OR
     p_actual_size_bytes<>intent.expected_size_bytes OR p_actual_sha256<>intent.expected_sha256 OR
     p_object_ref_ciphertext IS NULL OR length(p_object_ref_ciphertext) NOT BETWEEN 20 AND 4096 OR
     p_object_ref_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'upload completion contract mismatch' USING ERRCODE='22023';
  END IF;
  INSERT INTO venture_private.resource_files(id,resource_id,upload_intent_id,storage_provider,object_ref_ciphertext,object_ref_hash,file_extension,mime_type,size_bytes,sha256)
  VALUES(p_file_id,intent.resource_id,intent.id,'cloudbase_pg_storage',p_object_ref_ciphertext,p_object_ref_hash,intent.expected_extension,intent.expected_mime_type,p_actual_size_bytes,p_actual_sha256);
  UPDATE venture_private.resource_upload_intents SET status='stored_pending_review',completed_at=now() WHERE id=intent.id;
  UPDATE venture_private.import_items SET status='needs_human_review',normalized_safe_data=jsonb_build_object('resource_id',intent.resource_id,'attachment_status','stored'),updated_at=now() WHERE id=intent.import_item_id;
  UPDATE venture_private.import_batches SET status='ready_for_human_review',valid_rows=1 WHERE id=(SELECT batch_id FROM venture_private.import_items WHERE id=intent.import_item_id);
  RETURN jsonb_build_object('intent_id',intent.id,'resource_id',intent.resource_id,'status','stored_pending_review');
END $$;

CREATE OR REPLACE FUNCTION public.venture_fail_resource_upload(p_intent_id text,p_failure_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,venture_private AS $$
DECLARE intent venture_private.resource_upload_intents%ROWTYPE;
BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();
  IF p_failure_code NOT IN ('storage_unavailable','metadata_commit_failed','validation_failed','abandoned') THEN RAISE EXCEPTION 'invalid safe failure code' USING ERRCODE='22023'; END IF;
  SELECT * INTO intent FROM venture_private.resource_upload_intents WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'upload intent not found' USING ERRCODE='P0002'; END IF;
  IF intent.status='initiated' THEN
    UPDATE venture_private.resource_upload_intents SET status='failed',failure_code=p_failure_code WHERE id=intent.id;
    UPDATE venture_private.import_items SET status='error',validation_errors=jsonb_build_array(p_failure_code),updated_at=now() WHERE id=intent.import_item_id;
    UPDATE venture_private.import_batches SET status='needs_correction',error_rows=1 WHERE id=(SELECT batch_id FROM venture_private.import_items WHERE id=intent.import_item_id);
  END IF;
  RETURN jsonb_build_object('intent_id',intent.id,'status',(SELECT status FROM venture_private.resource_upload_intents WHERE id=intent.id));
END $$;

CREATE OR REPLACE FUNCTION public.venture_review_resource_storage(
  p_review_id text,p_resource_id text,p_reviewer_id text,p_decision text,
  p_copyright_confirmed boolean,p_security_review_status text,p_download_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,venture_private AS $$
DECLARE file_count integer;
BEGIN
  PERFORM venture_private.assert_cloudbase_service_role();
  IF p_decision NOT IN ('publish','reject') OR p_security_review_status NOT IN ('manual_confirmed','scanner_passed','rejected') THEN RAISE EXCEPTION 'invalid review contract' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO file_count FROM venture_private.resource_files WHERE resource_id=p_resource_id AND status='stored_pending_review';
  IF file_count<>1 THEN RAISE EXCEPTION 'resource attachment is not ready for review' USING ERRCODE='22023'; END IF;
  IF p_decision='publish' AND (p_copyright_confirmed IS NOT TRUE OR p_security_review_status NOT IN ('manual_confirmed','scanner_passed')) THEN RAISE EXCEPTION 'publish gates incomplete' USING ERRCODE='22023'; END IF;
  INSERT INTO venture_private.resource_review_records(id,resource_id,reviewer_id,decision,copyright_confirmed,security_review_status,download_enabled,preview_status)
  VALUES(p_review_id,p_resource_id,p_reviewer_id,p_decision,p_copyright_confirmed,p_security_review_status,p_download_enabled,'preview_not_configured');
  IF p_decision='publish' THEN
    UPDATE venture_private.resource_files SET status='ready',security_review_status=p_security_review_status,verified_at=now() WHERE resource_id=p_resource_id AND status='stored_pending_review';
    UPDATE venture_private.resources SET status='published',rights_review_status='approved',download_enabled=p_download_enabled,preview_status='preview_not_configured',published_at=now(),updated_at=now() WHERE id=p_resource_id AND status='draft';
  ELSE
    UPDATE venture_private.resource_files SET status='quarantined',security_review_status='rejected' WHERE resource_id=p_resource_id AND status='stored_pending_review';
    UPDATE venture_private.resources SET status='archived',rights_review_status='rejected',download_enabled=false,updated_at=now() WHERE id=p_resource_id AND status='draft';
  END IF;
  RETURN jsonb_build_object('resource_id',p_resource_id,'status',(SELECT status FROM venture_private.resources WHERE id=p_resource_id),'preview_status','preview_not_configured','download_enabled',(SELECT download_enabled FROM venture_private.resources WHERE id=p_resource_id));
END $$;

REVOKE ALL ON FUNCTION public.venture_begin_resource_upload(text,text,text,text,text,text,text,jsonb,text,text,text,text,bigint,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.venture_complete_resource_upload(text,text,text,text,bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.venture_fail_resource_upload(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.venture_review_resource_storage(text,text,text,text,boolean,text,boolean) FROM PUBLIC;

CREATE OR REPLACE VIEW public.venture_resource_storage_compliance WITH (security_barrier=true) AS
SELECT r.id AS resource_id,r.status AS resource_status,r.rights_review_status,
       coalesce(files.attachment_count,0)::integer AS attachment_count,
       coalesce(files.ready_file_count,0)::integer AS ready_file_count,
       upload.status AS upload_status,files.security_review_status,
       r.preview_status,r.download_enabled,r.updated_at
FROM venture_private.resources r
LEFT JOIN LATERAL (
  SELECT count(*) AS attachment_count,count(*) FILTER (WHERE status='ready') AS ready_file_count,
         max(security_review_status) AS security_review_status
  FROM venture_private.resource_files WHERE resource_id=r.id AND status<>'deleted'
) files ON true
LEFT JOIN LATERAL (
  SELECT status FROM venture_private.resource_upload_intents WHERE resource_id=r.id ORDER BY created_at DESC LIMIT 1
) upload ON true;

CREATE OR REPLACE VIEW public.venture_resource_download_object WITH (security_barrier=true) AS
SELECT DISTINCT ON (r.id) r.id AS resource_id,r.status AS resource_status,r.rights_review_status,
       r.download_enabled,f.status AS file_status,f.file_extension,f.mime_type,f.size_bytes,f.sha256,
       f.object_ref_ciphertext,f.object_ref_hash
FROM venture_private.resources r
JOIN venture_private.resource_files f ON f.resource_id=r.id
WHERE r.status='published' AND r.rights_review_status='approved' AND r.download_enabled=true AND f.status='ready'
ORDER BY r.id,f.created_at DESC;

REVOKE ALL ON public.venture_resource_storage_compliance FROM PUBLIC;
REVOKE ALL ON public.venture_resource_download_object FROM PUBLIC;
DO $resource_storage_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.venture_resource_storage_compliance FROM anon;
    REVOKE ALL ON public.venture_resource_download_object FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.venture_resource_storage_compliance FROM authenticated;
    REVOKE ALL ON public.venture_resource_download_object FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT ON public.venture_resource_storage_compliance TO service_role;
    GRANT SELECT ON public.venture_resource_download_object TO service_role;
    GRANT EXECUTE ON FUNCTION public.venture_begin_resource_upload(text,text,text,text,text,text,text,jsonb,text,text,text,text,bigint,text,boolean) TO service_role;
    GRANT EXECUTE ON FUNCTION public.venture_complete_resource_upload(text,text,text,text,bigint,text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.venture_fail_resource_upload(text,text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.venture_review_resource_storage(text,text,text,text,boolean,text,boolean) TO service_role;
  END IF;
END $resource_storage_roles$;

COMMENT ON TABLE venture_private.resource_files IS 'Encrypted private object references and integrity metadata; no original filename or public URL';
COMMENT ON VIEW public.venture_resource_download_object IS 'Node server only: published/download-enabled object locator ciphertext; never serialize to clients';
