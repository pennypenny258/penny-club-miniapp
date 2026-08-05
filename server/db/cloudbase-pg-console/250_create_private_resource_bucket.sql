-- CloudBase PG Storage companion for 005. Prepare only; do not run in anonymous staging now.
-- Creates one private bucket with the same 25MB and MIME allowlist enforced by Node.
DO $require_pg_storage$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'CloudBase PG Storage schema is unavailable; stop without creating a bucket';
  END IF;
END $require_pg_storage$;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES(
  'venture-private-resources','venture-private-resources',false,26214400,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4','audio/mpeg','audio/mp4','image/png','image/jpeg',
    'text/markdown','text/plain','application/zip'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

DO $verify_private_resource_bucket$
DECLARE bucket storage.buckets%ROWTYPE;
BEGIN
  SELECT * INTO bucket FROM storage.buckets WHERE id='venture-private-resources';
  IF NOT FOUND OR bucket.public IS NOT FALSE OR bucket.file_size_limit<>26214400 OR
     bucket.allowed_mime_types IS DISTINCT FROM ARRAY[
       'application/pdf',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation',
       'video/mp4','audio/mpeg','audio/mp4','image/png','image/jpeg',
       'text/markdown','text/plain','application/zip'
     ]::text[] THEN
    RAISE EXCEPTION 'Existing resource bucket does not match the reviewed private contract';
  END IF;
END $verify_private_resource_bucket$;
