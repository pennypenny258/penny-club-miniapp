-- Run only after 008 completes without error. This writes migration metadata only.
DO $record_admin_auth_version$
DECLARE expected_checksum text := '1d29f1997e3d63322ae56a0fef78b559d41028e2d278527ffdc0d51e1652bd3d';existing_checksum text;
BEGIN
  IF to_regclass('venture_private.external_admin_identity_bindings') IS NULL OR to_regclass('venture_private.admin_sessions') IS NULL OR to_regclass('venture_private.admin_action_authorizations') IS NULL OR to_regclass('public.venture_admin_session_access') IS NULL THEN RAISE EXCEPTION '008 admin auth objects are incomplete';END IF;
  IF to_regprocedure('public.venture_begin_admin_session(text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)') IS NULL OR to_regprocedure('public.venture_reserve_admin_action(text,text,text,text,boolean,text[])') IS NULL OR to_regprocedure('public.venture_revoke_admin_session(text,text,text)') IS NULL THEN RAISE EXCEPTION '008 admin auth RPCs are incomplete';END IF;
  SELECT checksum INTO existing_checksum FROM venture_private.schema_migrations WHERE version='008_admin_session_rbac';
  IF existing_checksum IS NOT NULL AND existing_checksum<>expected_checksum THEN RAISE EXCEPTION 'Existing migration checksum mismatch for 008_admin_session_rbac';END IF;
  INSERT INTO venture_private.schema_migrations(version,checksum) VALUES('008_admin_session_rbac',expected_checksum) ON CONFLICT(version) DO NOTHING;
END $record_admin_auth_version$;
