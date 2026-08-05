-- Forward-only preparation for server-verified WeChat identity mapping.
-- Store only keyed pseudonyms. Raw openid/unionid, AppSecret and session_key never belong here.
CREATE TABLE IF NOT EXISTS venture_private.external_identity_bindings (
  id text PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('wechat_miniprogram')),
  app_scope_hash char(64) NOT NULL CHECK (app_scope_hash ~ '^[0-9a-f]{64}$'),
  subject_hash char(64) NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  user_id text NOT NULL REFERENCES venture_private.users(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  bound_by text REFERENCES venture_private.users(id),
  bound_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  revoked_at timestamptz,
  UNIQUE(provider,app_scope_hash,subject_hash)
);
CREATE INDEX IF NOT EXISTS external_identity_bindings_user_idx
  ON venture_private.external_identity_bindings(user_id,status);
ALTER TABLE venture_private.external_identity_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.external_identity_bindings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON venture_private.external_identity_bindings FROM PUBLIC;

DO $cloudbase_identity_private_denials$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON venture_private.external_identity_bindings FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON venture_private.external_identity_bindings FROM authenticated;
  END IF;
END $cloudbase_identity_private_denials$;

-- This view is queried only by the Node service with a keyed subject hash.
-- It deliberately excludes raw identity, CRM/payment rows, reason codes and contact data.
CREATE OR REPLACE VIEW public.venture_member_access_entitlement
WITH (security_barrier = true) AS
SELECT
  binding.subject_hash,
  account.id AS member_id,
  (account.account_status='active') AS account_active,
  crm.membership_start,
  crm.membership_end,
  (crm.verification_status='verified') AS crm_verified,
  (
    payment.evidence_status='verified'
    AND payment.product_rule_status='matched'
    AND payment.refund_status='none'
    AND payment.reviewed_at IS NOT NULL
  ) AS payment_verified,
  payment.reviewed_at AS payment_reviewed_at,
  (crm.group_status='in_group') AS group_active,
  (
    decision.crm_status='verified'
    AND decision.payment_evidence_status='verified'
    AND decision.expiry_status='current'
    AND decision.group_status='in_group'
    AND decision.final_status='active'
  ) AS decision_active,
  concat_ws(':',
    coalesce(account.updated_at::text,''),
    coalesce(crm.updated_at::text,''),
    coalesce(payment.reviewed_at::text,''),
    coalesce(decision.decided_at::text,''),
    binding.status
  ) AS entitlement_version
FROM venture_private.external_identity_bindings binding
JOIN venture_private.users account ON account.id=binding.user_id
LEFT JOIN LATERAL (
  SELECT verification_status,membership_start,membership_end,group_status,updated_at
  FROM venture_private.crm_verifications
  WHERE user_id=account.id
  ORDER BY reviewed_at DESC NULLS LAST,updated_at DESC
  LIMIT 1
) crm ON true
LEFT JOIN LATERAL (
  SELECT evidence_status,product_rule_status,refund_status,reviewed_at
  FROM venture_private.payment_evidence
  WHERE user_id=account.id
  ORDER BY reviewed_at DESC NULLS LAST,created_at DESC
  LIMIT 1
) payment ON true
LEFT JOIN LATERAL (
  SELECT crm_status,payment_evidence_status,expiry_status,group_status,final_status,decided_at
  FROM venture_private.membership_decisions
  WHERE user_id=account.id
  ORDER BY decided_at DESC
  LIMIT 1
) decision ON true
WHERE binding.provider='wechat_miniprogram' AND binding.status='active';

REVOKE ALL ON public.venture_member_access_entitlement FROM PUBLIC;
DO $cloudbase_identity_gateway_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.venture_member_access_entitlement FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.venture_member_access_entitlement FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT ON public.venture_member_access_entitlement TO service_role;
  END IF;
END $cloudbase_identity_gateway_grant$;

COMMENT ON TABLE venture_private.external_identity_bindings IS 'Server-managed keyed subject pseudonyms; never store raw WeChat identifiers';
COMMENT ON VIEW public.venture_member_access_entitlement IS 'Server gateway only: minimal recomputable access gate, no source CRM/payment/identity details';
