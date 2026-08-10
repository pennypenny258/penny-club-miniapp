-- Run only after 009 completes without error. This writes migration metadata only.
DO $record_admin_governance_version$
DECLARE expected_checksum text := '1cfd809714b3ab9739554bd4976f89495decb255fc19d8f4e2319c0afd9c5758';existing_checksum text;
BEGIN
 IF to_regclass('venture_private.admin_bootstrap_authorizations') IS NULL OR to_regclass('venture_private.admin_role_change_requests') IS NULL THEN RAISE EXCEPTION '009 admin governance objects are incomplete';END IF;
 IF to_regprocedure('public.venture_bootstrap_system_admin(text,text)') IS NULL OR to_regprocedure('public.venture_request_admin_role_change(text,text,text,text,text,text)') IS NULL OR to_regprocedure('public.venture_approve_admin_role_change(text,text,text)') IS NULL OR to_regprocedure('public.venture_read_redacted_admin_audit(text,timestamp with time zone,integer)') IS NULL THEN RAISE EXCEPTION '009 admin governance RPCs are incomplete';END IF;
 SELECT checksum INTO existing_checksum FROM venture_private.schema_migrations WHERE version='009_admin_governance';IF existing_checksum IS NOT NULL AND existing_checksum<>expected_checksum THEN RAISE EXCEPTION 'Existing migration checksum mismatch for 009_admin_governance';END IF;
 INSERT INTO venture_private.schema_migrations(version,checksum) VALUES('009_admin_governance',expected_checksum) ON CONFLICT(version) DO NOTHING;
END $record_admin_governance_version$;
