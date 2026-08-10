-- Forward-only preparation for one-time system-admin bootstrap, two-person role governance and redacted audit reads.
-- Depends on 008. Tables start empty; no identity, role assignment or route is activated by this migration.
BEGIN;

CREATE TABLE IF NOT EXISTS venture_private.admin_bootstrap_authorizations (
 id text PRIMARY KEY,user_id text NOT NULL REFERENCES venture_private.users(id),subject_hash char(64) NOT NULL UNIQUE CHECK(subject_hash ~ '^[0-9a-f]{64}$'),
 ticket_hash char(64) NOT NULL UNIQUE CHECK(ticket_hash ~ '^[0-9a-f]{64}$'),status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','used','expired','revoked')),
 expires_at timestamptz NOT NULL,control_reference text NOT NULL CHECK(control_reference ~ '^[A-Za-z0-9._:-]{8,128}$'),created_at timestamptz NOT NULL DEFAULT now(),used_at timestamptz
);
CREATE TABLE IF NOT EXISTS venture_private.admin_role_change_requests (
 id text PRIMARY KEY,target_user_id text NOT NULL REFERENCES venture_private.users(id),role_id text NOT NULL REFERENCES venture_private.admin_roles(id),
 action text NOT NULL CHECK(action IN ('grant','revoke')),requester_id text NOT NULL REFERENCES venture_private.users(id),approver_id text REFERENCES venture_private.users(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','rejected','cancelled')),idempotency_reference text NOT NULL UNIQUE CHECK(idempotency_reference ~ '^[A-Za-z0-9._:-]{3,127}$'),
 requested_at timestamptz NOT NULL DEFAULT now(),approved_at timestamptz,applied_assignment_id text,
 CHECK(requester_id<>target_user_id),CHECK(approver_id IS NULL OR (approver_id<>requester_id AND approver_id<>target_user_id))
);
ALTER TABLE venture_private.admin_bootstrap_authorizations ENABLE ROW LEVEL SECURITY;ALTER TABLE venture_private.admin_bootstrap_authorizations FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.admin_role_change_requests ENABLE ROW LEVEL SECURITY;ALTER TABLE venture_private.admin_role_change_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON venture_private.admin_bootstrap_authorizations,venture_private.admin_role_change_requests FROM PUBLIC;

CREATE OR REPLACE FUNCTION venture_private.require_fresh_system_admin(p_session_id text,p_actor_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$ DECLARE session venture_private.admin_sessions%ROWTYPE;BEGIN
 SELECT * INTO session FROM venture_private.admin_sessions WHERE id=p_session_id FOR UPDATE;
 IF NOT FOUND OR session.user_id<>p_actor_id OR session.status<>'active' OR session.expires_at<=now() OR session.step_up_verified_at IS NULL OR session.step_up_verified_at<now()-interval '15 minutes' OR NOT venture_private.admin_has_permission(p_actor_id,'admin.role.manage') THEN RAISE EXCEPTION 'fresh system admin authorization required';END IF;
END $$;

CREATE OR REPLACE FUNCTION public.venture_bootstrap_system_admin(p_subject_hash text,p_ticket_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$ DECLARE authorization venture_private.admin_bootstrap_authorizations%ROWTYPE;role_id text;binding_id text;assignment_id text;BEGIN
 PERFORM venture_private.assert_cloudbase_service_role();
 IF p_subject_hash !~ '^[0-9a-f]{64}$' OR p_ticket_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid bootstrap proof';END IF;
 SELECT * INTO authorization FROM venture_private.admin_bootstrap_authorizations WHERE subject_hash=p_subject_hash AND ticket_hash=p_ticket_hash FOR UPDATE;
 IF NOT FOUND OR authorization.status<>'ready' OR authorization.expires_at<=now() THEN RAISE EXCEPTION 'bootstrap authorization unavailable';END IF;
 IF EXISTS(SELECT 1 FROM venture_private.admin_role_assignments assignment JOIN venture_private.admin_roles role ON role.id=assignment.role_id WHERE role.code='system_admin' AND role.status='active' AND assignment.revoked_at IS NULL) THEN RAISE EXCEPTION 'system admin already bootstrapped';END IF;
 IF EXISTS(SELECT 1 FROM venture_private.external_admin_identity_bindings binding WHERE binding.subject_hash=p_subject_hash) THEN RAISE EXCEPTION 'bootstrap subject already bound';END IF;
 SELECT id INTO role_id FROM venture_private.admin_roles WHERE code='system_admin' AND status='active';IF role_id IS NULL THEN RAISE EXCEPTION 'system admin role unavailable';END IF;
 binding_id:='admin-binding-'||md5(random()::text||clock_timestamp()::text);assignment_id:='admin-assignment-'||md5(random()::text||clock_timestamp()::text);
 INSERT INTO venture_private.external_admin_identity_bindings(id,user_id,provider,subject_hash,bound_by) VALUES(binding_id,authorization.user_id,'external_verified',p_subject_hash,authorization.user_id);
 INSERT INTO venture_private.admin_role_assignments(id,user_id,role_id,granted_by) VALUES(assignment_id,authorization.user_id,role_id,authorization.user_id);
 UPDATE venture_private.admin_bootstrap_authorizations SET status='used',used_at=now(),ticket_hash=md5(random()::text||clock_timestamp()::text)||md5(random()::text) WHERE id=authorization.id;
 INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary) VALUES('audit-'||md5(random()::text||clock_timestamp()::text),authorization.user_id,'bootstrap_control','admin.bootstrap.complete','admin_account',authorization.user_id,jsonb_build_object('role_code','system_admin','control_reference',authorization.control_reference,'sensitive_data_included',false));
 RETURN jsonb_build_object('status','bootstrapped','role_code','system_admin','self_registration',false);END $$;

CREATE OR REPLACE FUNCTION public.venture_request_admin_role_change(p_requester_session_id text,p_requester_id text,p_target_user_id text,p_role_code text,p_action text,p_idempotency_reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$ DECLARE role_id text;request_id text;existing venture_private.admin_role_change_requests%ROWTYPE;BEGIN
 PERFORM venture_private.assert_cloudbase_service_role();PERFORM venture_private.require_fresh_system_admin(p_requester_session_id,p_requester_id);
 IF p_target_user_id=p_requester_id OR p_role_code NOT IN ('system_admin','operations','reviewer','auditor') OR p_action NOT IN ('grant','revoke') THEN RAISE EXCEPTION 'invalid role change';END IF;
 SELECT id INTO role_id FROM venture_private.admin_roles WHERE code=p_role_code AND status='active';IF role_id IS NULL THEN RAISE EXCEPTION 'role unavailable';END IF;
 SELECT * INTO existing FROM venture_private.admin_role_change_requests WHERE idempotency_reference=p_idempotency_reference;
 IF FOUND THEN IF existing.requester_id<>p_requester_id OR existing.target_user_id<>p_target_user_id OR existing.role_id<>role_id OR existing.action<>p_action THEN RAISE EXCEPTION 'role change idempotency conflict';END IF;RETURN jsonb_build_object('request_id',existing.id,'status',existing.status,'reused',true);END IF;
 request_id:='role-change-'||md5(random()::text||clock_timestamp()::text);INSERT INTO venture_private.admin_role_change_requests(id,target_user_id,role_id,action,requester_id,idempotency_reference) VALUES(request_id,p_target_user_id,role_id,p_action,p_requester_id,p_idempotency_reference);
 INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary) VALUES('audit-'||md5(random()::text||clock_timestamp()::text),p_requester_id,'system_admin','admin.role_change.request','admin_role_change',request_id,jsonb_build_object('role_code',p_role_code,'change_action',p_action,'sensitive_data_included',false));RETURN jsonb_build_object('request_id',request_id,'status','pending');END $$;

CREATE OR REPLACE FUNCTION public.venture_approve_admin_role_change(p_approver_session_id text,p_approver_id text,p_request_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$ DECLARE request record;assignment_id text;BEGIN
 PERFORM venture_private.assert_cloudbase_service_role();PERFORM venture_private.require_fresh_system_admin(p_approver_session_id,p_approver_id);
 SELECT change.*,role.code AS role_code INTO request FROM venture_private.admin_role_change_requests change JOIN venture_private.admin_roles role ON role.id=change.role_id WHERE change.id=p_request_id FOR UPDATE OF change;
 IF NOT FOUND OR request.status<>'pending' OR p_approver_id IN (request.requester_id,request.target_user_id) THEN RAISE EXCEPTION 'independent role approval required';END IF;
 IF request.action='grant' THEN
   IF EXISTS(SELECT 1 FROM venture_private.admin_role_assignments WHERE user_id=request.target_user_id AND role_id=request.role_id AND revoked_at IS NULL) THEN RAISE EXCEPTION 'role already active';END IF;
   assignment_id:='admin-assignment-'||md5(random()::text||clock_timestamp()::text);INSERT INTO venture_private.admin_role_assignments(id,user_id,role_id,granted_by) VALUES(assignment_id,request.target_user_id,request.role_id,p_approver_id);
 ELSE
   UPDATE venture_private.admin_role_assignments SET revoked_at=now() WHERE user_id=request.target_user_id AND role_id=request.role_id AND revoked_at IS NULL;IF NOT FOUND THEN RAISE EXCEPTION 'active role assignment not found';END IF;
   UPDATE venture_private.admin_sessions SET status='revoked',revoked_at=now(),revoked_by=p_approver_id,safe_revoke_reason_code='role_revoked' WHERE user_id=request.target_user_id AND status='active';
   UPDATE venture_private.admin_action_authorizations SET status='rejected' WHERE actor_user_id=request.target_user_id AND status='reserved';
 END IF;
 UPDATE venture_private.admin_role_change_requests SET status='applied',approver_id=p_approver_id,approved_at=now(),applied_assignment_id=assignment_id WHERE id=p_request_id;
 INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary) VALUES('audit-'||md5(random()::text||clock_timestamp()::text),p_approver_id,'system_admin','admin.role_change.apply','admin_role_change',p_request_id,jsonb_build_object('role_code',request.role_code,'change_action',request.action,'sessions_revoked',request.action='revoke','unused_authorizations_revoked',request.action='revoke','sensitive_data_included',false));
 RETURN jsonb_build_object('request_id',p_request_id,'status','applied','sessions_revoked',request.action='revoke');END $$;

CREATE OR REPLACE FUNCTION public.venture_read_redacted_admin_audit(p_session_id text,p_before timestamptz,p_limit integer) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$ DECLARE session venture_private.admin_sessions%ROWTYPE;BEGIN
 PERFORM venture_private.assert_cloudbase_service_role();SELECT * INTO session FROM venture_private.admin_sessions WHERE id=p_session_id;
 IF NOT FOUND OR session.status<>'active' OR session.expires_at<=now() OR NOT venture_private.admin_has_permission(session.user_id,'audit.read') OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'audit read denied';END IF;
 RETURN QUERY SELECT jsonb_strip_nulls(jsonb_build_object('occurred_at',log.created_at,'actor_reference',md5('admin-audit-v1:'||coalesce(log.actor_user_id,'system')),'action',log.action,'subject_type',log.subject_type,'subject_reference',md5('admin-audit-v1:'||coalesce(log.subject_id,'none')),'status',log.safe_change_summary->>'status','reason_code',log.safe_change_summary->>'reason_code','role_code',log.safe_change_summary->>'role_code','change_action',log.safe_change_summary->>'change_action','domain',log.safe_change_summary->>'domain','sensitive_data_included',false)) FROM venture_private.audit_logs log WHERE (p_before IS NULL OR log.created_at<p_before) ORDER BY log.created_at DESC LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION public.venture_bootstrap_system_admin(text,text),public.venture_request_admin_role_change(text,text,text,text,text,text),public.venture_approve_admin_role_change(text,text,text),public.venture_read_redacted_admin_audit(text,timestamptz,integer) FROM PUBLIC;
DO $admin_governance_grants$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON FUNCTION public.venture_bootstrap_system_admin(text,text),public.venture_request_admin_role_change(text,text,text,text,text,text),public.venture_approve_admin_role_change(text,text,text),public.venture_read_redacted_admin_audit(text,timestamptz,integer) FROM anon';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON FUNCTION public.venture_bootstrap_system_admin(text,text),public.venture_request_admin_role_change(text,text,text,text,text,text),public.venture_approve_admin_role_change(text,text,text),public.venture_read_redacted_admin_audit(text,timestamptz,integer) FROM authenticated';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.venture_bootstrap_system_admin(text,text),public.venture_request_admin_role_change(text,text,text,text,text,text),public.venture_approve_admin_role_change(text,text,text),public.venture_read_redacted_admin_audit(text,timestamptz,integer) TO service_role';END IF;
END $admin_governance_grants$;

COMMIT;
