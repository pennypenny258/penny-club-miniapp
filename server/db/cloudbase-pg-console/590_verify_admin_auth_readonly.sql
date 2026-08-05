-- Read-only verification. Every returned value must be true before 008 is considered ready.
SELECT
  to_regclass('venture_private.external_admin_identity_bindings') IS NOT NULL AS identity_bindings_exist,
  to_regclass('venture_private.admin_sessions') IS NOT NULL AS sessions_exist,
  to_regclass('venture_private.admin_action_authorizations') IS NOT NULL AS action_authorizations_exist,
  to_regclass('public.venture_admin_session_access') IS NOT NULL AS session_access_view_exists,
  to_regprocedure('public.venture_begin_admin_session(text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)') IS NOT NULL AS begin_session_rpc_exists,
  to_regprocedure('public.venture_reserve_admin_action(text,text,text,text,boolean,text[])') IS NOT NULL AS reserve_action_rpc_exists,
  to_regprocedure('public.venture_revoke_admin_session(text,text,text)') IS NOT NULL AS revoke_session_rpc_exists,
  EXISTS(SELECT 1 FROM venture_private.schema_migrations WHERE version='008_admin_session_rbac') AS version_recorded,
  NOT has_table_privilege('anon','venture_private.admin_sessions','SELECT') AS anon_cannot_read_sessions,
  NOT has_table_privilege('authenticated','venture_private.admin_sessions','SELECT') AS authenticated_cannot_read_sessions,
  NOT has_table_privilege('anon','public.venture_admin_session_access','SELECT') AS anon_cannot_read_session_view,
  NOT has_table_privilege('authenticated','public.venture_admin_session_access','SELECT') AS authenticated_cannot_read_session_view,
  (SELECT count(DISTINCT code)=4 FROM venture_private.admin_roles WHERE code IN ('system_admin','operations','reviewer','auditor')) AS four_roles_exist;
