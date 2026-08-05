'use strict';

const REQUIRED_MIGRATION='006_governed_member_import';
const ACCEPTED_MIGRATIONS=new Set([REQUIRED_MIGRATION,'007_governed_materialization']);
function present(value){return Boolean(String(value||'').trim())}
function resolveGovernedImportConfig(environment=process.env){
  const requested=environment.GOVERNED_MEMBER_IMPORTS_ENABLED==='true';
  const integrationKeys=['GOVERNED_IMPORT_ENCRYPTION_KEY','MEMBER_MATCH_HMAC_KEY','GOVERNED_IMPORT_ADMIN_PROVIDER','GOVERNED_IMPORT_AUDIT_STORE','GOVERNED_IMPORT_IDEMPOTENCY_STORE'];
  if(!requested){if(integrationKeys.some(key=>present(environment[key]))||(present(environment.GOVERNED_MEMBER_IMPORTS_ENABLED)&&environment.GOVERNED_MEMBER_IMPORTS_ENABLED!=='false'))throw new Error('会员数据导入配置不完整：必须显式设置 GOVERNED_MEMBER_IMPORTS_ENABLED=true 或保持全部禁用');return {enabled:false,safeSummary:{enabled:false,persistent:false,memoryFallback:false}}}
  if(environment.NODE_ENV!=='production'||environment.DATA_REPOSITORY!=='cloudbase_gateway')throw new Error('会员数据持久化导入只允许在生产 CloudBase 后端网关模式启用');
  if(environment.DEPLOYMENT_PROFILE==='cloudbase_staging_demo'||environment.DEMO_DATA_ONLY==='true')throw new Error('匿名 staging 禁止启用会员数据持久化导入');
  const required=['GOVERNED_IMPORT_ENCRYPTION_KEY','MEMBER_MATCH_HMAC_KEY','GOVERNED_IMPORT_ADMIN_PROVIDER','GOVERNED_IMPORT_AUDIT_STORE','GOVERNED_IMPORT_IDEMPOTENCY_STORE'];const missing=required.filter(key=>!present(environment[key]));if(missing.length)throw new Error(`会员数据导入配置不完整：缺少 ${missing.join(', ')}`);
  if(!ACCEPTED_MIGRATIONS.has(environment.CLOUDBASE_PG_MIGRATIONS_APPLIED))throw new Error(`会员数据导入要求迁移版本至少包含 ${REQUIRED_MIGRATION}`);
  if(environment.GOVERNED_IMPORT_ADMIN_PROVIDER!=='external_verified_session')throw new Error('会员数据导入必须使用真实服务端后台会话');
  if(environment.GOVERNED_IMPORT_AUDIT_STORE!=='cloudbase_pg'||environment.GOVERNED_IMPORT_IDEMPOTENCY_STORE!=='cloudbase_pg')throw new Error('审计与幂等必须持久化到 CloudBase PG');
  return {enabled:true,mode:'cloudbase_gateway',runtimeEnvironment:'production',encryptionKey:environment.GOVERNED_IMPORT_ENCRYPTION_KEY,matchHmacKey:environment.MEMBER_MATCH_HMAC_KEY,safeSummary:{enabled:true,persistent:true,serverOnly:true,verifiedAdminRequired:true,memoryFallback:false,credentialsExposed:false}};
}
module.exports={REQUIRED_MIGRATION,resolveGovernedImportConfig};
