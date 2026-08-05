'use strict';

const PRIVATE_SCHEMA = 'venture_private';
const APPLICATION_ROLE = 'venture_club_app';
const REQUIRED_MIGRATION = '002_security';

function hasValue(value){return Boolean(String(value||'').trim())}
function integer(value,fallback,min,max,name){const parsed=value===undefined?fallback:Number(value);if(!Number.isInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} 必须是 ${min}–${max} 的整数`);return parsed}

function resolvePersistenceConfig(environment=process.env){
  const mode=String(environment.DATA_REPOSITORY||'memory_demo').trim();
  const databaseUrlPresent=hasValue(environment.DATABASE_URL);
  if(!['memory_demo','postgres'].includes(mode))throw new Error('DATA_REPOSITORY 只允许 memory_demo 或 postgres');
  if(mode==='memory_demo'){
    if(environment.NODE_ENV==='production')throw new Error('生产环境禁止使用 memory_demo 数据仓库');
    if(databaseUrlPresent)throw new Error('已提供 DATABASE_URL 但未显式启用 postgres；拒绝静默忽略数据库配置');
    return {mode,enabled:false,safeSummary:{mode,persistent:false,anonymousDemoOnly:true}};
  }
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

function assertRuntimeRepositoryReady(config){
  if(config.mode==='memory_demo')return true;
  const error=new Error('PostgreSQL 第一阶段仅完成安全边界与迁移；业务 API 尚未逐域接线，拒绝以真实数据模式启动');
  error.code='POSTGRES_RUNTIME_PHASE1_NOT_ACTIVATED';throw error;
}

module.exports={PRIVATE_SCHEMA,APPLICATION_ROLE,REQUIRED_MIGRATION,resolvePersistenceConfig,assertRuntimeRepositoryReady};
