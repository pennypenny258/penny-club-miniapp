-- FUTURE PACKAGE ONLY. Do not execute until the CloudBase SQL/RPC path has been
-- validated with a non-sensitive disposable environment and the read-only
-- verification in this directory passes. This file is not loaded by runtime.
-- Prerequisites: canonical 004 and 008 only. It never changes CRM facts.
BEGIN;

CREATE TABLE venture_private.member_binding_match_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES venture_private.users(id) ON DELETE CASCADE,
  token_kind text NOT NULL CHECK (token_kind IN ('phone','wechat_id','group_nickname')),
  key_version text NOT NULL CHECK (key_version ~ '^[a-z0-9][a-z0-9._-]{1,31}$'),
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(token_kind,key_version,token_hash,user_id)
);
CREATE INDEX member_binding_match_tokens_lookup_idx ON venture_private.member_binding_match_tokens(token_kind,token_hash) WHERE status='active';

CREATE TABLE venture_private.member_binding_match_options (
  id text PRIMARY KEY,
  app_scope_hash text NOT NULL CHECK (app_scope_hash ~ '^[0-9a-f]{64}$'),
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  token_fingerprint text NOT NULL CHECK (token_fingerprint ~ '^[0-9a-f]{32}$'),
  user_id text NOT NULL REFERENCES venture_private.users(id) ON DELETE CASCADE,
  evidence_types jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_types)='array'),
  account_active boolean NOT NULL,
  group_active boolean NOT NULL,
  month_effective boolean NOT NULL,
  crm_verified boolean NOT NULL,
  final_decision_active boolean NOT NULL,
  contradiction boolean NOT NULL DEFAULT false,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(risk_flags)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at>created_at),
  consumed_at timestamptz
);

CREATE TABLE venture_private.member_binding_candidates (
  id text PRIMARY KEY,
  app_scope_hash text NOT NULL CHECK (app_scope_hash ~ '^[0-9a-f]{64}$'),
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  token_fingerprint text NOT NULL CHECK (token_fingerprint ~ '^[0-9a-f]{32}$'),
  selected_match_id text REFERENCES venture_private.member_binding_match_options(id),
  candidate_count integer NOT NULL CHECK (candidate_count BETWEEN 0 AND 20),
  conflict_status text NOT NULL CHECK (conflict_status IN ('no_match','unique_candidate','multiple_candidates','conflict')),
  evidence_types jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_types)='array'),
  review_reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(review_reasons)='array'),
  status text NOT NULL CHECK (status IN ('pending_review','auto_eligible','bound','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text REFERENCES venture_private.users(id),
  reviewed_at timestamptz,
  decision_reason_code text
);

CREATE TABLE venture_private.member_binding_idempotency (
  idempotency_key_hash text PRIMARY KEY CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  operation text NOT NULL CHECK (operation IN ('bind','reject')),
  candidate_id text NOT NULL REFERENCES venture_private.member_binding_candidates(id),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{32}$'),
  safe_result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_result)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE venture_private.member_binding_match_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.member_binding_match_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.member_binding_match_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.member_binding_match_options FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.member_binding_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.member_binding_candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.member_binding_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.member_binding_idempotency FORCE ROW LEVEL SECURITY;
REVOKE ALL ON venture_private.member_binding_match_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON venture_private.member_binding_match_options FROM PUBLIC, anon, authenticated;
REVOKE ALL ON venture_private.member_binding_candidates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON venture_private.member_binding_idempotency FROM PUBLIC, anon, authenticated;

-- Package-local guard: do not depend on the helper introduced by migration 005.
CREATE OR REPLACE FUNCTION venture_private.assert_member_binding_service_role() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guard$
DECLARE claims_text text; claims jsonb;
BEGIN
  claims_text:=current_setting('request.jwt.claims',true);
  IF claims_text IS NULL OR claims_text='' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  claims:=claims_text::jsonb;
  IF claims->>'role'<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
END $guard$;
REVOKE ALL ON FUNCTION venture_private.assert_member_binding_service_role() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.venture_member_binding_resolve_exact_match(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=venture_private,pg_catalog AS $function$
DECLARE
  app_scope_value text:=p_request->>'appScopeHash'; subject_value text:=p_request->>'subjectHash'; phone_value text:=p_request#>>'{matchTokens,phone}';
  token_fingerprint_value text; match_count integer:=0; matched_user text; option_id text;
  account_active_value boolean:=false; group_active_value boolean:=false; month_effective_value boolean:=false;
  crm_verified_value boolean:=false; decision_active_value boolean:=false; contradiction_value boolean:=false;
  evidence_value jsonb:='[]'::jsonb; risk_value jsonb:='[]'::jsonb; result_status text:='no_match';
BEGIN
  PERFORM venture_private.assert_member_binding_service_role();
  IF app_scope_value !~ '^[0-9a-f]{64}$' OR subject_value !~ '^[0-9a-f]{64}$' OR phone_value !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid verified identity projection'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(coalesce(p_request->'matchTokens','{}'::jsonb)) key WHERE key NOT IN ('phone','wechatId','groupNickname')) THEN RAISE EXCEPTION 'unsupported identity token'; END IF;
  token_fingerprint_value:=md5(coalesce((p_request->'matchTokens')::text,''));
  SELECT count(DISTINCT user_id),min(user_id) INTO match_count,matched_user
  FROM venture_private.member_binding_match_tokens WHERE token_kind='phone' AND token_hash=phone_value AND status='active';
  IF match_count=1 THEN
    SELECT u.account_status='active',c.verification_status='verified',c.group_status='in_group',
      (c.membership_start IS NOT NULL AND c.membership_end IS NOT NULL AND current_date>=c.membership_start AND current_date<c.membership_end)
      INTO account_active_value,crm_verified_value,group_active_value,month_effective_value
    FROM venture_private.users u LEFT JOIN LATERAL(
      SELECT verification_status,group_status,membership_start,membership_end FROM venture_private.crm_verifications
      WHERE user_id=u.id ORDER BY updated_at DESC LIMIT 1
    ) c ON true WHERE u.id=matched_user;
    SELECT coalesce(final_status='active',false)
      INTO decision_active_value FROM venture_private.membership_decisions WHERE user_id=matched_user ORDER BY decided_at DESC LIMIT 1;
    decision_active_value:=coalesce(decision_active_value,false);
    evidence_value:='["verified_phone"]'::jsonb;
    contradiction_value:=NOT(account_active_value AND crm_verified_value AND group_active_value AND month_effective_value AND decision_active_value);
    IF contradiction_value THEN risk_value:='["membership_fact_incomplete_or_inactive"]'::jsonb; END IF;
    option_id:='binding-match-'||md5(random()::text||clock_timestamp()::text);
    INSERT INTO venture_private.member_binding_match_options(id,app_scope_hash,subject_hash,token_fingerprint,user_id,evidence_types,account_active,group_active,month_effective,crm_verified,final_decision_active,contradiction,risk_flags,expires_at)
    VALUES(option_id,app_scope_value,subject_value,token_fingerprint_value,matched_user,evidence_value,account_active_value,group_active_value,month_effective_value,crm_verified_value,decision_active_value,contradiction_value,risk_value,now()+interval '10 minutes');
    result_status:='unique_candidate';
  ELSIF match_count>1 THEN result_status:='multiple_candidates'; risk_value:='["identity_conflict"]'::jsonb;
  END IF;
  RETURN jsonb_build_object('candidateCount',least(match_count,20),'conflictStatus',result_status,'selectedMatchId',option_id,
    'crmAccessProjection',jsonb_build_object('accountActive',account_active_value,'groupStatus',CASE WHEN group_active_value THEN 'in_group' ELSE 'unknown' END,
    'membershipMonthEffective',month_effective_value,'dataComplete',crm_verified_value AND decision_active_value,
    'contradiction',contradiction_value,'riskFlags',risk_value,'entitlementProjectionReady',decision_active_value));
END $function$;

CREATE OR REPLACE FUNCTION public.venture_member_binding_persist_candidate(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=venture_private,pg_catalog AS $function$
DECLARE
  app_scope_value text:=p_request->>'appScopeHash'; subject_value text:=p_request->>'subjectHash'; option_value text:=p_request#>>'{match,selectedMatchId}';
  candidate_count_value integer:=coalesce((p_request#>>'{match,candidateCount}')::integer,0);
  conflict_value text:=coalesce(p_request#>>'{match,conflictStatus}','conflict'); token_fingerprint_value text;
  option_row venture_private.member_binding_match_options%ROWTYPE; candidate_id text; candidate_status text; reasons jsonb:='[]'::jsonb;
BEGIN
  PERFORM venture_private.assert_member_binding_service_role();
  IF app_scope_value !~ '^[0-9a-f]{64}$' OR subject_value !~ '^[0-9a-f]{64}$' OR candidate_count_value NOT BETWEEN 0 AND 20 OR conflict_value NOT IN ('no_match','unique_candidate','multiple_candidates','conflict') THEN RAISE EXCEPTION 'invalid candidate projection'; END IF;
  token_fingerprint_value:=md5(coalesce((p_request->'matchTokens')::text,''));
  IF option_value IS NOT NULL THEN
    SELECT * INTO option_row FROM venture_private.member_binding_match_options WHERE id=option_value AND app_scope_hash=app_scope_value AND subject_hash=subject_value AND token_fingerprint=token_fingerprint_value AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'match option unavailable'; END IF;
  END IF;
  IF conflict_value='unique_candidate' AND option_value IS NULL THEN RAISE EXCEPTION 'unique candidate requires a verified match option'; END IF;
  candidate_status:=CASE WHEN conflict_value='unique_candidate' AND NOT option_row.contradiction AND option_row.account_active AND option_row.group_active AND option_row.month_effective AND option_row.crm_verified AND option_row.final_decision_active THEN 'auto_eligible' ELSE 'pending_review' END;
  IF candidate_status='pending_review' THEN reasons:=CASE conflict_value WHEN 'no_match' THEN '["no_match"]'::jsonb WHEN 'multiple_candidates' THEN '["multiple_candidates"]'::jsonb ELSE '["membership_review_required"]'::jsonb END; END IF;
  candidate_id:='binding-candidate-'||md5(random()::text||clock_timestamp()::text);
  INSERT INTO venture_private.member_binding_candidates(id,app_scope_hash,subject_hash,token_fingerprint,selected_match_id,candidate_count,conflict_status,evidence_types,review_reasons,status)
  VALUES(candidate_id,app_scope_value,subject_value,token_fingerprint_value,option_value,candidate_count_value,conflict_value,coalesce(option_row.evidence_types,'[]'::jsonb),reasons,candidate_status);
  RETURN jsonb_build_object('id',candidate_id,'status',candidate_status,'persisted',true);
END $function$;

CREATE OR REPLACE FUNCTION public.venture_member_binding_list_pending(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path=venture_private,pg_catalog AS $function$
DECLARE limit_value integer:=least(greatest(coalesce((p_request->>'limit')::integer,20),1),100); result_value jsonb;
BEGIN
  PERFORM venture_private.assert_member_binding_service_role();
  SELECT coalesce(jsonb_agg(item ORDER BY item->>'created_at' DESC),'[]'::jsonb) INTO result_value FROM(
    SELECT jsonb_build_object('id',id,'status',status,'candidate_count',candidate_count,'conflict_status',conflict_status,
      'evidence_types',evidence_types,'review_reasons',review_reasons,'match_options',CASE WHEN selected_match_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('match_id',selected_match_id,'evidence_types',evidence_types)) END,
      'created_at',created_at) item FROM venture_private.member_binding_candidates WHERE status='pending_review' ORDER BY created_at DESC LIMIT limit_value
  ) safe_rows;
  RETURN result_value;
END $function$;

CREATE OR REPLACE FUNCTION public.venture_member_binding_bind_and_recompute(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=venture_private,pg_catalog AS $function$
DECLARE
  candidate_value text:=p_request->>'candidateId'; selected_value text:=p_request->>'selectedMatchId'; actor_value text:=p_request->>'actorId';
  mode_value text:=p_request->>'confirmationMode'; authorization_value text:=p_request->>'authorizationId'; reason_value text:=p_request->>'reasonCode';
  idempotency_value text:=p_request->>'idempotencyKey'; fingerprint_value text; candidate_row venture_private.member_binding_candidates%ROWTYPE;
  option_row venture_private.member_binding_match_options%ROWTYPE; existing venture_private.member_binding_idempotency%ROWTYPE;
  binding_id text; binding_row venture_private.external_identity_bindings%ROWTYPE; result_value jsonb;
BEGIN
  PERFORM venture_private.assert_member_binding_service_role();
  IF idempotency_value !~ '^[0-9a-f]{64}$' OR mode_value NOT IN ('automatic_exact_match','operator_review') OR reason_value NOT IN ('crm_exact_match_auto','crm_unique_match','phone_match_confirmed','wechat_id_match_confirmed','manual_evidence_review') THEN RAISE EXCEPTION 'invalid binding request'; END IF;
  fingerprint_value:=md5(coalesce(p_request::text,''));
  SELECT * INTO existing FROM venture_private.member_binding_idempotency WHERE idempotency_key_hash=idempotency_value;
  IF FOUND THEN IF existing.request_fingerprint<>fingerprint_value OR existing.operation<>'bind' THEN RAISE EXCEPTION 'idempotency conflict'; END IF; RETURN existing.safe_result||jsonb_build_object('idempotencyStatus','reused'); END IF;
  SELECT * INTO candidate_row FROM venture_private.member_binding_candidates WHERE id=candidate_value FOR UPDATE;
  IF NOT FOUND OR candidate_row.status NOT IN ('pending_review','auto_eligible') OR candidate_row.selected_match_id<>selected_value THEN RAISE EXCEPTION 'candidate unavailable'; END IF;
  SELECT * INTO option_row FROM venture_private.member_binding_match_options WHERE id=selected_value AND subject_hash=candidate_row.subject_hash AND token_fingerprint=candidate_row.token_fingerprint AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'match option unavailable'; END IF;
  IF mode_value='automatic_exact_match' THEN
    IF candidate_row.status<>'auto_eligible' OR option_row.contradiction OR NOT(option_row.account_active AND option_row.group_active AND option_row.month_effective AND option_row.crm_verified AND option_row.final_decision_active) THEN RAISE EXCEPTION 'automatic binding policy denied'; END IF;
  ELSE
    IF actor_value IS NULL OR authorization_value IS NULL OR NOT EXISTS(SELECT 1 FROM venture_private.admin_action_authorizations WHERE id=authorization_value AND actor_user_id=actor_value AND permission_code='membership.recompute' AND status='reserved' AND expires_at>now()) THEN RAISE EXCEPTION 'operator authorization required'; END IF;
    UPDATE venture_private.admin_action_authorizations SET status='consumed' WHERE id=authorization_value;
  END IF;
  SELECT * INTO binding_row FROM venture_private.external_identity_bindings WHERE app_scope_hash=candidate_row.app_scope_hash AND subject_hash=candidate_row.subject_hash AND revoked_at IS NULL FOR UPDATE;
  IF FOUND AND binding_row.user_id<>option_row.user_id THEN RAISE EXCEPTION 'identity already bound to another member'; END IF;
  IF NOT FOUND THEN
    binding_id:='wechat-binding-'||md5(random()::text||clock_timestamp()::text);
    INSERT INTO venture_private.external_identity_bindings(id,provider,app_scope_hash,subject_hash,user_id,status,bound_by,bound_at,last_verified_at)
    VALUES(binding_id,'wechat_miniprogram',candidate_row.app_scope_hash,candidate_row.subject_hash,option_row.user_id,'active',CASE WHEN mode_value='operator_review' THEN actor_value ELSE NULL END,now(),now());
  ELSE binding_id:=binding_row.id;
  END IF;
  UPDATE venture_private.member_binding_candidates SET status='bound',updated_at=now(),reviewed_by=CASE WHEN mode_value='operator_review' THEN actor_value ELSE NULL END,reviewed_at=now(),decision_reason_code=reason_value WHERE id=candidate_value;
  UPDATE venture_private.member_binding_match_options SET consumed_at=now() WHERE id=selected_value;
  INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary)
  VALUES('audit-'||md5(random()::text||clock_timestamp()::text),CASE WHEN mode_value='operator_review' THEN actor_value ELSE NULL END,'verified_binding_service','member_binding.bind','member_binding_candidate',candidate_value,jsonb_build_object('confirmation_mode',mode_value,'reason_code',reason_value,'entitlement_recheck_required',true,'sensitive_data_included',false));
  result_value:=jsonb_build_object('status','bound','subjectHash',candidate_row.subject_hash,'memberId',option_row.user_id,'bindingId',binding_id,'entitlementRecheckRequired',true);
  INSERT INTO venture_private.member_binding_idempotency(idempotency_key_hash,operation,candidate_id,request_fingerprint,safe_result) VALUES(idempotency_value,'bind',candidate_value,fingerprint_value,result_value);
  RETURN result_value||jsonb_build_object('idempotencyStatus','created');
END $function$;

CREATE OR REPLACE FUNCTION public.venture_member_binding_reject_candidate(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=venture_private,pg_catalog AS $function$
DECLARE
  candidate_value text:=p_request->>'candidateId'; actor_value text:=p_request->>'operatorId'; authorization_value text:=p_request->>'authorizationId';
  reason_value text:=p_request->>'reasonCode'; idempotency_value text:=p_request->>'idempotencyKey'; fingerprint_value text;
  existing venture_private.member_binding_idempotency%ROWTYPE; result_value jsonb;
BEGIN
  PERFORM venture_private.assert_member_binding_service_role();
  IF idempotency_value !~ '^[0-9a-f]{64}$' OR reason_value NOT IN ('no_safe_match','identity_conflict','member_cancelled','evidence_insufficient') THEN RAISE EXCEPTION 'invalid rejection request'; END IF;
  fingerprint_value:=md5(coalesce(p_request::text,''));
  SELECT * INTO existing FROM venture_private.member_binding_idempotency WHERE idempotency_key_hash=idempotency_value;
  IF FOUND THEN IF existing.request_fingerprint<>fingerprint_value OR existing.operation<>'reject' THEN RAISE EXCEPTION 'idempotency conflict'; END IF; RETURN existing.safe_result||jsonb_build_object('idempotencyStatus','reused'); END IF;
  IF NOT EXISTS(SELECT 1 FROM venture_private.admin_action_authorizations WHERE id=authorization_value AND actor_user_id=actor_value AND permission_code='member_import.review' AND status='reserved' AND expires_at>now()) THEN RAISE EXCEPTION 'operator authorization required'; END IF;
  UPDATE venture_private.member_binding_candidates SET status='rejected',updated_at=now(),reviewed_by=actor_value,reviewed_at=now(),decision_reason_code=reason_value WHERE id=candidate_value AND status='pending_review';
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate unavailable'; END IF;
  UPDATE venture_private.admin_action_authorizations SET status='consumed' WHERE id=authorization_value;
  INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary)
  VALUES('audit-'||md5(random()::text||clock_timestamp()::text),actor_value,'verified_admin','member_binding.reject','member_binding_candidate',candidate_value,jsonb_build_object('reason_code',reason_value,'sensitive_data_included',false));
  result_value:=jsonb_build_object('id',candidate_value,'status','rejected');
  INSERT INTO venture_private.member_binding_idempotency(idempotency_key_hash,operation,candidate_id,request_fingerprint,safe_result) VALUES(idempotency_value,'reject',candidate_value,fingerprint_value,result_value);
  RETURN result_value||jsonb_build_object('idempotencyStatus','created');
END $function$;

REVOKE ALL ON FUNCTION public.venture_member_binding_resolve_exact_match(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.venture_member_binding_persist_candidate(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.venture_member_binding_list_pending(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.venture_member_binding_bind_and_recompute(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.venture_member_binding_reject_candidate(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venture_member_binding_resolve_exact_match(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.venture_member_binding_persist_candidate(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.venture_member_binding_list_pending(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.venture_member_binding_bind_and_recompute(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.venture_member_binding_reject_candidate(jsonb) TO service_role;

COMMIT;
