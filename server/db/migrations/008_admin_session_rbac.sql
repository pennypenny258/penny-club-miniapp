-- Forward-only preparation for formal server-side admin identity, opaque sessions and RBAC.
-- Depends on 007. It creates no browser route, identity binding or role assignment.
CREATE TABLE IF NOT EXISTS venture_private.external_admin_identity_bindings (
  id text PRIMARY KEY,user_id text NOT NULL REFERENCES venture_private.users(id),
  provider text NOT NULL CHECK(provider ~ '^[a-z][a-z0-9_.-]{2,47}$'),subject_hash char(64) NOT NULL UNIQUE CHECK(subject_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','revoked')),
  bound_by text NOT NULL REFERENCES venture_private.users(id),bound_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,
  UNIQUE(provider,user_id)
);
CREATE TABLE IF NOT EXISTS venture_private.admin_sessions (
  id text PRIMARY KEY,user_id text NOT NULL REFERENCES venture_private.users(id),session_hash char(64) NOT NULL UNIQUE CHECK(session_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
  issued_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,authenticated_at timestamptz NOT NULL,step_up_verified_at timestamptz,
  revoked_at timestamptz,revoked_by text REFERENCES venture_private.users(id),safe_revoke_reason_code text,
  CHECK(expires_at>issued_at),CHECK(step_up_verified_at IS NULL OR step_up_verified_at<=issued_at)
);
CREATE TABLE IF NOT EXISTS venture_private.admin_action_authorizations (
  id text PRIMARY KEY,session_id text NOT NULL REFERENCES venture_private.admin_sessions(id),actor_user_id text NOT NULL REFERENCES venture_private.users(id),
  permission_code text NOT NULL,action_key_hash char(64) NOT NULL UNIQUE CHECK(action_key_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','consumed','rejected')),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL
);
ALTER TABLE venture_private.external_admin_identity_bindings ENABLE ROW LEVEL SECURITY;ALTER TABLE venture_private.external_admin_identity_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.admin_sessions ENABLE ROW LEVEL SECURITY;ALTER TABLE venture_private.admin_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_private.admin_action_authorizations ENABLE ROW LEVEL SECURITY;ALTER TABLE venture_private.admin_action_authorizations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON venture_private.external_admin_identity_bindings,venture_private.admin_sessions,venture_private.admin_action_authorizations FROM PUBLIC;

INSERT INTO venture_private.admin_roles(id,code,name,status) VALUES
 ('role-system-admin','system_admin','系统管理员','active'),('role-operations','operations','运营人员','active'),
 ('role-reviewer','reviewer','审核人员','active'),('role-auditor','auditor','审计人员','active')
ON CONFLICT(code) DO UPDATE SET name=excluded.name;
INSERT INTO venture_private.admin_permissions(id,code,description) VALUES
 ('perm-admin-role-manage','admin.role.manage','管理后台角色'),('perm-admin-session-revoke','admin.session.revoke','撤销后台会话'),('perm-admin-readiness','admin.readiness.read','查看安全就绪状态'),
 ('perm-resource-manage','resource.manage','管理资料草稿'),('perm-resource-review','resource.review','审核资料发布'),('perm-activity-manage','activity.manage','管理活动'),('perm-demand-manage','demand.manage','管理需求'),('perm-demand-review','demand.review','审核需求'),('perm-audit-read','audit.read','查看脱敏审计'),
 ('perm-import-stage','member_import.stage','创建导入批次'),('perm-import-review','member_import.review','复核导入行'),('perm-import-rollback','member_import.rollback','回滚导入批次'),
 ('perm-materialize-request','member_import.materialize.request','申请事实物化'),('perm-materialize-execute','member_import.materialize.execute','执行事实物化'),('perm-materialize-compensate','member_import.materialize.compensate','补偿事实物化'),
 ('perm-membership-recompute','membership.recompute','重算最终会籍'),('perm-directory-publish','directory.publish.approve','独立批准公开名册')
ON CONFLICT(code) DO UPDATE SET description=excluded.description;
INSERT INTO venture_private.admin_role_permissions(role_id,permission_id)
SELECT role.id,permission.id FROM venture_private.admin_roles role CROSS JOIN venture_private.admin_permissions permission
WHERE role.code='system_admin' OR (role.code='operations' AND permission.code IN ('admin.readiness.read','resource.manage','activity.manage','demand.manage','member_import.stage','member_import.rollback','member_import.materialize.execute'))
 OR (role.code='reviewer' AND permission.code IN ('admin.readiness.read','resource.review','demand.review','member_import.review','member_import.materialize.request','member_import.materialize.compensate','membership.recompute','directory.publish.approve'))
 OR (role.code='auditor' AND permission.code IN ('admin.readiness.read','audit.read'))
ON CONFLICT DO NOTHING;
DELETE FROM venture_private.admin_role_permissions mapping USING venture_private.admin_roles role,venture_private.admin_permissions permission
WHERE mapping.role_id=role.id AND mapping.permission_id=permission.id AND role.code IN ('operations','reviewer','auditor')
 AND NOT ((role.code='operations' AND permission.code IN ('admin.readiness.read','resource.manage','activity.manage','demand.manage','member_import.stage','member_import.rollback','member_import.materialize.execute'))
   OR (role.code='reviewer' AND permission.code IN ('admin.readiness.read','resource.review','demand.review','member_import.review','member_import.materialize.request','member_import.materialize.compensate','membership.recompute','directory.publish.approve'))
   OR (role.code='auditor' AND permission.code IN ('admin.readiness.read','audit.read')));

CREATE OR REPLACE FUNCTION venture_private.admin_has_permission(p_user_id text,p_permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM admin_role_assignments assignment JOIN admin_roles role ON role.id=assignment.role_id JOIN admin_role_permissions mapping ON mapping.role_id=role.id JOIN admin_permissions permission ON permission.id=mapping.permission_id WHERE assignment.user_id=p_user_id AND assignment.revoked_at IS NULL AND role.status='active' AND permission.code=p_permission)
$$;

CREATE OR REPLACE VIEW public.venture_admin_session_access WITH (security_barrier=true) AS
SELECT session.id AS session_id,session.session_hash,session.user_id,session.status,session.issued_at,session.expires_at,session.authenticated_at,session.step_up_verified_at,
 coalesce(array_agg(DISTINCT role.code) FILTER(WHERE role.code IS NOT NULL),'{}'::text[]) AS roles,
 coalesce(array_agg(DISTINCT permission.code) FILTER(WHERE permission.code IS NOT NULL),'{}'::text[]) AS permissions,
 md5(coalesce(string_agg(DISTINCT assignment.id||':'||assignment.granted_at::text,',' ORDER BY assignment.id||':'||assignment.granted_at::text),'')) AS assignment_version
FROM venture_private.admin_sessions session
LEFT JOIN venture_private.admin_role_assignments assignment ON assignment.user_id=session.user_id AND assignment.revoked_at IS NULL
LEFT JOIN venture_private.admin_roles role ON role.id=assignment.role_id AND role.status='active'
LEFT JOIN venture_private.admin_role_permissions mapping ON mapping.role_id=role.id
LEFT JOIN venture_private.admin_permissions permission ON permission.id=mapping.permission_id
GROUP BY session.id;
REVOKE ALL ON public.venture_admin_session_access FROM PUBLIC;
DO $admin_grants$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.venture_admin_session_access FROM anon;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.venture_admin_session_access FROM authenticated;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT ON public.venture_admin_session_access TO service_role;END IF;
END $admin_grants$;

CREATE OR REPLACE FUNCTION public.venture_begin_admin_session(p_subject_hash text,p_session_hash text,p_issued_at timestamptz,p_expires_at timestamptz,p_authenticated_at timestamptz,p_step_up_verified_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$ DECLARE binding record;session_id text;BEGIN
 PERFORM venture_private.assert_cloudbase_service_role();
 IF p_subject_hash !~ '^[0-9a-f]{64}$' OR p_session_hash !~ '^[0-9a-f]{64}$' OR p_expires_at<=p_issued_at OR p_expires_at>p_issued_at+interval '8 hours' THEN RAISE EXCEPTION 'invalid admin session input';END IF;
 SELECT map.user_id INTO binding FROM venture_private.external_admin_identity_bindings map WHERE map.subject_hash=p_subject_hash AND map.status='active';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM venture_private.admin_role_assignments assignment JOIN venture_private.admin_roles role ON role.id=assignment.role_id WHERE assignment.user_id=binding.user_id AND assignment.revoked_at IS NULL AND role.status='active') THEN RAISE EXCEPTION 'admin identity not authorized';END IF;
 session_id:='admin-session-'||md5(random()::text||clock_timestamp()::text);INSERT INTO venture_private.admin_sessions(id,user_id,session_hash,issued_at,expires_at,authenticated_at,step_up_verified_at) VALUES(session_id,binding.user_id,p_session_hash,p_issued_at,p_expires_at,p_authenticated_at,p_step_up_verified_at);
 INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary) VALUES('audit-'||md5(random()::text||clock_timestamp()::text),binding.user_id,'verified_admin','admin.session.begin','admin_session',session_id,jsonb_build_object('sensitive_data_included',false));
 RETURN jsonb_build_object('session_id',session_id,'status','active');END $$;

CREATE OR REPLACE FUNCTION public.venture_reserve_admin_action(p_session_id text,p_actor_id text,p_permission text,p_action_key_hash text,p_step_up_required boolean,p_excluded_actor_ids text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$ DECLARE session venture_private.admin_sessions%ROWTYPE;authorization_id text;existing venture_private.admin_action_authorizations%ROWTYPE;BEGIN
 PERFORM venture_private.assert_cloudbase_service_role();SELECT * INTO session FROM venture_private.admin_sessions WHERE id=p_session_id FOR UPDATE;
 IF NOT FOUND OR session.user_id<>p_actor_id OR session.status<>'active' OR session.expires_at<=now() OR NOT venture_private.admin_has_permission(p_actor_id,p_permission) THEN RAISE EXCEPTION 'admin authorization denied';END IF;
 IF p_step_up_required AND (session.step_up_verified_at IS NULL OR session.step_up_verified_at<now()-interval '15 minutes') THEN RAISE EXCEPTION 'admin step up required';END IF;
 IF p_actor_id=ANY(coalesce(p_excluded_actor_ids,'{}'::text[])) THEN RAISE EXCEPTION 'separation of duties required';END IF;
 SELECT * INTO existing FROM venture_private.admin_action_authorizations WHERE action_key_hash=p_action_key_hash;
 IF FOUND THEN IF existing.session_id<>p_session_id OR existing.permission_code<>p_permission THEN RAISE EXCEPTION 'admin action idempotency conflict';END IF;RETURN jsonb_build_object('authorized',true,'authorization_id',existing.id,'reused',true);END IF;
 authorization_id:='admin-action-'||md5(random()::text||clock_timestamp()::text);INSERT INTO venture_private.admin_action_authorizations(id,session_id,actor_user_id,permission_code,action_key_hash,expires_at) VALUES(authorization_id,p_session_id,p_actor_id,p_permission,p_action_key_hash,least(session.expires_at,now()+interval '10 minutes'));
 INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary) VALUES('audit-'||md5(random()::text||clock_timestamp()::text),p_actor_id,'verified_admin','admin.action.authorize','admin_action_authorization',authorization_id,jsonb_build_object('permission_code',p_permission,'sensitive_data_included',false));
 RETURN jsonb_build_object('authorized',true,'authorization_id',authorization_id);END $$;

CREATE OR REPLACE FUNCTION public.venture_revoke_admin_session(p_session_id text,p_actor_id text,p_reason_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=venture_private,pg_catalog AS $$ BEGIN
 PERFORM venture_private.assert_cloudbase_service_role();IF NOT venture_private.admin_has_permission(p_actor_id,'admin.session.revoke') OR p_reason_code !~ '^[a-z][a-z0-9_]{1,47}$' THEN RAISE EXCEPTION 'session revoke denied';END IF;
 UPDATE venture_private.admin_sessions SET status='revoked',revoked_at=now(),revoked_by=p_actor_id,safe_revoke_reason_code=p_reason_code WHERE id=p_session_id AND status='active';
 INSERT INTO venture_private.audit_logs(id,actor_user_id,actor_role,action,subject_type,subject_id,safe_change_summary) VALUES('audit-'||md5(random()::text||clock_timestamp()::text),p_actor_id,'verified_admin','admin.session.revoke','admin_session',p_session_id,jsonb_build_object('reason_code',p_reason_code,'sensitive_data_included',false));RETURN jsonb_build_object('session_id',p_session_id,'status','revoked');END $$;

REVOKE ALL ON FUNCTION public.venture_begin_admin_session(text,text,timestamptz,timestamptz,timestamptz,timestamptz),public.venture_reserve_admin_action(text,text,text,text,boolean,text[]),public.venture_revoke_admin_session(text,text,text) FROM PUBLIC;
DO $admin_rpc_grants$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON FUNCTION public.venture_begin_admin_session(text,text,timestamptz,timestamptz,timestamptz,timestamptz),public.venture_reserve_admin_action(text,text,text,text,boolean,text[]),public.venture_revoke_admin_session(text,text,text) FROM anon;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON FUNCTION public.venture_begin_admin_session(text,text,timestamptz,timestamptz,timestamptz,timestamptz),public.venture_reserve_admin_action(text,text,text,text,boolean,text[]),public.venture_revoke_admin_session(text,text,text) FROM authenticated;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT EXECUTE ON FUNCTION public.venture_begin_admin_session(text,text,timestamptz,timestamptz,timestamptz,timestamptz),public.venture_reserve_admin_action(text,text,text,text,boolean,text[]),public.venture_revoke_admin_session(text,text,text) TO service_role;END IF;
END $admin_rpc_grants$;
