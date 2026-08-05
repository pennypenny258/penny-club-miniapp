-- Fail closed: the private schema and every object are inaccessible to PUBLIC/PostgREST roles.
REVOKE ALL ON SCHEMA venture_private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA venture_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA venture_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA venture_private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA venture_private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA venture_private REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA venture_private REVOKE ALL ON FUNCTIONS FROM PUBLIC;

DO $security$
DECLARE target_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='venture_club_app') THEN
    RAISE EXCEPTION 'Create the NOLOGIN/LOGIN least-privilege venture_club_app role before applying 002_security';
  END IF;
  FOR target_table IN SELECT tablename FROM pg_tables WHERE schemaname='venture_private' AND tablename<>'schema_migrations'
  LOOP EXECUTE format('ALTER TABLE venture_private.%I ENABLE ROW LEVEL SECURITY',target_table); END LOOP;
  GRANT USAGE ON SCHEMA venture_private TO venture_club_app;
  GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA venture_private TO venture_club_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA venture_private GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO venture_club_app;
  FOR target_table IN SELECT tablename FROM pg_tables WHERE schemaname='venture_private' AND tablename<>'schema_migrations'
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='venture_private' AND p.tablename=target_table AND p.policyname='server_application_only') THEN
      EXECUTE format('CREATE POLICY server_application_only ON venture_private.%I FOR ALL TO venture_club_app USING (true) WITH CHECK (true)',target_table);
    END IF;
  END LOOP;
END $security$;

CREATE OR REPLACE FUNCTION venture_private.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END $$;
DROP TRIGGER IF EXISTS audit_logs_append_only ON venture_private.audit_logs;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON venture_private.audit_logs
FOR EACH ROW EXECUTE FUNCTION venture_private.reject_audit_mutation();

REVOKE ALL ON FUNCTION venture_private.reject_audit_mutation() FROM PUBLIC;
REVOKE UPDATE,DELETE ON venture_private.audit_logs FROM venture_club_app;
REVOKE ALL ON venture_private.schema_migrations FROM PUBLIC;
