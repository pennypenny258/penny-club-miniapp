-- READ ONLY. Run last. Every row must return passed=true before creating any API Key.
WITH checks(check_name,passed,detail) AS (
  SELECT 'expected_private_tables', count(*)=22, count(*)::text
  FROM information_schema.tables WHERE table_schema='venture_private' AND table_type='BASE TABLE'
  UNION ALL
  SELECT 'all_private_tables_rls', bool_and(c.relrowsecurity), count(*) FILTER (WHERE NOT c.relrowsecurity)::text
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='venture_private' AND c.relkind='r'
  UNION ALL
  SELECT 'anon_authenticated_no_private_schema',
    NOT has_schema_privilege('anon','venture_private','USAGE') AND
    NOT has_schema_privilege('authenticated','venture_private','USAGE'),
    concat('anon=',has_schema_privilege('anon','venture_private','USAGE'),
           ',authenticated=',has_schema_privilege('authenticated','venture_private','USAGE'))
  UNION ALL
  SELECT 'anon_authenticated_no_gateway_views',
    NOT has_table_privilege('anon','public.venture_resources_published','SELECT') AND
    NOT has_table_privilege('authenticated','public.venture_resources_published','SELECT') AND
    NOT has_table_privilege('anon','public.venture_activities_public','SELECT') AND
    NOT has_table_privilege('authenticated','public.venture_activities_public','SELECT'),
    'four direct SELECT privilege checks'
  UNION ALL
  SELECT 'service_role_can_read_gateway_views',
    has_table_privilege('service_role','public.venture_resources_published','SELECT') AND
    has_table_privilege('service_role','public.venture_activities_public','SELECT'),
    'two service_role SELECT privilege checks'
  UNION ALL
  SELECT 'gateway_views_exist', count(*)=2, count(*)::text
  FROM information_schema.views
  WHERE table_schema='public' AND table_name IN ('venture_resources_published','venture_activities_public')
  UNION ALL
  SELECT 'gateway_views_have_no_forbidden_columns', count(*)=0, count(*)::text
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name IN ('venture_resources_published','venture_activities_public')
    AND column_name IN ('private_object_key_ciphertext','source_reference_ciphertext','meeting_link_ciphertext','protected_payload_ciphertext')
  UNION ALL
  SELECT 'audit_append_only_trigger', count(*)=1, count(*)::text
  FROM pg_trigger WHERE tgname='audit_logs_append_only'
    AND tgrelid='venture_private.audit_logs'::regclass AND NOT tgisinternal
  UNION ALL
  SELECT 'recorded_bootstrap_versions', count(*)=3, count(*)::text
  FROM venture_private.schema_migrations
  WHERE version IN ('001_core_domains','002_security_cloudbase_gateway','003_cloudbase_gateway_read_views')
)
SELECT check_name,passed,detail FROM checks ORDER BY check_name;
