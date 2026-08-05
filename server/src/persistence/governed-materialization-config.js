'use strict';

const REQUIRED_MIGRATION='007_governed_materialization';
function present(value){return Boolean(String(value||'').trim())}
function resolveGovernedMaterializationConfig(environment=process.env){
  const enabled=environment.GOVERNED_MATERIALIZATION_ENABLED==='true';
  const keys=['GOVERNED_MATERIALIZATION_ADMIN_PROVIDER','GOVERNED_MATERIALIZATION_AUDIT_STORE','GOVERNED_MATERIALIZATION_IDEMPOTENCY_STORE'];
  if(!enabled){if(keys.some(key=>present(environment[key]))||(present(environment.GOVERNED_MATERIALIZATION_ENABLED)&&environment.GOVERNED_MATERIALIZATION_ENABLED!=='false'))throw new Error('分域物化配置必须显式完整启用或全部保持禁用');return {enabled:false,safeSummary:{enabled:false,persistent:false,memoryFallback:false}}}
  if(environment.NODE_ENV!=='production'||environment.DATA_REPOSITORY!=='cloudbase_gateway')throw new Error('分域物化只允许在生产 CloudBase 后端网关模式启用');
  if(environment.DEPLOYMENT_PROFILE==='cloudbase_staging_demo'||environment.DEMO_DATA_ONLY==='true')throw new Error('匿名 staging 禁止启用真实分域物化');
  const missing=keys.filter(key=>!present(environment[key]));if(missing.length)throw new Error(`分域物化配置不完整：缺少 ${missing.join(', ')}`);
  if(environment.CLOUDBASE_PG_MIGRATIONS_APPLIED!==REQUIRED_MIGRATION)throw new Error(`分域物化要求迁移版本 ${REQUIRED_MIGRATION}`);
  if(environment.GOVERNED_MATERIALIZATION_ADMIN_PROVIDER!=='external_verified_session')throw new Error('分域物化必须使用真实服务端后台会话');
  if(environment.GOVERNED_MATERIALIZATION_AUDIT_STORE!=='cloudbase_pg'||environment.GOVERNED_MATERIALIZATION_IDEMPOTENCY_STORE!=='cloudbase_pg')throw new Error('分域物化的审计与幂等必须持久化到 CloudBase PG');
  return {enabled:true,mode:'cloudbase_gateway',runtimeEnvironment:'production',safeSummary:{enabled:true,persistent:true,serverOnly:true,separationOfDuties:true,memoryFallback:false,credentialsExposed:false}};
}
module.exports={REQUIRED_MIGRATION,resolveGovernedMaterializationConfig};
