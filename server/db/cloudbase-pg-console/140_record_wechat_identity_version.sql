-- Run only after 004_wechat_identity_entitlement.sql succeeds in the reviewed test environment.
-- This writes migration metadata only; it never reads or writes business rows.
BEGIN;
DO $verify_wechat_identity_objects$
BEGIN
  IF to_regclass('venture_private.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'schema_migrations is missing; stop and verify the completed bootstrap first';
  END IF;
  IF to_regclass('venture_private.external_identity_bindings') IS NULL OR
     to_regclass('public.venture_member_access_entitlement') IS NULL THEN
    RAISE EXCEPTION 'WeChat identity objects are incomplete; stop without recording version 004';
  END IF;
END $verify_wechat_identity_objects$;

DO $reject_wechat_identity_checksum_mismatch$
BEGIN
  IF EXISTS (
    SELECT 1 FROM venture_private.schema_migrations
    WHERE version='004_wechat_identity_entitlement'
      AND checksum<>'89651f91578a44d1f5fd78e8039c7ded587bbfae3a18764ee4bb3b2090d5a621'
  ) THEN
    RAISE EXCEPTION 'Existing migration 004 checksum mismatch; stop and investigate';
  END IF;
END $reject_wechat_identity_checksum_mismatch$;

INSERT INTO venture_private.schema_migrations(version,checksum)
VALUES ('004_wechat_identity_entitlement','89651f91578a44d1f5fd78e8039c7ded587bbfae3a18764ee4bb3b2090d5a621')
ON CONFLICT (version) DO NOTHING;
COMMIT;
