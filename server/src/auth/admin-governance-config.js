'use strict';
const REQUIRED_MIGRATION='009_admin_governance';
function present(value){return Boolean(String(value||'').trim())}
function flag(value,fallback,name){if(value===undefined||value===null||value==='')return fallback;if(value==='true')return true;if(value==='false')return false;throw new Error(`${name} 只允许 true 或 false`)}
function resolveAdminGovernanceConfig(environment=process.env){
  const enabled=flag(environment.ADMIN_GOVERNANCE_ENABLED,false,'ADMIN_GOVERNANCE_ENABLED'),keys=['ADMIN_BOOTSTRAP_MODE','ADMIN_ROLE_CHANGE_MODE','ADMIN_AUDIT_MODE'];
  if(!enabled){if(keys.some(key=>present(environment[key])))throw new Error('后台治理未启用，拒绝静默保留引导或角色治理配置');return {enabled:false,safeSummary:{enabled:false,selfRegistration:false,memoryFallback:false}}}
  if(environment.NODE_ENV!=='production'||environment.DATA_REPOSITORY!=='cloudbase_gateway'||environment.FORMAL_ADMIN_AUTH_ENABLED!=='true')throw new Error('后台治理只允许在正式后台认证和生产 CloudBase 网关均启用后使用');
  if(environment.DEPLOYMENT_PROFILE==='cloudbase_staging_demo'||environment.DEMO_DATA_ONLY==='true')throw new Error('匿名 staging 禁止启用后台治理');
  const required=[...keys,'CLOUDBASE_PG_MIGRATIONS_APPLIED'];const missing=required.filter(key=>!present(environment[key]));if(missing.length)throw new Error(`后台治理配置不完整：缺少 ${missing.join(', ')}`);
  if(environment.CLOUDBASE_PG_MIGRATIONS_APPLIED!==REQUIRED_MIGRATION)throw new Error(`后台治理要求迁移版本 ${REQUIRED_MIGRATION}`);
  if(environment.ADMIN_BOOTSTRAP_MODE!=='preprovisioned_subject_hash_once'||environment.ADMIN_ROLE_CHANGE_MODE!=='two_person'||environment.ADMIN_AUDIT_MODE!=='redacted_metadata_only')throw new Error('后台治理必须使用预置哈希一次性引导、双人角色变更和脱敏审计');
  return {enabled:true,bootstrapMode:'preprovisioned_subject_hash_once',roleChangeMode:'two_person',auditMode:'redacted_metadata_only',safeSummary:{enabled:true,selfRegistration:false,twoPersonRoleChanges:true,revocationInvalidatesSessions:true,auditExport:false,memoryFallback:false,credentialsExposed:false}};
}
module.exports={REQUIRED_MIGRATION,resolveAdminGovernanceConfig};
