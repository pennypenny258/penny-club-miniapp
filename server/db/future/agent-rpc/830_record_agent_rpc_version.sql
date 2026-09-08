-- FUTURE PACKAGE ONLY. Run only after 013 succeeds and its objects are verified.
BEGIN;
DO $record_agent_rpc$
DECLARE existing_checksum text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM venture_private.schema_migrations WHERE version='004_wechat_identity_entitlement' AND checksum='89651f91578a44d1f5fd78e8039c7ded587bbfae3a18764ee4bb3b2090d5a621') THEN
    RAISE EXCEPTION 'verified canonical 004 prerequisite is missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM venture_private.schema_migrations WHERE version='008_admin_session_rbac' AND checksum='1d29f1997e3d63322ae56a0fef78b559d41028e2d278527ffdc0d51e1652bd3d') THEN
    RAISE EXCEPTION 'verified canonical 008 prerequisite is missing';
  END IF;
  IF to_regprocedure('public.venture_agent_list_published_opportunities(jsonb)') IS NULL OR
     to_regprocedure('public.venture_agent_stage_demand_review(jsonb)') IS NULL OR
     to_regprocedure('public.venture_agent_stage_application_review(jsonb)') IS NULL OR
     to_regprocedure('public.venture_agent_record_demand_review(jsonb)') IS NULL OR
     to_regprocedure('public.venture_agent_upsert_directional_candidate(jsonb)') IS NULL OR
     to_regprocedure('public.venture_agent_record_application_dispatch(jsonb)') IS NULL OR
     to_regprocedure('public.venture_agent_record_owner_decision(jsonb)') IS NULL OR
     to_regprocedure('public.venture_agent_record_operator_relay(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'agent RPC package is incomplete';
  END IF;
  SELECT checksum INTO existing_checksum FROM venture_private.schema_migrations WHERE version='013_agent_rpc_008_baseline';
  IF existing_checksum IS NOT NULL AND existing_checksum<>'cdbb91f952fea9f0aec41e2bfeadce0bb149cac1f5d56fad1413653128e2e46d' THEN
    RAISE EXCEPTION 'existing 013 checksum mismatch';
  END IF;
  INSERT INTO venture_private.schema_migrations(version,checksum)
  VALUES('013_agent_rpc_008_baseline','cdbb91f952fea9f0aec41e2bfeadce0bb149cac1f5d56fad1413653128e2e46d')
  ON CONFLICT(version) DO NOTHING;
END $record_agent_rpc$;
COMMIT;
