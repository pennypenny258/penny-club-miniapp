-- Read-only verification. Every returned value must be true before 007 is considered ready.
SELECT
  to_regclass('venture_private.materialization_requests') IS NOT NULL AS requests_exists,
  to_regclass('venture_private.materialization_effects') IS NOT NULL AS effects_exists,
  to_regclass('venture_private.directory_publication_approvals') IS NOT NULL AS directory_approvals_exists,
  to_regclass('public.venture_materialization_source') IS NOT NULL AS source_view_exists,
  to_regclass('public.venture_materialization_status') IS NOT NULL AS status_view_exists,
  to_regprocedure('public.venture_request_materialization(text,text,text,text,text,text,jsonb)') IS NOT NULL AS request_rpc_exists,
  to_regprocedure('public.venture_execute_materialization(text,text)') IS NOT NULL AS execute_rpc_exists,
  to_regprocedure('public.venture_compensate_materialization(text,text,jsonb)') IS NOT NULL AS compensate_rpc_exists,
  to_regprocedure('public.venture_approve_directory_publication(text,text)') IS NOT NULL AS directory_publish_rpc_exists,
  EXISTS(SELECT 1 FROM venture_private.schema_migrations WHERE version='007_governed_materialization') AS version_recorded,
  NOT has_table_privilege('anon','venture_private.materialization_requests','SELECT') AS anon_cannot_read_requests,
  NOT has_table_privilege('authenticated','venture_private.materialization_requests','SELECT') AS authenticated_cannot_read_requests,
  NOT has_table_privilege('anon','venture_private.directory_publication_approvals','SELECT') AS anon_cannot_read_directory_approvals,
  NOT has_table_privilege('authenticated','venture_private.directory_publication_approvals','SELECT') AS authenticated_cannot_read_directory_approvals;
