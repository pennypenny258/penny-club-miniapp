'use strict';

const REQUIRED_MIGRATION='008_admin_session_rbac';
function present(value){return Boolean(String(value||'').trim())}
function flag(value){if(value===undefined||value===null||value==='')return false;if(value==='true')return true;if(value==='false')return false;throw new Error('FORMAL_MEMBER_BINDING_ROUTES_ENABLED 只允许 true 或 false')}
function resolveFormalMemberBindingHttpConfig(environment=process.env){
  const enabled=flag(environment.FORMAL_MEMBER_BINDING_ROUTES_ENABLED);
  if(!enabled)return {enabled:false,prefix:'/api/formal-member-binding',safeSummary:{enabled:false,memoryFallback:false,crmWrites:false}};
  const required=['CLOUDBASE_PG_MIGRATIONS_APPLIED','FORMAL_ADMIN_AUTH_ENABLED','WECHAT_LOGIN_ENABLED','MEMBER_BINDING_MODE'];const missing=required.filter(key=>!present(environment[key]));if(missing.length)throw new Error(`正式会员绑定路由配置不完整：缺少 ${missing.join(', ')}`);
  if(environment.NODE_ENV!=='production'||environment.DATA_REPOSITORY!=='cloudbase_gateway')throw new Error('正式会员绑定路由只允许在生产 CloudBase 网关模式启用');
  if(environment.DEPLOYMENT_PROFILE==='cloudbase_staging_demo'||environment.DEMO_DATA_ONLY==='true')throw new Error('匿名 staging 禁止启用正式会员绑定路由');
  if(environment.CLOUDBASE_PG_MIGRATIONS_APPLIED!==REQUIRED_MIGRATION)throw new Error(`正式会员绑定路由要求迁移基线为 ${REQUIRED_MIGRATION}`);
  if(environment.WECHAT_LOGIN_ENABLED!=='true'||environment.FORMAL_ADMIN_AUTH_ENABLED!=='true')throw new Error('正式会员绑定路由要求服务端微信身份与 008 后台会话均已启用');
  if(environment.MEMBER_BINDING_MODE!=='crm_exact_match_or_operator_review')throw new Error('正式会员绑定路由要求唯一 CRM 精确匹配自动绑定、其余人工复核模式');
  return {enabled:true,prefix:'/api/formal-member-binding',migrationBaseline:REQUIRED_MIGRATION,phoneProof:'server_verified_user_consent',adminBoundary:'008_admin_session_rbac',safeSummary:{enabled:true,serverOnly:true,memoryFallback:false,crmWrites:false}};
}
module.exports={REQUIRED_MIGRATION,resolveFormalMemberBindingHttpConfig};
