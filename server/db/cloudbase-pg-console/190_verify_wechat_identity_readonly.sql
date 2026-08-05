-- Run only after reviewing and manually applying 004_wechat_identity_entitlement.sql.
-- Read-only verification: every row must return true. It never reads business rows.
SELECT
  to_regclass('venture_private.external_identity_bindings') IS NOT NULL AS identity_binding_table_exists,
  to_regclass('public.venture_member_access_entitlement') IS NOT NULL AS entitlement_view_exists,
  EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='venture_private' AND c.relname='external_identity_bindings'
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) AS identity_binding_rls_forced,
  NOT EXISTS (
    SELECT 1 FROM information_schema.table_privileges
    WHERE grantee='PUBLIC' AND table_schema='venture_private'
      AND table_name='external_identity_bindings'
  ) AS public_cannot_read_bindings,
  NOT EXISTS (
    SELECT 1 FROM information_schema.table_privileges
    WHERE grantee='PUBLIC' AND table_schema='public'
      AND table_name='venture_member_access_entitlement'
  ) AS public_cannot_read_entitlement,
  EXISTS (
    SELECT 1 FROM venture_private.schema_migrations
    WHERE version='004_wechat_identity_entitlement'
      AND checksum='89651f91578a44d1f5fd78e8039c7ded587bbfae3a18764ee4bb3b2090d5a621'
  ) AS migration_004_recorded;
