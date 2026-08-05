-- Read-only verification after 004 -> 140 -> 190 -> 005 -> 250 -> 260.
-- It checks metadata and permissions only; it never reads resource, member or file rows.
SELECT
  to_regclass('venture_private.resource_upload_intents') IS NOT NULL AS upload_intents_exist,
  to_regclass('venture_private.resource_files') IS NOT NULL AS resource_files_exist,
  to_regclass('venture_private.resource_review_records') IS NOT NULL AS review_records_exist,
  to_regclass('public.venture_resource_storage_compliance') IS NOT NULL AS compliance_view_exists,
  to_regclass('public.venture_resource_download_object') IS NOT NULL AS download_view_exists,
  EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id='venture-private-resources' AND public=false AND file_size_limit=26214400
  ) AS private_bucket_limited,
  NOT EXISTS (
    SELECT 1 FROM information_schema.table_privileges
    WHERE grantee IN ('PUBLIC','anon','authenticated') AND table_schema='public'
      AND table_name IN ('venture_resource_storage_compliance','venture_resource_download_object')
  ) AS client_roles_cannot_read_storage_views,
  NOT EXISTS (
    SELECT 1 FROM information_schema.table_privileges
    WHERE grantee IN ('PUBLIC','anon','authenticated') AND table_schema='venture_private'
      AND table_name IN ('resource_upload_intents','resource_files','resource_review_records')
  ) AS client_roles_cannot_read_private_storage_facts,
  (
    SELECT count(*)=4 AND bool_and(p.prosecdef AND position('service_role' in pg_get_functiondef(p.oid))>0)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'venture_begin_resource_upload','venture_complete_resource_upload',
      'venture_fail_resource_upload','venture_review_resource_storage'
    )
  ) AS privileged_rpcs_self_check_service_role,
  EXISTS (
    SELECT 1 FROM venture_private.schema_migrations
    WHERE version='005_resource_private_storage'
      AND checksum='8a21629626d29bf3a45975be675033b01db7992ce58a6e07200a11dbbbf0d03b'
  ) AS migration_005_recorded;
