-- Run only after 014 completes without error. Writes migration metadata, never business rows.
DO $record_production_intake_version$
DECLARE expected_checksum text := '59c86bfe2ac730a4ded2e4ec8cb3cfe590367614c9fbba9dace126a0cd319ce2'; existing_checksum text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM venture_private.schema_migrations WHERE version='008_admin_session_rbac') THEN
    RAISE EXCEPTION 'required migration 008_admin_session_rbac is not recorded';
  END IF;
  IF EXISTS(SELECT 1 FROM venture_private.schema_migrations WHERE version IN ('009_admin_governance','010_split_resource_sections','011_crm_master_import','012_member_binding_rpc','013_agent_gateway_rpc')) THEN
    RAISE EXCEPTION '014 is an alternative 008-baseline package and cannot be applied after deferred migrations 009-013';
  END IF;
  IF to_regclass('venture_private.member_crm_master_profiles') IS NULL
     OR to_regprocedure('public.venture_stage_governed_import_chunk(text,jsonb)') IS NULL
     OR to_regprocedure('public.venture_finalize_governed_import_batch(text)') IS NULL
     OR to_regprocedure('public.venture_upsert_activity(text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text,text,text,jsonb,jsonb,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '014 production intake objects are incomplete';
  END IF;
  SELECT checksum INTO existing_checksum FROM venture_private.schema_migrations WHERE version='014_production_intake_008_baseline';
  IF existing_checksum IS NOT NULL AND existing_checksum<>expected_checksum THEN RAISE EXCEPTION 'Existing migration checksum mismatch for 014_production_intake_008_baseline'; END IF;
  INSERT INTO venture_private.schema_migrations(version,checksum) VALUES('014_production_intake_008_baseline',expected_checksum) ON CONFLICT(version) DO NOTHING;
END $record_production_intake_version$;
