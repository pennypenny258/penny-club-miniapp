-- Run only after 007 completes without error. This writes migration metadata only.
DO $record_materialization_version$
DECLARE expected_checksum text := 'c764ed6e1a9b2cb0468dce929217e7ce5f2cebe37f9bffd673448fdc0ce38ded';existing_checksum text;
BEGIN
  IF to_regclass('venture_private.materialization_requests') IS NULL OR to_regclass('venture_private.materialization_effects') IS NULL OR to_regclass('venture_private.directory_publication_approvals') IS NULL OR to_regclass('public.venture_materialization_source') IS NULL OR to_regclass('public.venture_materialization_status') IS NULL THEN RAISE EXCEPTION '007 materialization objects are incomplete';END IF;
  IF to_regprocedure('public.venture_request_materialization(text,text,text,text,text,text,jsonb)') IS NULL OR to_regprocedure('public.venture_execute_materialization(text,text)') IS NULL OR to_regprocedure('public.venture_compensate_materialization(text,text,jsonb)') IS NULL OR to_regprocedure('public.venture_approve_directory_publication(text,text)') IS NULL THEN RAISE EXCEPTION '007 materialization RPCs are incomplete';END IF;
  SELECT checksum INTO existing_checksum FROM venture_private.schema_migrations WHERE version='007_governed_materialization';
  IF existing_checksum IS NOT NULL AND existing_checksum<>expected_checksum THEN RAISE EXCEPTION 'Existing migration checksum mismatch for 007_governed_materialization';END IF;
  INSERT INTO venture_private.schema_migrations(version,checksum) VALUES('007_governed_materialization',expected_checksum) ON CONFLICT(version) DO NOTHING;
END $record_materialization_version$;
