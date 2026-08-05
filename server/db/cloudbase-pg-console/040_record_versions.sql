-- Run only after canonical 001, this CloudBase 002 variant, and canonical 003 all succeeded.
BEGIN;
CREATE TABLE IF NOT EXISTS venture_private.schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE venture_private.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON venture_private.schema_migrations FROM PUBLIC;
DO $migration_table_client_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON venture_private.schema_migrations FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON venture_private.schema_migrations FROM authenticated;
  END IF;
END $migration_table_client_roles$;

DO $verify_before_record$
BEGIN
  IF to_regclass('venture_private.resources') IS NULL OR
     to_regclass('venture_private.activities') IS NULL OR
     to_regclass('venture_private.audit_logs') IS NULL OR
     to_regclass('public.venture_resources_published') IS NULL OR
     to_regclass('public.venture_activities_public') IS NULL THEN
    RAISE EXCEPTION 'Bootstrap objects are incomplete; stop without recording migration versions';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='audit_logs_append_only' AND tgrelid='venture_private.audit_logs'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Append-only audit trigger is missing; stop without recording migration versions';
  END IF;
END $verify_before_record$;

DO $reject_checksum_mismatch$
BEGIN
  IF EXISTS (
    SELECT 1 FROM venture_private.schema_migrations m
    JOIN (VALUES
      ('001_core_domains','c7d7d179b48991c4e65900ca0e8238028b03d6369484a6b9f532b75af736418e'),
      ('002_security_cloudbase_gateway','f20a52095013fe30311a99cfd4fa31603d2687a49f87360669338e10e042acad'),
      ('003_cloudbase_gateway_read_views','aaae39bdb85cf0d93edf4ac04fdcb13f14051f6bb29e7f4e512e9ab370c79a47')
    ) expected(version,checksum) ON expected.version=m.version
    WHERE m.checksum<>expected.checksum
  ) THEN
    RAISE EXCEPTION 'Existing migration checksum mismatch; stop and investigate';
  END IF;
END $reject_checksum_mismatch$;

INSERT INTO venture_private.schema_migrations(version,checksum) VALUES
  ('001_core_domains','c7d7d179b48991c4e65900ca0e8238028b03d6369484a6b9f532b75af736418e'),
  ('002_security_cloudbase_gateway','f20a52095013fe30311a99cfd4fa31603d2687a49f87360669338e10e042acad'),
  ('003_cloudbase_gateway_read_views','aaae39bdb85cf0d93edf4ac04fdcb13f14051f6bb29e7f4e512e9ab370c79a47')
ON CONFLICT (version) DO NOTHING;
COMMIT;
