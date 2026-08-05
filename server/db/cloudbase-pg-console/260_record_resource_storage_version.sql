-- Run only after 004, 005 and the reviewed private bucket script all succeed.
-- Writes migration metadata only; never reads or writes business rows.
BEGIN;
DO $verify_resource_storage_objects$
BEGIN
  IF to_regclass('venture_private.schema_migrations') IS NULL OR
     to_regclass('venture_private.external_identity_bindings') IS NULL OR
     to_regclass('venture_private.resource_upload_intents') IS NULL OR
     to_regclass('venture_private.resource_files') IS NULL OR
     to_regclass('public.venture_resource_storage_compliance') IS NULL OR
     to_regclass('public.venture_resource_download_object') IS NULL OR
     NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='venture-private-resources' AND public=false) THEN
    RAISE EXCEPTION 'Resource storage objects are incomplete; stop without recording version 005';
  END IF;
END $verify_resource_storage_objects$;

DO $reject_resource_storage_checksum_mismatch$
BEGIN
  IF EXISTS (
    SELECT 1 FROM venture_private.schema_migrations
    WHERE version='005_resource_private_storage'
      AND checksum<>'8a21629626d29bf3a45975be675033b01db7992ce58a6e07200a11dbbbf0d03b'
  ) THEN
    RAISE EXCEPTION 'Existing migration 005 checksum mismatch; stop and investigate';
  END IF;
END $reject_resource_storage_checksum_mismatch$;

INSERT INTO venture_private.schema_migrations(version,checksum)
VALUES ('005_resource_private_storage','8a21629626d29bf3a45975be675033b01db7992ce58a6e07200a11dbbbf0d03b')
ON CONFLICT (version) DO NOTHING;
COMMIT;
