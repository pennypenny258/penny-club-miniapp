-- Forward-only classification split. Do not execute automatically from the runtime.
-- Clear legacy rows are mapped by their existing resource type. Ambiguous rows are
-- returned to draft review and cannot remain member-visible.

UPDATE venture_private.resources
SET mobile_section=CASE type
      WHEN 'industry_report' THEN 'research_reports'
      WHEN 'group_digest' THEN 'group_digests'
    END,
    updated_at=now()
WHERE mobile_section IN ('reports_digest','reports_digests')
  AND type IN ('industry_report','group_digest');

UPDATE venture_private.resources
SET mobile_section='unclassified',status='draft',rights_review_status='pending',
    download_enabled=false,published_at=NULL,updated_at=now()
WHERE mobile_section IN ('reports_digest','reports_digests');

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
     p_type NOT IN ('meeting_replay','industry_report','group_digest','book','tool','benefit_update') OR
     p_mobile_section NOT IN ('replays','research_reports','group_digests','books','files_templates','benefits') OR
     (p_type='industry_report' AND p_mobile_section<>'research_reports') OR
     (p_type='group_digest' AND p_mobile_section<>'group_digests') OR
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

REVOKE ALL ON FUNCTION public.venture_begin_resource_upload(text,text,text,text,text,text,text,jsonb,text,text,text,text,bigint,text,boolean) FROM PUBLIC;
DO $resource_split_role$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.venture_begin_resource_upload(text,text,text,text,text,text,text,jsonb,text,text,text,text,bigint,text,boolean) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.venture_begin_resource_upload(text,text,text,text,text,text,text,jsonb,text,text,text,text,bigint,text,boolean) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT EXECUTE ON FUNCTION public.venture_begin_resource_upload(text,text,text,text,text,text,text,jsonb,text,text,text,text,bigint,text,boolean) TO service_role;
  END IF;
END $resource_split_role$;
