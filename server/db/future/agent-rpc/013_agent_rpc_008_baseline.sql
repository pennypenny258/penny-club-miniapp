-- FUTURE PACKAGE ONLY. Do not execute until a disposable CloudBase environment
-- has passed the read-only verification in this directory. Runtime never loads
-- this file. Prerequisites are the canonical 001-008 migrations.
BEGIN;

CREATE TABLE venture_private.agent_demand_intakes (
  demand_id text PRIMARY KEY REFERENCES venture_private.demands(id) ON DELETE CASCADE,
  review_elements jsonb NOT NULL CHECK (jsonb_typeof(review_elements)='object'),
  requested_distribution_mode text NOT NULL CHECK (requested_distribution_mode IN ('full_public','redacted_public','private_match')),
  public_details jsonb CHECK (public_details IS NULL OR jsonb_typeof(public_details)='object'),
  automatic_publish boolean NOT NULL DEFAULT false CHECK (automatic_publish=false),
  automatic_push boolean NOT NULL DEFAULT false CHECK (automatic_push=false),
  contact_disclosed boolean NOT NULL DEFAULT false CHECK (contact_disclosed=false),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE venture_private.agent_application_statements (
  application_id text PRIMARY KEY REFERENCES venture_private.demand_applications(id) ON DELETE CASCADE,
  statement jsonb NOT NULL CHECK (jsonb_typeof(statement)='object'),
  delivery_mode text NOT NULL DEFAULT 'operator_relay_only' CHECK (delivery_mode='operator_relay_only'),
  contact_disclosed boolean NOT NULL DEFAULT false CHECK (contact_disclosed=false),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE venture_private.agent_directional_candidates (
  id text PRIMARY KEY,
  demand_id text NOT NULL REFERENCES venture_private.demands(id) ON DELETE CASCADE,
  target_member_id text NOT NULL REFERENCES venture_private.users(id),
  matched_dimensions jsonb NOT NULL CHECK (jsonb_typeof(matched_dimensions)='array' AND jsonb_array_length(matched_dimensions) BETWEEN 3 AND 4),
  deduplication_key char(64) NOT NULL CHECK (deduplication_key ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('awaiting_operator_send','duplicate_suppressed')),
  suppressed_by_14_day_window boolean NOT NULL,
  automatic_send boolean NOT NULL DEFAULT false CHECK (automatic_send=false),
  contact_disclosed boolean NOT NULL DEFAULT false CHECK (contact_disclosed=false),
  created_by text NOT NULL REFERENCES venture_private.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_directional_candidates_dedup_idx
  ON venture_private.agent_directional_candidates(demand_id,target_member_id,created_at DESC);

CREATE TABLE venture_private.agent_mutation_idempotency (
  idempotency_key_hash char(64) PRIMARY KEY CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  operation text NOT NULL CHECK (operation IN (
    'stage_demand','stage_application','review_demand','upsert_directional_candidate',
    'dispatch_application','record_owner_decision','record_operator_relay'
  )),
  actor_user_id text NOT NULL REFERENCES venture_private.users(id),
  subject_id text,
  request_fingerprint char(32) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{32}$'),
  safe_result jsonb NOT NULL CHECK (jsonb_typeof(safe_result)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE venture_private.demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.demands FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.demand_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.demand_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.agent_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.agent_dispatches FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.agent_demand_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.agent_demand_intakes FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.agent_application_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.agent_application_statements FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.agent_directional_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.agent_directional_candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.agent_mutation_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_private.agent_mutation_idempotency FORCE ROW LEVEL SECURITY;
REVOKE ALL ON venture_private.demands,venture_private.demand_applications,venture_private.agent_dispatches,
  venture_private.agent_demand_intakes,venture_private.agent_application_statements,
  venture_private.agent_directional_candidates,venture_private.agent_mutation_idempotency
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION venture_private.assert_agent_service_role() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guard$
DECLARE claims_text text; claims jsonb;
BEGIN
  claims_text:=current_setting('request.jwt.claims',true);
  IF claims_text IS NULL OR claims_text='' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  claims:=claims_text::jsonb;
  IF claims->>'role'<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION venture_private.assert_agent_keys(p_value jsonb,p_allowed text[]) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $keys$
BEGIN
  IF coalesce(jsonb_typeof(p_value),'')<>'object' OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_value) key WHERE NOT(key=ANY(p_allowed))
  ) THEN RAISE EXCEPTION 'unsupported agent projection field'; END IF;
END $keys$;

CREATE OR REPLACE FUNCTION venture_private.consume_agent_authorization(p_authorization_id text,p_actor_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $authorization$
BEGIN
  UPDATE admin_action_authorizations SET status='consumed'
  WHERE id=p_authorization_id AND actor_user_id=p_actor_id AND permission_code='demand.review'
    AND status='reserved' AND expires_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION 'agent operator authorization required'; END IF;
END $authorization$;

REVOKE ALL ON FUNCTION venture_private.assert_agent_service_role(),
  venture_private.assert_agent_keys(jsonb,text[]),
  venture_private.consume_agent_authorization(text,text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.venture_agent_list_published_opportunities(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path=venture_private,pg_catalog AS $function$
DECLARE member_value text:=p_request->>'member_id'; limit_value integer; result_value jsonb;
BEGIN
  PERFORM venture_private.assert_agent_service_role();
  PERFORM venture_private.assert_agent_keys(p_request,ARRAY['member_id','limit']);
  IF member_value !~ '^[A-Za-z0-9_-]{6,128}$' OR NOT EXISTS(
    SELECT 1 FROM users WHERE id=member_value AND account_status='active'
  ) THEN RAISE EXCEPTION 'active member required'; END IF;
  limit_value:=least(greatest(coalesce((p_request->>'limit')::integer,30),1),50);
  SELECT coalesce(jsonb_agg(item ORDER BY item->>'published_at' DESC),'[]'::jsonb) INTO result_value FROM (
    SELECT jsonb_build_object(
      'id',d.id,'type',d.type,'anonymous_title',d.anonymous_title,
      'anonymous_summary',d.anonymous_summary,'public_tags',d.public_tags,
      'distribution_mode',d.disclosure_level,'human_review_status',d.human_review_status,
      'status','published','expires_at',NULL,'published_at',d.published_at
    ) item
    FROM demands d
    WHERE d.status='published' AND d.human_review_status IN ('approved','approved_with_notes')
      AND d.disclosure_level IN ('full_public','redacted_public')
    ORDER BY d.published_at DESC LIMIT limit_value
  ) safe_rows;
  RETURN result_value;
END $function$;

CREATE OR REPLACE FUNCTION public.venture_agent_stage_demand_review(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=venture_private,pg_catalog AS $function$
DECLARE member_value text:=p_request->>'member_id'; key_value text:=p_request->>'idempotency_key_hash';
  type_value text:=p_request->>'demand_type'; mode_value text:=p_request->>'requested_distribution_mode';
  fingerprint_value text:=md5(p_request::text); existing agent_mutation_idempotency%ROWTYPE;
  demand_id text; result_value jsonb;
BEGIN
  PERFORM venture_private.assert_agent_service_role();
  PERFORM venture_private.assert_agent_keys(p_request,ARRAY['member_id','idempotency_key_hash','demand_type','review_elements','requested_distribution_mode','human_review_status','automatic_publish','automatic_push']);
  PERFORM venture_private.assert_agent_keys(p_request->'review_elements',ARRAY['who','why','target']);
  IF member_value !~ '^[A-Za-z0-9_-]{6,128}$' OR key_value !~ '^[0-9a-f]{64}$'
    OR coalesce(type_value,'') NOT IN ('investment','fundraising','ma','recruitment','business_attraction')
    OR coalesce(mode_value,'') NOT IN ('full_public','redacted_public','private_match')
    OR p_request->>'human_review_status'<>'pending'
    OR coalesce((p_request->>'automatic_publish')::boolean,true)
    OR coalesce((p_request->>'automatic_push')::boolean,true)
    OR coalesce(length(p_request#>>'{review_elements,who}'),0) NOT BETWEEN 2 AND 180
    OR coalesce(length(p_request#>>'{review_elements,why}'),0) NOT BETWEEN 4 AND 300
    OR coalesce(length(p_request#>>'{review_elements,target}'),0) NOT BETWEEN 4 AND 300
    OR NOT EXISTS(SELECT 1 FROM users WHERE id=member_value AND account_status='active')
  THEN RAISE EXCEPTION 'invalid demand review projection'; END IF;
  SELECT * INTO existing FROM agent_mutation_idempotency WHERE idempotency_key_hash=key_value;
  IF FOUND THEN
    IF existing.operation<>'stage_demand' OR existing.actor_user_id<>member_value OR existing.request_fingerprint<>fingerprint_value THEN RAISE EXCEPTION 'agent idempotency conflict'; END IF;
    RETURN existing.safe_result||jsonb_build_object('idempotent',true);
  END IF;
  demand_id:='demand-'||md5(random()::text||clock_timestamp()::text);
  INSERT INTO demands(id,owner_user_id,type,anonymous_title,anonymous_summary,public_tags,disclosure_level,human_review_status,status)
  VALUES(demand_id,member_value,type_value,'','', '[]'::jsonb,mode_value,'pending','pending_review');
  INSERT INTO agent_demand_intakes(demand_id,review_elements,requested_distribution_mode)
  VALUES(demand_id,p_request->'review_elements',mode_value);
  result_value:=jsonb_build_object('id',demand_id,'status','pending_review');
  INSERT INTO agent_mutation_idempotency VALUES(key_value,'stage_demand',member_value,demand_id,fingerprint_value,result_value,now());
  INSERT INTO audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary)
  VALUES('audit-'||md5(random()::text||clock_timestamp()::text),member_value,'verified_member','agent.demand.stage','demand',demand_id,jsonb_build_object('distribution_mode',mode_value,'human_review_required',true,'sensitive_data_included',false));
  RETURN result_value||jsonb_build_object('idempotent',false);
END $function$;

CREATE OR REPLACE FUNCTION public.venture_agent_stage_application_review(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=venture_private,pg_catalog AS $function$
DECLARE member_value text:=p_request->>'member_id'; demand_value text:=p_request->>'demand_id'; key_value text:=p_request->>'idempotency_key_hash';
  fingerprint_value text:=md5(p_request::text); existing agent_mutation_idempotency%ROWTYPE; application_id text; result_value jsonb;
BEGIN
  PERFORM venture_private.assert_agent_service_role();
  PERFORM venture_private.assert_agent_keys(p_request,ARRAY['member_id','idempotency_key_hash','demand_id','statement','status','contact_disclosed','delivery_mode']);
  PERFORM venture_private.assert_agent_keys(p_request->'statement',ARRAY['who','why','topic']);
  IF member_value !~ '^[A-Za-z0-9_-]{6,128}$' OR demand_value !~ '^[A-Za-z0-9_-]{6,128}$' OR key_value !~ '^[0-9a-f]{64}$'
    OR p_request->>'status'<>'submitted' OR p_request->>'delivery_mode'<>'operator_relay_only'
    OR coalesce((p_request->>'contact_disclosed')::boolean,true)
    OR coalesce(length(p_request#>>'{statement,who}'),0) NOT BETWEEN 8 AND 180
    OR coalesce(length(p_request#>>'{statement,why}'),0) NOT BETWEEN 12 AND 300
    OR coalesce(length(p_request#>>'{statement,topic}'),0) NOT BETWEEN 12 AND 300
    OR NOT EXISTS(SELECT 1 FROM users WHERE id=member_value AND account_status='active')
    OR NOT EXISTS(SELECT 1 FROM demands WHERE id=demand_value AND status='published' AND human_review_status IN ('approved','approved_with_notes'))
  THEN RAISE EXCEPTION 'invalid application review projection'; END IF;
  SELECT * INTO existing FROM agent_mutation_idempotency WHERE idempotency_key_hash=key_value;
  IF FOUND THEN
    IF existing.operation<>'stage_application' OR existing.actor_user_id<>member_value OR existing.request_fingerprint<>fingerprint_value THEN RAISE EXCEPTION 'agent idempotency conflict'; END IF;
    RETURN existing.safe_result||jsonb_build_object('idempotent',true);
  END IF;
  application_id:='application-'||md5(random()::text||clock_timestamp()::text);
  INSERT INTO demand_applications(id,demand_id,applicant_user_id,reason,status,agent_review_status,disclosed_level)
  VALUES(application_id,demand_value,member_value,'three_part_statement_submitted','submitted','pending','none');
  INSERT INTO agent_application_statements(application_id,statement) VALUES(application_id,p_request->'statement');
  result_value:=jsonb_build_object('id',application_id,'status','submitted');
  INSERT INTO agent_mutation_idempotency VALUES(key_value,'stage_application',member_value,application_id,fingerprint_value,result_value,now());
  INSERT INTO audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary)
  VALUES('audit-'||md5(random()::text||clock_timestamp()::text),member_value,'verified_member','agent.application.stage','demand_application',application_id,jsonb_build_object('delivery_mode','operator_relay_only','sensitive_data_included',false));
  RETURN result_value||jsonb_build_object('idempotent',false);
END $function$;

CREATE OR REPLACE FUNCTION public.venture_agent_record_demand_review(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=venture_private,pg_catalog AS $function$
DECLARE actor_value text:=p_request->>'admin_id'; authorization_value text:=p_request->>'authorization_id'; demand_value text:=p_request->>'demand_id';
  key_value text:=p_request->>'idempotency_key_hash'; decision_value text:=p_request->>'decision'; next_value text:=p_request->>'next_status'; mode_value text:=p_request->>'distribution_mode';
  projection jsonb:=nullif(p_request->'public_projection','null'::jsonb); fingerprint_value text:=md5(p_request::text); existing agent_mutation_idempotency%ROWTYPE; current_value text; result_value jsonb;
BEGIN
  PERFORM venture_private.assert_agent_service_role();
  PERFORM venture_private.assert_agent_keys(p_request,ARRAY['admin_id','authorization_id','idempotency_key_hash','demand_id','decision','next_status','distribution_mode','public_projection','automatic_publish','automatic_push','contact_disclosed']);
  IF actor_value !~ '^[A-Za-z0-9_-]{6,128}$' OR authorization_value !~ '^[A-Za-z0-9_-]{6,128}$' OR demand_value !~ '^[A-Za-z0-9_-]{6,128}$' OR key_value !~ '^[0-9a-f]{64}$'
    OR decision_value NOT IN ('needs_more_information','rejected','archived','approved')
    OR next_value NOT IN ('needs_more_information','rejected','archived','published','private_match_approved')
    OR coalesce((p_request->>'automatic_publish')::boolean,true) OR coalesce((p_request->>'automatic_push')::boolean,true) OR coalesce((p_request->>'contact_disclosed')::boolean,true)
  THEN RAISE EXCEPTION 'invalid demand review decision'; END IF;
  SELECT * INTO existing FROM agent_mutation_idempotency WHERE idempotency_key_hash=key_value;
  IF FOUND THEN
    IF existing.operation<>'review_demand' OR existing.actor_user_id<>actor_value OR existing.request_fingerprint<>fingerprint_value THEN RAISE EXCEPTION 'agent idempotency conflict'; END IF;
    RETURN existing.safe_result||jsonb_build_object('idempotent',true);
  END IF;
  SELECT status INTO current_value FROM demands WHERE id=demand_value FOR UPDATE;
  IF current_value IS NULL OR NOT(
    (current_value IN ('pending_review','needs_more_information') AND decision_value IN ('needs_more_information','rejected','archived','approved'))
    OR (current_value IN ('published','private_match_approved') AND decision_value='archived')
  ) THEN RAISE EXCEPTION 'demand review state transition denied'; END IF;
  IF decision_value='approved' THEN
    IF mode_value='private_match' THEN
      IF next_value<>'private_match_approved' OR projection IS NOT NULL THEN RAISE EXCEPTION 'private match projection denied'; END IF;
      UPDATE demands SET anonymous_title='',anonymous_summary='',public_tags='[]'::jsonb,disclosure_level=mode_value,human_review_status='approved',status=next_value,published_at=NULL WHERE id=demand_value;
      UPDATE agent_demand_intakes SET public_details=NULL,updated_at=now() WHERE demand_id=demand_value;
    ELSE
      PERFORM venture_private.assert_agent_keys(projection,ARRAY['anonymous_title','anonymous_summary','public_tags','distribution_mode','public_details']);
      IF mode_value NOT IN ('full_public','redacted_public') OR next_value<>'published' OR projection->>'distribution_mode'<>mode_value
        OR coalesce(length(projection->>'anonymous_title'),0) NOT BETWEEN 4 AND 120 OR coalesce(length(projection->>'anonymous_summary'),0) NOT BETWEEN 8 AND 500
        OR coalesce(jsonb_typeof(projection->'public_tags'),'')<>'array' OR jsonb_array_length(projection->'public_tags')>10
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(projection->'public_tags') AS tags(tag) WHERE jsonb_typeof(tag)<>'string' OR length(tag#>>'{}') NOT BETWEEN 1 AND 24)
        OR (mode_value='redacted_public' AND projection->'public_details' IS NOT NULL)
      THEN RAISE EXCEPTION 'public demand projection denied'; END IF;
      IF projection->'public_details' IS NOT NULL THEN PERFORM venture_private.assert_agent_keys(projection->'public_details',ARRAY['organization','role','opportunity']); END IF;
      UPDATE demands SET anonymous_title=projection->>'anonymous_title',anonymous_summary=projection->>'anonymous_summary',public_tags=projection->'public_tags',disclosure_level=mode_value,human_review_status='approved',status='published',published_at=now() WHERE id=demand_value;
      UPDATE agent_demand_intakes SET public_details=projection->'public_details',updated_at=now() WHERE demand_id=demand_value;
    END IF;
  ELSE
    IF next_value<>decision_value OR projection IS NOT NULL OR mode_value IS NOT NULL THEN RAISE EXCEPTION 'non-public decision contains projection'; END IF;
    UPDATE demands SET human_review_status=decision_value,status=next_value,published_at=NULL WHERE id=demand_value;
  END IF;
  PERFORM venture_private.consume_agent_authorization(authorization_value,actor_value);
  result_value:=jsonb_build_object('id',demand_value,'status',next_value);
  INSERT INTO agent_mutation_idempotency VALUES(key_value,'review_demand',actor_value,demand_value,fingerprint_value,result_value,now());
  INSERT INTO audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary)
  VALUES('audit-'||md5(random()::text||clock_timestamp()::text),actor_value,'verified_admin','agent.demand.review','demand',demand_value,jsonb_build_object('decision',decision_value,'distribution_mode',mode_value,'sensitive_data_included',false));
  RETURN result_value||jsonb_build_object('idempotent',false);
END $function$;

CREATE OR REPLACE FUNCTION public.venture_agent_upsert_directional_candidate(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=venture_private,pg_catalog AS $function$
DECLARE actor_value text:=p_request->>'admin_id'; authorization_value text:=p_request->>'authorization_id'; key_value text:=p_request->>'idempotency_key_hash';
  demand_value text:=p_request->>'demand_id'; target_value text:=p_request->>'target_member_id'; dedup_value text:=p_request->>'deduplication_key';
  dimensions jsonb:=p_request->'matched_dimensions'; fingerprint_value text:=md5(p_request::text); existing agent_mutation_idempotency%ROWTYPE;
  previous agent_directional_candidates%ROWTYPE; candidate_id text; result_value jsonb;
BEGIN
  PERFORM venture_private.assert_agent_service_role();
  PERFORM venture_private.assert_agent_keys(p_request,ARRAY['admin_id','authorization_id','idempotency_key_hash','demand_id','target_member_id','matched_dimensions','deduplication_key','automatic_send','contact_disclosed']);
  IF actor_value !~ '^[A-Za-z0-9_-]{6,128}$' OR authorization_value !~ '^[A-Za-z0-9_-]{6,128}$' OR key_value !~ '^[0-9a-f]{64}$'
    OR demand_value !~ '^[A-Za-z0-9_-]{6,128}$' OR target_value !~ '^[A-Za-z0-9_-]{6,128}$' OR dedup_value !~ '^[0-9a-f]{64}$'
    OR coalesce(jsonb_typeof(dimensions),'')<>'array' OR jsonb_array_length(dimensions) NOT BETWEEN 3 AND 4
    OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(dimensions) AS dimension(value))<3
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(dimensions) AS dimension(value) WHERE value NOT IN ('person','organization','role','matter'))
    OR coalesce((p_request->>'automatic_send')::boolean,true) OR coalesce((p_request->>'contact_disclosed')::boolean,true)
    OR NOT EXISTS(SELECT 1 FROM demands WHERE id=demand_value AND status IN ('published','private_match_approved') AND human_review_status IN ('approved','approved_with_notes'))
    OR NOT EXISTS(SELECT 1 FROM users WHERE id=target_value AND account_status='active')
  THEN RAISE EXCEPTION 'invalid directional candidate projection'; END IF;
  SELECT * INTO existing FROM agent_mutation_idempotency WHERE idempotency_key_hash=key_value;
  IF FOUND THEN
    IF existing.operation<>'upsert_directional_candidate' OR existing.actor_user_id<>actor_value OR existing.request_fingerprint<>fingerprint_value THEN RAISE EXCEPTION 'agent idempotency conflict'; END IF;
    RETURN existing.safe_result||jsonb_build_object('idempotent',true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(demand_value||':'||target_value));
  SELECT * INTO previous FROM agent_directional_candidates WHERE demand_id=demand_value AND target_member_id=target_value AND created_at>now()-interval '14 days' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    candidate_id:=previous.id;
    result_value:=jsonb_build_object('id',candidate_id,'status','duplicate_suppressed','suppressed_by_14_day_window',true,'next_eligible_at',previous.created_at+interval '14 days');
  ELSE
    candidate_id:='agent-candidate-'||md5(random()::text||clock_timestamp()::text);
    INSERT INTO agent_directional_candidates(id,demand_id,target_member_id,matched_dimensions,deduplication_key,status,suppressed_by_14_day_window,created_by)
    VALUES(candidate_id,demand_value,target_value,dimensions,dedup_value,'awaiting_operator_send',false,actor_value);
    result_value:=jsonb_build_object('id',candidate_id,'status','awaiting_operator_send','suppressed_by_14_day_window',false,'next_eligible_at',NULL);
  END IF;
  PERFORM venture_private.consume_agent_authorization(authorization_value,actor_value);
  INSERT INTO agent_mutation_idempotency VALUES(key_value,'upsert_directional_candidate',actor_value,candidate_id,fingerprint_value,result_value,now());
  INSERT INTO audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary)
  VALUES('audit-'||md5(random()::text||clock_timestamp()::text),actor_value,'verified_admin','agent.directional_candidate.prepare','agent_directional_candidate',candidate_id,jsonb_build_object('matched_dimension_count',jsonb_array_length(dimensions),'duplicate_suppressed',result_value->'suppressed_by_14_day_window','automatic_send',false,'sensitive_data_included',false));
  RETURN result_value||jsonb_build_object('idempotent',false);
END $function$;

CREATE OR REPLACE FUNCTION public.venture_agent_record_application_dispatch(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=venture_private,pg_catalog AS $function$
DECLARE actor_value text:=p_request->>'admin_id'; authorization_value text:=p_request->>'authorization_id'; key_value text:=p_request->>'idempotency_key_hash';
  application_value text:=p_request->>'application_id'; decision_value text:=p_request->>'decision'; reason_value text:=p_request->>'safe_reason_code';
  fingerprint_value text:=md5(p_request::text); existing agent_mutation_idempotency%ROWTYPE; dispatch_id text; result_value jsonb;
BEGIN
  PERFORM venture_private.assert_agent_service_role();
  PERFORM venture_private.assert_agent_keys(p_request,ARRAY['admin_id','authorization_id','idempotency_key_hash','application_id','decision','safe_reason_code','notification_sent','contact_disclosed']);
  IF actor_value !~ '^[A-Za-z0-9_-]{6,128}$' OR authorization_value !~ '^[A-Za-z0-9_-]{6,128}$' OR key_value !~ '^[0-9a-f]{64}$'
    OR application_value !~ '^[A-Za-z0-9_-]{6,128}$' OR decision_value NOT IN ('shortlisted','declined')
    OR length(coalesce(reason_value,''))>48 OR coalesce((p_request->>'notification_sent')::boolean,true) OR coalesce((p_request->>'contact_disclosed')::boolean,true)
  THEN RAISE EXCEPTION 'invalid application dispatch projection'; END IF;
  SELECT * INTO existing FROM agent_mutation_idempotency WHERE idempotency_key_hash=key_value;
  IF FOUND THEN
    IF existing.operation<>'dispatch_application' OR existing.actor_user_id<>actor_value OR existing.request_fingerprint<>fingerprint_value THEN RAISE EXCEPTION 'agent idempotency conflict'; END IF;
    RETURN existing.safe_result||jsonb_build_object('idempotent',true);
  END IF;
  UPDATE demand_applications SET status=decision_value,agent_review_status=decision_value WHERE id=application_value AND status='submitted';
  IF NOT FOUND THEN RAISE EXCEPTION 'application dispatch state transition denied'; END IF;
  dispatch_id:='agent-dispatch-'||md5(random()::text||clock_timestamp()::text);
  INSERT INTO agent_dispatches(id,application_id,assigned_operator_id,decision,safe_reason_code) VALUES(dispatch_id,application_value,actor_value,decision_value,reason_value);
  PERFORM venture_private.consume_agent_authorization(authorization_value,actor_value);
  result_value:=jsonb_build_object('id',application_value,'status',decision_value);
  INSERT INTO agent_mutation_idempotency VALUES(key_value,'dispatch_application',actor_value,application_value,fingerprint_value,result_value,now());
  INSERT INTO audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary)
  VALUES('audit-'||md5(random()::text||clock_timestamp()::text),actor_value,'verified_admin','agent.application.dispatch','demand_application',application_value,jsonb_build_object('decision',decision_value,'reason_code',reason_value,'notification_sent',false,'sensitive_data_included',false));
  RETURN result_value||jsonb_build_object('idempotent',false);
END $function$;

CREATE OR REPLACE FUNCTION public.venture_agent_record_owner_decision(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=venture_private,pg_catalog AS $function$
DECLARE member_value text:=p_request->>'member_id'; application_value text:=p_request->>'application_id'; key_value text:=p_request->>'idempotency_key_hash';
  decision_value text:=p_request->>'decision'; next_value text; fingerprint_value text:=md5(p_request::text); existing agent_mutation_idempotency%ROWTYPE; result_value jsonb;
BEGIN
  PERFORM venture_private.assert_agent_service_role();
  PERFORM venture_private.assert_agent_keys(p_request,ARRAY['member_id','idempotency_key_hash','application_id','decision','contact_disclosed','delivery_mode']);
  IF member_value !~ '^[A-Za-z0-9_-]{6,128}$' OR application_value !~ '^[A-Za-z0-9_-]{6,128}$' OR key_value !~ '^[0-9a-f]{64}$'
    OR decision_value NOT IN ('approved_intro','needs_more_information','declined') OR p_request->>'delivery_mode'<>'operator_relay_only'
    OR coalesce((p_request->>'contact_disclosed')::boolean,true)
  THEN RAISE EXCEPTION 'invalid owner decision projection'; END IF;
  SELECT * INTO existing FROM agent_mutation_idempotency WHERE idempotency_key_hash=key_value;
  IF FOUND THEN
    IF existing.operation<>'record_owner_decision' OR existing.actor_user_id<>member_value OR existing.request_fingerprint<>fingerprint_value THEN RAISE EXCEPTION 'agent idempotency conflict'; END IF;
    RETURN existing.safe_result||jsonb_build_object('idempotent',true);
  END IF;
  next_value:=CASE WHEN decision_value='approved_intro' THEN 'operator_relay_pending' ELSE decision_value END;
  UPDATE demand_applications application SET status=next_value,owner_decision=decision_value,disclosed_level='none'
  FROM demands demand WHERE application.id=application_value AND application.demand_id=demand.id AND demand.owner_user_id=member_value AND application.status='shortlisted';
  IF NOT FOUND THEN RAISE EXCEPTION 'owner decision state transition denied'; END IF;
  result_value:=jsonb_build_object('id',application_value,'status',next_value);
  INSERT INTO agent_mutation_idempotency VALUES(key_value,'record_owner_decision',member_value,application_value,fingerprint_value,result_value,now());
  INSERT INTO audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary)
  VALUES('audit-'||md5(random()::text||clock_timestamp()::text),member_value,'verified_member','agent.application.owner_decision','demand_application',application_value,jsonb_build_object('decision',decision_value,'operator_relay_required',decision_value='approved_intro','sensitive_data_included',false));
  RETURN result_value||jsonb_build_object('idempotent',false);
END $function$;

CREATE OR REPLACE FUNCTION public.venture_agent_record_operator_relay(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=venture_private,pg_catalog AS $function$
DECLARE actor_value text:=p_request->>'admin_id'; authorization_value text:=p_request->>'authorization_id'; key_value text:=p_request->>'idempotency_key_hash';
  application_value text:=p_request->>'application_id'; decision_value text:=p_request->>'decision';
  fingerprint_value text:=md5(p_request::text); existing agent_mutation_idempotency%ROWTYPE; dispatch_id text; result_value jsonb;
BEGIN
  PERFORM venture_private.assert_agent_service_role();
  PERFORM venture_private.assert_agent_keys(p_request,ARRAY['admin_id','authorization_id','idempotency_key_hash','application_id','decision','contact_disclosed','delivery_mode']);
  IF actor_value !~ '^[A-Za-z0-9_-]{6,128}$' OR authorization_value !~ '^[A-Za-z0-9_-]{6,128}$' OR key_value !~ '^[0-9a-f]{64}$'
    OR application_value !~ '^[A-Za-z0-9_-]{6,128}$' OR decision_value NOT IN ('relayed','cancelled') OR p_request->>'delivery_mode'<>'operator_relay_only'
    OR coalesce((p_request->>'contact_disclosed')::boolean,true)
  THEN RAISE EXCEPTION 'invalid operator relay projection'; END IF;
  SELECT * INTO existing FROM agent_mutation_idempotency WHERE idempotency_key_hash=key_value;
  IF FOUND THEN
    IF existing.operation<>'record_operator_relay' OR existing.actor_user_id<>actor_value OR existing.request_fingerprint<>fingerprint_value THEN RAISE EXCEPTION 'agent idempotency conflict'; END IF;
    RETURN existing.safe_result||jsonb_build_object('idempotent',true);
  END IF;
  UPDATE demand_applications SET status=decision_value,disclosed_level='none' WHERE id=application_value AND status='operator_relay_pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'operator relay state transition denied'; END IF;
  dispatch_id:='agent-relay-'||md5(random()::text||clock_timestamp()::text);
  INSERT INTO agent_dispatches(id,application_id,assigned_operator_id,decision,safe_reason_code) VALUES(dispatch_id,application_value,actor_value,decision_value,'operator_relay_only');
  PERFORM venture_private.consume_agent_authorization(authorization_value,actor_value);
  result_value:=jsonb_build_object('id',application_value,'status',decision_value);
  INSERT INTO agent_mutation_idempotency VALUES(key_value,'record_operator_relay',actor_value,application_value,fingerprint_value,result_value,now());
  INSERT INTO audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary)
  VALUES('audit-'||md5(random()::text||clock_timestamp()::text),actor_value,'verified_admin','agent.application.operator_relay','demand_application',application_value,jsonb_build_object('decision',decision_value,'delivery_mode','operator_relay_only','sensitive_data_included',false));
  RETURN result_value||jsonb_build_object('idempotent',false);
END $function$;

REVOKE ALL ON FUNCTION public.venture_agent_list_published_opportunities(jsonb),
  public.venture_agent_stage_demand_review(jsonb),public.venture_agent_stage_application_review(jsonb),
  public.venture_agent_record_demand_review(jsonb),public.venture_agent_upsert_directional_candidate(jsonb),
  public.venture_agent_record_application_dispatch(jsonb),public.venture_agent_record_owner_decision(jsonb),
  public.venture_agent_record_operator_relay(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venture_agent_list_published_opportunities(jsonb),
  public.venture_agent_stage_demand_review(jsonb),public.venture_agent_stage_application_review(jsonb),
  public.venture_agent_record_demand_review(jsonb),public.venture_agent_upsert_directional_candidate(jsonb),
  public.venture_agent_record_application_dispatch(jsonb),public.venture_agent_record_owner_decision(jsonb),
  public.venture_agent_record_operator_relay(jsonb)
  TO service_role;

COMMIT;
