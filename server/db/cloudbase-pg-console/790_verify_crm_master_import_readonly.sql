-- Read-only verification. Every returned value must be true before configuration proceeds.
SELECT
  to_regclass('venture_private.member_crm_master_profiles') IS NOT NULL AS crm_master_table_exists,
  to_regprocedure('public.venture_stage_governed_import_chunk(text,jsonb)') IS NOT NULL AS chunk_rpc_exists,
  to_regprocedure('public.venture_finalize_governed_import_batch(text)') IS NOT NULL AS finalize_rpc_exists,
  EXISTS(SELECT 1 FROM venture_private.schema_migrations WHERE version='011_crm_master_import' AND checksum='9df984774e201d200a5c03b622ba277f2e2911da745d0e997713fd5cea0c92da') AS migration_version_recorded,
  NOT has_table_privilege('PUBLIC','venture_private.member_crm_master_profiles','SELECT') AS public_cannot_read_crm,
  EXISTS(SELECT 1 FROM pg_class WHERE oid='venture_private.member_crm_master_profiles'::regclass AND relrowsecurity AND relforcerowsecurity) AS crm_rls_forced;
