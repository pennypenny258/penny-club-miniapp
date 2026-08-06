-- Run only after 011 completes without error. Writes migration metadata, never business rows.
DO $record_crm_master_import_version$
DECLARE expected_checksum text := '9df984774e201d200a5c03b622ba277f2e2911da745d0e997713fd5cea0c92da'; existing_checksum text;
BEGIN
  IF to_regclass('venture_private.member_crm_master_profiles') IS NULL
     OR to_regprocedure('public.venture_stage_governed_import_chunk(text,jsonb)') IS NULL
     OR to_regprocedure('public.venture_finalize_governed_import_batch(text)') IS NULL THEN
    RAISE EXCEPTION '011 CRM master import objects are incomplete';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM venture_private.schema_migrations WHERE version='009_admin_governance') THEN
    RAISE EXCEPTION 'required migration 009_admin_governance is not recorded';
  END IF;
  SELECT checksum INTO existing_checksum FROM venture_private.schema_migrations WHERE version='011_crm_master_import';
  IF existing_checksum IS NOT NULL AND existing_checksum<>expected_checksum THEN RAISE EXCEPTION 'Existing migration checksum mismatch for 011_crm_master_import'; END IF;
  INSERT INTO venture_private.schema_migrations(version,checksum) VALUES('011_crm_master_import',expected_checksum) ON CONFLICT(version) DO NOTHING;
END $record_crm_master_import_version$;
