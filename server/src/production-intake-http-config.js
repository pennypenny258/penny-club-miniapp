'use strict';
const MIGRATION='014_production_intake_008_baseline';
function resolveProductionIntakeHttpConfig(environment=process.env){
  const enabled=environment.PRODUCTION_INTAKE_ROUTES_ENABLED==='true';
  if(!enabled){if(environment.PRODUCTION_INTAKE_ROUTES_ENABLED&&environment.PRODUCTION_INTAKE_ROUTES_ENABLED!=='false')throw new Error('PRODUCTION_INTAKE_ROUTES_ENABLED 只允许 true 或 false');return {enabled:false,safeSummary:{enabled:false,namespace:'/api/production-admin',memoryFallback:false}}}
  if(environment.NODE_ENV!=='production'||environment.DEPLOYMENT_PROFILE!=='cloudbase_production_intake'||environment.DEMO_DATA_ONLY!=='false'||environment.DATA_REPOSITORY!=='cloudbase_gateway')throw new Error('生产录入路由只允许专用生产档启用');
  if(environment.CLOUDBASE_PG_MIGRATIONS_APPLIED!==MIGRATION||environment.CRM_PERSISTENCE_MIGRATION_APPLIED!==MIGRATION)throw new Error(`生产录入路由要求迁移版本 ${MIGRATION}`);
  if(environment.FORMAL_ADMIN_AUTH_ENABLED!=='true'||environment.CRM_PERSISTENT_IMPORTS_ENABLED!=='true'||environment.GOVERNED_MEMBER_IMPORTS_ENABLED!=='true'||environment.GOVERNED_MATERIALIZATION_ENABLED!=='true')throw new Error('生产录入路由依赖正式认证、受控导入和分域物化');
  if(!String(environment.ACTIVITY_PRIVATE_LINK_ENCRYPTION_KEY||'').trim())throw new Error('生产录入路由缺少 ACTIVITY_PRIVATE_LINK_ENCRYPTION_KEY');
  return {enabled:true,migration:MIGRATION,safeSummary:{enabled:true,namespace:'/api/production-admin',formalAdminRequired:true,persistent:true,memberImport:'governed_private_batch',activityLinksEncrypted:true,memoryFallback:false,credentialsExposed:false}};
}
module.exports={MIGRATION,resolveProductionIntakeHttpConfig};
