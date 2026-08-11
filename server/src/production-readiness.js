'use strict';

const REQUIRED_BINDING_MIGRATION='012_member_binding_rpc_008_baseline';
const REQUIRED_BASELINE='008_admin_session_rbac';
const SECRET_CATEGORIES=Object.freeze([
  ['miniProgramAppSecret','WECHAT_MINIPROGRAM_APP_SECRET'],
  ['subjectHmacKey','WECHAT_IDENTITY_SUBJECT_HMAC_KEY'],
  ['sessionEncryptionKey','MEMBER_SESSION_ENCRYPTION_KEY']
]);
const CANARY_CHECKS=Object.freeze([
  ['wechatCodeExchange','微信 code2Session 仅返回服务端 subject，不返回 session_key、昵称或群状态'],
  ['explicitPhoneConsent','手机号仅在用户明确点击授权后由服务端换取'],
  ['uniqueActiveCrmMatch','唯一 CRM 精确匹配且账号、有效期和大群状态有效时才自动绑定'],
  ['exceptionQueue','未匹配、多匹配、缺失、矛盾、非在群或风险标记全部进入人工队列'],
  ['revokedSession','解绑、会籍失效或会话撤销后立即拒绝访问'],
  ['agentHumanReview','需求只进入人工审核，三种分发方式均不自动发布或推送'],
  ['directionalGuard','定向候选满足 3-of-4，同一候选 14 天内不重复提醒'],
  ['operatorRelay','三段式申请经需求方同意后仍由运营代转，响应不含联系人'],
  ['dependencyFailure','微信、RPC 或数据库异常均返回安全错误且不回退演示或内存']
]);

function present(value){return Boolean(String(value||'').trim())}
function stage(key,label,passed,blockedBy=[]){return {key,label,status:passed?'passed':blockedBy.length?'blocked':'pending',passed:Boolean(passed),blockedBy:[...blockedBy]}}
function buildUnifiedProductionReadiness({environment=process.env,bindingManifestVerified=false,matchTokenManifestVerified=false,agentManifestVerified=false,formalBindingRoutesEnabled=false,formalAgentRoutesEnabled=false,canaryEvidence={}}={}){
  const productionProfile=environment.NODE_ENV==='production'&&environment.DEPLOYMENT_PROFILE!=='cloudbase_staging_demo'&&environment.DEMO_DATA_ONLY==='false';
  const gatewaySelected=environment.DATA_REPOSITORY==='cloudbase_gateway';
  const baselineApplied=environment.CLOUDBASE_PG_MIGRATIONS_APPLIED===REQUIRED_BASELINE;
  const future012Applied=environment.CLOUDBASE_MEMBER_BINDING_RPC_MIGRATION_APPLIED===REQUIRED_BINDING_MIGRATION;
  const bindingCapabilities=future012Applied&&bindingManifestVerified===true&&matchTokenManifestVerified===true;
  const agentCapabilities=baselineApplied&&agentManifestVerified===true;
  const missingWechatSecretCategories=SECRET_CATEGORIES.filter(([,key])=>!present(environment[key])).map(([category])=>category);
  const wechatPublicConfig=present(environment.WECHAT_MINIPROGRAM_APP_ID)&&present(environment.MEMBER_SESSION_ISSUER)&&present(environment.MEMBER_SESSION_AUDIENCE);
  const wechatServerReady=environment.WECHAT_LOGIN_ENABLED==='true'&&environment.MEMBER_IDENTITY_PROVIDER==='external_verified_session'&&environment.MEMBER_BINDING_MODE==='crm_exact_match_or_operator_review'&&environment.MEMBER_SESSION_REVOCATION_STORE==='external_persistent'&&wechatPublicConfig&&missingWechatSecretCategories.length===0;
  const adminBoundaryReady=environment.FORMAL_ADMIN_AUTH_ENABLED==='true'&&present(environment.ADMIN_SESSION_HASH_KEY)&&present(environment.ADMIN_SUBJECT_HMAC_KEY)&&environment.ADMIN_SESSION_STORE==='external_persistent';
  const prerequisites={productionProfile,gatewaySelected,baselineApplied,future012Applied,bindingManifestVerified:bindingManifestVerified===true,matchTokenManifestVerified:matchTokenManifestVerified===true,agentManifestVerified:agentManifestVerified===true,wechatServerReady,adminBoundaryReady};
  const stages=[];
  stages.push(stage('locked_environment','1. 生产环境保持非演示且选择服务端网关',productionProfile&&gatewaySelected,productionProfile&&gatewaySelected?[]:['production_profile_or_gateway']));
  stages.push(stage('database_baseline','2. 只读确认 004 / 008 与未来 012 迁移证据',stages[0].passed&&baselineApplied&&future012Applied,stages[0].passed?['future_012_not_applied']:['locked_environment']));
  stages.push(stage('rpc_capabilities','3. 只读验证 CRM binding、match-token 与 Agent RPC manifests',stages[1].passed&&bindingCapabilities&&agentCapabilities,stages[1].passed?['rpc_manifests_unverified']:['database_baseline']));
  stages.push(stage('server_identity','4. 配置微信服务端身份、持久撤销与 008 后台会话',stages[2].passed&&wechatServerReady&&adminBoundaryReady,stages[2].passed?['wechat_server_secrets_or_admin_session_missing']:['rpc_capabilities']));
  const canaryPassed=CANARY_CHECKS.every(([key])=>canaryEvidence[key]===true);
  stages.push(stage('safe_canary','5. 使用匿名测试账号执行完整安全 canary',stages[3].passed&&canaryPassed,stages[3].passed?['canary_not_completed']:['server_identity']));
  const routesReady=stages[4].passed&&formalBindingRoutesEnabled===true&&formalAgentRoutesEnabled===true;
  stages.push(stage('guarded_activation','6. 最后单独启用正式绑定与 Agent 路由',routesReady,stages[4].passed?['formal_routes_disabled']:['safe_canary']));
  const blockers=[];
  if(!productionProfile||!gatewaySelected)blockers.push('production_profile_or_gateway_not_ready');
  if(!baselineApplied)blockers.push('004_008_baseline_not_verified');
  if(!future012Applied)blockers.push('future_012_not_applied');
  if(!bindingManifestVerified||!matchTokenManifestVerified)blockers.push('binding_rpc_manifests_unverified');
  if(!agentManifestVerified)blockers.push('agent_rpc_manifest_unverified');
  if(missingWechatSecretCategories.length||!wechatServerReady)blockers.push('wechat_server_secrets_missing_or_unverified');
  if(!adminBoundaryReady)blockers.push('formal_admin_session_not_ready');
  if(!canaryPassed)blockers.push('safe_canary_not_completed');
  if(!formalBindingRoutesEnabled||!formalAgentRoutesEnabled)blockers.push('formal_routes_disabled');
  return {status:routesReady?'ready_for_guarded_activation':'blocked_safe',activated:false,cloudWritesEnabled:false,formalRoutesEnabled:false,memoryFallback:false,demoFallback:false,credentialsAcceptedByUi:false,secretValuesExposed:false,prerequisites,missingSecretCategories:{wechatServer:missingWechatSecretCategories},stages,canaryChecklist:CANARY_CHECKS.map(([key,label])=>({key,label,status:canaryEvidence[key]===true?'passed':'not_run',containsPersonalData:false})),blockers:[...new Set(blockers)],failureBehavior:{wechatUnavailable:'503_no_session',rpcUnavailable:'503_no_write',databaseUnavailable:'503_no_fallback',manifestMismatch:'startup_rejected',canaryFailure:'routes_remain_disabled',contactDisclosure:'never_from_api'},nextSafeAction:!future012Applied?'先停止启用操作；未来仅在受控 SQL 路径执行并只读验证 012。':!bindingCapabilities||!agentCapabilities?'先完成 RPC 只读能力清单验收，不配置路由开关。':!wechatServerReady||!adminBoundaryReady?'仅在云托管服务端配置身份类别，页面不接收任何 Secret。':!canaryPassed?'使用匿名测试账号逐项完成 canary，失败即停止。':'保持路由关闭，进行最终人工变更评审。'};
}

module.exports={REQUIRED_BINDING_MIGRATION,REQUIRED_BASELINE,SECRET_CATEGORIES,CANARY_CHECKS,buildUnifiedProductionReadiness};
