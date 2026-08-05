-- READ ONLY. Run first in the CloudBase PostgreSQL SQL editor.
-- Expected for a new empty business database: all numeric results are 0 / false.
WITH expected(name) AS (VALUES
  ('users'),('crm_verifications'),('payment_evidence'),('membership_decisions'),
  ('public_directory_profiles'),('public_profile_updates'),('employment_verifications'),
  ('resources'),('import_batches'),('import_items'),('activities'),('registrations'),
  ('demands'),('demand_applications'),('agent_dispatches'),('admin_roles'),
  ('admin_permissions'),('admin_role_permissions'),('admin_role_assignments'),
  ('operation_idempotency_keys'),('audit_logs')
)
SELECT
  EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='venture_private') AS venture_private_schema_exists,
  (SELECT count(*) FROM information_schema.tables t JOIN expected e ON e.name=t.table_name
    WHERE t.table_schema='venture_private') AS conflicting_private_tables,
  (SELECT count(*) FROM information_schema.views
    WHERE table_schema='public' AND table_name IN ('venture_resources_published','venture_activities_public')) AS conflicting_public_views,
  to_regclass('venture_private.schema_migrations') IS NOT NULL AS migration_table_exists;
