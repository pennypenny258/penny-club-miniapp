-- CloudBase SQL editor execution variant for canonical 002_security.sql.
-- It intentionally does not create or depend on a direct-login venture_club_app role.
-- Runtime access is only through two redacted public views created by canonical 003.
REVOKE ALL ON SCHEMA venture_private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA venture_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA venture_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA venture_private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA venture_private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA venture_private REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA venture_private REVOKE ALL ON FUNCTIONS FROM PUBLIC;

DO $cloudbase_private_rls$
DECLARE target_table text;
BEGIN
  FOR target_table IN
    SELECT tablename FROM pg_tables
    WHERE schemaname='venture_private' AND tablename<>'schema_migrations'
  LOOP
    EXECUTE format('ALTER TABLE venture_private.%I ENABLE ROW LEVEL SECURITY',target_table);
  END LOOP;
END $cloudbase_private_rls$;

CREATE OR REPLACE FUNCTION venture_private.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END $$;
DROP TRIGGER IF EXISTS audit_logs_append_only ON venture_private.audit_logs;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON venture_private.audit_logs
FOR EACH ROW EXECUTE FUNCTION venture_private.reject_audit_mutation();

REVOKE ALL ON FUNCTION venture_private.reject_audit_mutation() FROM PUBLIC;

DO $cloudbase_runtime_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON SCHEMA venture_private FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA venture_private FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA venture_private FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA venture_private FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA venture_private REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA venture_private REVOKE ALL ON SEQUENCES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA venture_private REVOKE ALL ON FUNCTIONS FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON SCHEMA venture_private FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA venture_private FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA venture_private FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA venture_private FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA venture_private REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA venture_private REVOKE ALL ON SEQUENCES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA venture_private REVOKE ALL ON FUNCTIONS FROM authenticated;
  END IF;
END $cloudbase_runtime_roles$;
