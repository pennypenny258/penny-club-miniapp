-- Read-only verification. Every returned value must be true before 009 is considered ready.
SELECT
 to_regclass('venture_private.admin_bootstrap_authorizations') IS NOT NULL AS bootstrap_authorizations_exist,
 to_regclass('venture_private.admin_role_change_requests') IS NOT NULL AS role_change_requests_exist,
 to_regprocedure('public.venture_bootstrap_system_admin(text,text)') IS NOT NULL AS bootstrap_rpc_exists,
 to_regprocedure('public.venture_request_admin_role_change(text,text,text,text,text,text)') IS NOT NULL AS role_request_rpc_exists,
 to_regprocedure('public.venture_approve_admin_role_change(text,text,text)') IS NOT NULL AS role_approve_rpc_exists,
 to_regprocedure('public.venture_read_redacted_admin_audit(text,timestamp with time zone,integer)') IS NOT NULL AS audit_rpc_exists,
 EXISTS(SELECT 1 FROM venture_private.schema_migrations WHERE version='009_admin_governance') AS version_recorded,
 NOT has_table_privilege('anon','venture_private.admin_bootstrap_authorizations','SELECT') AS anon_cannot_read_bootstrap,
 NOT has_table_privilege('authenticated','venture_private.admin_bootstrap_authorizations','SELECT') AS authenticated_cannot_read_bootstrap,
 NOT has_table_privilege('anon','venture_private.admin_role_change_requests','SELECT') AS anon_cannot_read_role_changes,
 NOT has_table_privilege('authenticated','venture_private.admin_role_change_requests','SELECT') AS authenticated_cannot_read_role_changes,
 NOT EXISTS(SELECT 1 FROM venture_private.admin_bootstrap_authorizations) AS no_bootstrap_authorization_seeded;
