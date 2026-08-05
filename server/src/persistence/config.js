'use strict';

const PRIVATE_SCHEMA = 'venture_private';
const APPLICATION_ROLE = 'venture_club_app';
const REQUIRED_MIGRATION = '002_security';
const CLOUDBASE_GATEWAY_REQUIRED_MIGRATION = '009_admin_governance';
const CLOUDBASE_GATEWAY_REGION = 'ap-shanghai';

function hasValue(value){return Boolean(String(value||'').trim())}
function integer(value,fallback,min,max,name){const parsed=value===undefined?fallback:Number(value);if(!Number.isInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} 必须是 ${min}–${max} 的整数`);return parsed}
function booleanFlag(value,fallback,name){if(value===undefined||value===null||value==='')return fallback;if(value==='true')return true;if(value==='false')return false;throw new Error(`${name} 只允许 true 或 false`)}

function resolvePersistenceConfig(environment=process.env){
  const mode=String(environment.DATA_REPOSITORY||'memory_demo').trim();
  const databaseUrlPresent=hasValue(environment.DATABASE_URL);
  const cloudbaseConfigPresent=['CLOUDBASE_PG_ENV_ID','CLOUDBASE_PG_SERVER_API_KEY','CLOUDBASE_PG_REGION','CLOUDBASE_PG_MIGRATIONS_APPLIED','CLOUDBASE_PG_CREDENTIAL_PURPOSE','CLOUDBASE_CATALOG_READS_ENABLED'].some(key=>hasValue(environment[key]));
  if(!['memory_demo','postgres','cloudbase_gateway'].includes(mode))throw new Error('DATA_REPOSITORY 只允许 memory_demo、postgres 或 cloudbase_gateway');
  if(mode==='memory_demo'){
    if(environment.NODE_ENV==='production')throw new Error('生产环境禁止使用 memory_demo 数据仓库');
    if(databaseUrlPresent)throw new Error('已提供 DATABASE_URL 但未显式启用 postgres；拒绝静默忽略数据库配置');
    if(cloudbaseConfigPresent)throw new Error('已提供 CloudBase 网关配置但未显式启用 cloudbase_gateway；拒绝静默忽略');
    return {mode,enabled:false,safeSummary:{mode,persistent:false,anonymousDemoOnly:true}};
  }
  if(mode==='cloudbase_gateway')return resolveCloudBaseGatewayConfig(environment);
  if(cloudbaseConfigPresent)throw new Error('postgres 模式禁止同时提供 CloudBase 网关配置，避免混合访问路径');
  const required=['DATABASE_URL','DATABASE_SSL_MODE','DATABASE_SCHEMA','DATABASE_APP_ROLE','DATABASE_MIGRATIONS_APPLIED'];
  const missing=required.filter(key=>!hasValue(environment[key]));
  if(missing.length)throw new Error(`PostgreSQL 配置不完整：缺少 ${missing.join(', ')}`);
  if(environment.NODE_ENV!=='production')throw new Error('PostgreSQL 真实数据模式只允许在 NODE_ENV=production 启用');
  if(environment.DEPLOYMENT_PROFILE==='cloudbase_staging_demo'||environment.DEMO_DATA_ONLY==='true')throw new Error('匿名 staging 禁止启用 PostgreSQL 真实数据模式');
  let parsed;try{parsed=new URL(environment.DATABASE_URL)}catch{throw new Error('DATABASE_URL 格式无效')}
  if(!['postgres:','postgresql:'].includes(parsed.protocol))throw new Error('DATABASE_URL 必须使用 PostgreSQL 协议');
  if(!parsed.hostname||!parsed.username||!parsed.password)throw new Error('DATABASE_URL 必须包含服务端数据库主机、应用账号和凭据');
  if(environment.DATABASE_SSL_MODE!=='verify-full')throw new Error('DATABASE_SSL_MODE 必须为 verify-full');
  if(environment.DATABASE_SCHEMA!==PRIVATE_SCHEMA)throw new Error(`DATABASE_SCHEMA 必须为 ${PRIVATE_SCHEMA}`);
  if(environment.DATABASE_APP_ROLE!==APPLICATION_ROLE)throw new Error(`DATABASE_APP_ROLE 必须为最小权限角色 ${APPLICATION_ROLE}`);
  if(environment.DATABASE_MIGRATIONS_APPLIED!==REQUIRED_MIGRATION)throw new Error(`数据库迁移版本必须为 ${REQUIRED_MIGRATION}`);
  if(environment.DATABASE_ROLE_PURPOSE==='migrator')throw new Error('云托管运行服务禁止使用迁移角色连接数据库');
  const poolMax=integer(environment.DATABASE_POOL_MAX,5,1,20,'DATABASE_POOL_MAX');
  const statementTimeoutMs=integer(environment.DATABASE_STATEMENT_TIMEOUT_MS,5000,1000,30000,'DATABASE_STATEMENT_TIMEOUT_MS');
  return {mode,enabled:true,connectionString:environment.DATABASE_URL,sslMode:'verify-full',schema:PRIVATE_SCHEMA,applicationRole:APPLICATION_ROLE,poolMax,statementTimeoutMs,safeSummary:{mode,persistent:true,schema:PRIVATE_SCHEMA,tlsVerified:true,rolePurpose:'application'}};
}

function resolveCloudBaseGatewayConfig(environment){
  const required=['CLOUDBASE_PG_ENV_ID','CLOUDBASE_PG_SERVER_API_KEY','CLOUDBASE_PG_REGION','CLOUDBASE_PG_MIGRATIONS_APPLIED','CLOUDBASE_PG_CREDENTIAL_PURPOSE'];
  const missing=required.filter(key=>!hasValue(environment[key]));
  if(missing.length)throw new Error(`CloudBase PostgreSQL 网关配置不完整：缺少 ${missing.join(', ')}`);
  if(environment.NODE_ENV!=='production')throw new Error('CloudBase PostgreSQL 真实数据模式只允许在 NODE_ENV=production 启用');
  if(environment.DEPLOYMENT_PROFILE==='cloudbase_staging_demo'||environment.DEMO_DATA_ONLY==='true')throw new Error('匿名 staging 禁止启用 CloudBase PostgreSQL 真实数据模式');
  const envId=String(environment.CLOUDBASE_PG_ENV_ID).trim();
  if(!/^[a-z][a-z0-9-]{2,62}$/i.test(envId))throw new Error('CLOUDBASE_PG_ENV_ID 格式无效');
  if(environment.CLOUDBASE_PG_REGION!==CLOUDBASE_GATEWAY_REGION)throw new Error(`CLOUDBASE_PG_REGION 当前只允许 ${CLOUDBASE_GATEWAY_REGION}`);
  if(environment.CLOUDBASE_PG_MIGRATIONS_APPLIED!==CLOUDBASE_GATEWAY_REQUIRED_MIGRATION)throw new Error(`CloudBase PostgreSQL 迁移版本必须为 ${CLOUDBASE_GATEWAY_REQUIRED_MIGRATION}`);
  if(hasValue(environment.DATABASE_URL))throw new Error('cloudbase_gateway 模式禁止同时配置 DATABASE_URL，避免混合访问路径');
  if(environment.CLOUDBASE_PG_CREDENTIAL_PURPOSE!=='server_runtime')throw new Error('CloudBase 网关运行时只允许 server_runtime 凭据用途');
  const timeoutMs=integer(environment.CLOUDBASE_PG_TIMEOUT_MS,5000,1000,15000,'CLOUDBASE_PG_TIMEOUT_MS');
  const maxResponseBytes=integer(environment.CLOUDBASE_PG_MAX_RESPONSE_BYTES,1048576,1024,5242880,'CLOUDBASE_PG_MAX_RESPONSE_BYTES');
  const catalogReadsEnabled=booleanFlag(environment.CLOUDBASE_CATALOG_READS_ENABLED,false,'CLOUDBASE_CATALOG_READS_ENABLED');
  return {mode:'cloudbase_gateway',enabled:true,runtimeEnvironment:'production',envId,region:CLOUDBASE_GATEWAY_REGION,origin:`https://${envId}.api.tcloudbasegateway.com`,serverApiKey:String(environment.CLOUDBASE_PG_SERVER_API_KEY).trim(),timeoutMs,maxResponseBytes,catalogReadsEnabled,safeSummary:{mode:'cloudbase_gateway',persistent:true,transport:'https_postgrest',serverOnly:true,allowlistedReadViews:true,catalogReadsEnabled,credentialsExposed:false}};
}

function assertRuntimeRepositoryReady(config){
  if(config.mode==='memory_demo')return true;
  const error=new Error('PostgreSQL 持久化仅完成仓库契约与离线验证；业务 API 尚未逐域接线，拒绝以真实数据模式启动');
  error.code=config.mode==='cloudbase_gateway'?'CLOUDBASE_GATEWAY_RUNTIME_NOT_ACTIVATED':'POSTGRES_RUNTIME_PHASE1_NOT_ACTIVATED';throw error;
}

module.exports={PRIVATE_SCHEMA,APPLICATION_ROLE,REQUIRED_MIGRATION,CLOUDBASE_GATEWAY_REQUIRED_MIGRATION,CLOUDBASE_GATEWAY_REGION,resolvePersistenceConfig,assertRuntimeRepositoryReady};
