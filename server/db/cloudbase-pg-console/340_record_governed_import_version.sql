-- Run only after 006 completes without error. This writes migration metadata only.
DO $record_governed_import_version$
DECLARE expected_checksum text := 'a9e5889076e27ceb7095f5283cee9b9bb1493b75e757ac89a73d1d81a0612e73'; existing_checksum text;
BEGIN
  IF to_regclass('venture_private.governed_import_batches') IS NULL
     OR to_regclass('venture_private.governed_import_rows') IS NULL
     OR to_regclass('venture_private.member_private_match_tokens') IS NULL
     OR to_regclass('venture_private.member_match_candidates') IS NULL
     OR to_regclass('venture_private.membership_recompute_queue') IS NULL
     OR to_regclass('venture_private.membership_decision_snapshots') IS NULL
     OR to_regclass('public.venture_governed_import_review_queue') IS NULL
     OR to_regclass('public.venture_membership_recompute_inputs') IS NULL THEN
    RAISE EXCEPTION '006 governed import objects are incomplete';
  END IF;
  IF to_regprocedure('public.venture_begin_governed_import(text,text,text,text,text,integer,jsonb)') IS NULL
     OR to_regprocedure('public.venture_rollback_governed_import_batch(text,text,jsonb)') IS NULL
     OR to_regprocedure('public.venture_record_membership_decision(text,text,text,text,jsonb,text,boolean)') IS NULL THEN
    RAISE EXCEPTION '006 governed import RPCs are incomplete';
  END IF;
  SELECT checksum INTO existing_checksum FROM venture_private.schema_migrations WHERE version='006_governed_member_import';
  IF existing_checksum IS NOT NULL AND existing_checksum<>expected_checksum THEN RAISE EXCEPTION 'Existing migration checksum mismatch for 006_governed_member_import'; END IF;
  INSERT INTO venture_private.schema_migrations(version,checksum) VALUES('006_governed_member_import',expected_checksum) ON CONFLICT(version) DO NOTHING;
END $record_governed_import_version$;
