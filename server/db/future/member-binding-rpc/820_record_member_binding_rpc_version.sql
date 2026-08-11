-- FUTURE PACKAGE ONLY. Run only after 012 succeeds and its objects are verified.
BEGIN;
DO $record_member_binding_rpc$
DECLARE existing_checksum text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM venture_private.schema_migrations WHERE version='004_wechat_identity_entitlement' AND checksum='89651f91578a44d1f5fd78e8039c7ded587bbfae3a18764ee4bb3b2090d5a621') THEN
    RAISE EXCEPTION 'verified canonical 004 prerequisite is missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM venture_private.schema_migrations WHERE version='008_admin_session_rbac' AND checksum='1d29f1997e3d63322ae56a0fef78b559d41028e2d278527ffdc0d51e1652bd3d') THEN
    RAISE EXCEPTION 'verified canonical 008 prerequisite is missing';
  END IF;
  IF to_regprocedure('public.venture_member_binding_resolve_exact_match(jsonb)') IS NULL OR
     to_regprocedure('public.venture_member_binding_persist_candidate(jsonb)') IS NULL OR
     to_regprocedure('public.venture_member_binding_list_pending(jsonb)') IS NULL OR
     to_regprocedure('public.venture_member_binding_bind_and_recompute(jsonb)') IS NULL OR
     to_regprocedure('public.venture_member_binding_reject_candidate(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'member binding RPC package is incomplete';
  END IF;
  SELECT checksum INTO existing_checksum FROM venture_private.schema_migrations WHERE version='012_member_binding_rpc_008_baseline';
  IF existing_checksum IS NOT NULL AND existing_checksum<>'42334c45d6f398cf63e76bbbb5b46e2283c78e2786bb9d5fc3809f0676f0bb61' THEN
    RAISE EXCEPTION 'existing 012 checksum mismatch';
  END IF;
  INSERT INTO venture_private.schema_migrations(version,checksum)
  VALUES('012_member_binding_rpc_008_baseline','42334c45d6f398cf63e76bbbb5b46e2283c78e2786bb9d5fc3809f0676f0bb61')
  ON CONFLICT(version) DO NOTHING;
END $record_member_binding_rpc$;
COMMIT;
