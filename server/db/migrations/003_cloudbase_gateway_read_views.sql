-- CloudBase PG/PostgREST runtime contract: two redacted, read-only views only.
-- The Node service remains the sole public API and continues to enforce RBAC/membership gates.
CREATE OR REPLACE VIEW public.venture_resources_published
WITH (security_barrier = true) AS
SELECT id,type,title,summary,tags,access_level,mobile_section,preview_status,
       download_enabled,published_at,updated_at
FROM venture_private.resources
WHERE status='published' AND rights_review_status='approved';

CREATE OR REPLACE VIEW public.venture_activities_public
WITH (security_barrier = true) AS
SELECT id,format,title,description,starts_at,ends_at,registration_ends_at,
       category,city,venue,status,created_at
FROM venture_private.activities
WHERE status IN ('registration_open','waitlist_open','ended');

REVOKE ALL ON public.venture_resources_published FROM PUBLIC;
REVOKE ALL ON public.venture_activities_public FROM PUBLIC;

DO $cloudbase_gateway_grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.venture_resources_published FROM anon;
    REVOKE ALL ON public.venture_activities_public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.venture_resources_published FROM authenticated;
    REVOKE ALL ON public.venture_activities_public FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT ON public.venture_resources_published TO service_role;
    GRANT SELECT ON public.venture_activities_public TO service_role;
  END IF;
END $cloudbase_gateway_grants$;

COMMENT ON VIEW public.venture_resources_published IS 'Server gateway only: published, rights-approved resource metadata; no private object/source fields';
COMMENT ON VIEW public.venture_activities_public IS 'Server gateway only: public activity metadata; no meeting link or registration facts';
