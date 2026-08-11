'use strict';

const CLOUDBASE_STAGING_PROFILE = 'cloudbase_staging_demo';
const CLOUDBASE_PRODUCTION_BOOTSTRAP_PROFILE = 'cloudbase_production_bootstrap';

const PRODUCTION_BOOTSTRAP_FORBIDDEN_VALUES = Object.freeze([
  'DATABASE_URL','CLOUDBASE_PG_SERVER_API_KEY','CLOUDBASE_PG_ENV_ID',
  'CLOUDBASE_STORAGE_BUCKET_ID','OBJECT_LOCATOR_ENCRYPTION_KEY',
  'GOVERNED_IMPORT_ENCRYPTION_KEY','MEMBER_MATCH_HMAC_KEY',
  'ADMIN_SESSION_HASH_KEY','ADMIN_SUBJECT_HMAC_KEY','WECHAT_MINIPROGRAM_APP_SECRET',
  'WECHAT_APP_SECRET','PAYMENT_API_KEY','FEISHU_APP_ID','FEISHU_APP_SECRET',
  'PRIVATE_STORAGE_DIR','MEMBER_BINDING_MODE'
]);

const PRODUCTION_BOOTSTRAP_DISABLED_FLAGS = Object.freeze([
  'CLOUDBASE_CATALOG_READS_ENABLED','CLOUDBASE_STORAGE_ENABLED',
  'GOVERNED_MEMBER_IMPORTS_ENABLED','GOVERNED_MATERIALIZATION_ENABLED',
  'FORMAL_ADMIN_AUTH_ENABLED','ADMIN_GOVERNANCE_ENABLED','WECHAT_LOGIN_ENABLED',
  'FORMAL_AGENT_ROUTES_ENABLED','FORMAL_MEMBER_BINDING_ROUTES_ENABLED'
]);

function parsePort(value) {
  const raw = value === undefined || value === null || value === '' ? '3000' : String(value).trim();
  if (!/^\d+$/.test(raw)) throw new Error('PORT 必须是 1–61000 之间的整数');
  const port = Number(raw);
  if (port < 1 || port > 61000 || port === 9100) throw new Error('PORT 必须是 1–61000 之间的整数，且不能使用 9100');
  return port;
}

function validateDeploymentEnvironment(environment = process.env) {
  const profile = String(environment.DEPLOYMENT_PROFILE || 'local_development').trim();
  if (profile === CLOUDBASE_PRODUCTION_BOOTSTRAP_PROFILE) {
    if (environment.NODE_ENV !== 'production') throw new Error('生产初始化档必须设置 NODE_ENV=production');
    if (environment.DEMO_DATA_ONLY !== 'false') throw new Error('生产初始化档必须显式设置 DEMO_DATA_ONLY=false');
    if (environment.DATA_REPOSITORY !== 'production_bootstrap_disabled') throw new Error('生产初始化档必须设置 DATA_REPOSITORY=production_bootstrap_disabled');
    const populated = PRODUCTION_BOOTSTRAP_FORBIDDEN_VALUES.filter(key => String(environment[key] || '').trim());
    const enabled = PRODUCTION_BOOTSTRAP_DISABLED_FLAGS.filter(key => String(environment[key] || '').trim() !== '' && environment[key] !== 'false');
    if (populated.length || enabled.length) {
      throw new Error(`生产初始化档禁止提前注入真实集成或启用业务能力：${[...populated, ...enabled].join(', ')}`);
    }
    return { profile, anonymousDemoOnly:false, bootstrapOnly:true, businessApisEnabled:false };
  }
  if (profile !== CLOUDBASE_STAGING_PROFILE) return { profile, anonymousDemoOnly: false };

  if (environment.DEMO_DATA_ONLY !== 'true') {
    throw new Error('CloudBase 测试环境必须设置 DEMO_DATA_ONLY=true，只允许匿名演示数据');
  }

  const forbidden = [
    'PRIVATE_STORAGE_DIR',
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'DATABASE_URL',
    'CLOUDBASE_PG_SERVER_API_KEY',
    'CLOUDBASE_PG_ENV_ID',
    'CLOUDBASE_CATALOG_READS_ENABLED',
    'CLOUDBASE_STORAGE_ENABLED',
    'CLOUDBASE_STORAGE_BUCKET_ID',
    'CLOUDBASE_STORAGE_CREDENTIAL_PURPOSE',
    'CLOUDBASE_STORAGE_BUCKET_PRIVATE_CONFIRMED',
    'OBJECT_LOCATOR_ENCRYPTION_KEY',
    'GOVERNED_IMPORT_ENCRYPTION_KEY',
    'MEMBER_MATCH_HMAC_KEY',
    'GOVERNED_IMPORT_ADMIN_PROVIDER',
    'GOVERNED_IMPORT_AUDIT_STORE',
    'GOVERNED_IMPORT_IDEMPOTENCY_STORE',
    'GOVERNED_MATERIALIZATION_ADMIN_PROVIDER',
    'GOVERNED_MATERIALIZATION_AUDIT_STORE',
    'GOVERNED_MATERIALIZATION_IDEMPOTENCY_STORE',
    'ADMIN_SESSION_HASH_KEY',
    'ADMIN_SUBJECT_HMAC_KEY',
    'ADMIN_IDENTITY_PROVIDER',
    'ADMIN_SESSION_STORE',
    'ADMIN_BOOTSTRAP_MODE',
    'ADMIN_ROLE_CHANGE_MODE',
    'ADMIN_AUDIT_MODE',
    'MEMBER_IDENTITY_PROVIDER',
    'MEMBER_BINDING_MODE',
    'WECHAT_MINIPROGRAM_APP_SECRET',
    'WECHAT_APP_SECRET',
    'PAYMENT_API_KEY'
  ].filter(key => String(environment[key] || '').trim());
  if (environment.PRIVATE_STORAGE_PROVIDER && environment.PRIVATE_STORAGE_PROVIDER !== 'disabled') forbidden.push('PRIVATE_STORAGE_PROVIDER');
  if (environment.GOVERNED_MEMBER_IMPORTS_ENABLED && environment.GOVERNED_MEMBER_IMPORTS_ENABLED !== 'false') forbidden.push('GOVERNED_MEMBER_IMPORTS_ENABLED');
  if (environment.GOVERNED_MATERIALIZATION_ENABLED && environment.GOVERNED_MATERIALIZATION_ENABLED !== 'false') forbidden.push('GOVERNED_MATERIALIZATION_ENABLED');
  if (environment.FORMAL_ADMIN_AUTH_ENABLED && environment.FORMAL_ADMIN_AUTH_ENABLED !== 'false') forbidden.push('FORMAL_ADMIN_AUTH_ENABLED');
  if (environment.FORMAL_AGENT_ROUTES_ENABLED && environment.FORMAL_AGENT_ROUTES_ENABLED !== 'false') forbidden.push('FORMAL_AGENT_ROUTES_ENABLED');
  if (environment.FORMAL_MEMBER_BINDING_ROUTES_ENABLED && environment.FORMAL_MEMBER_BINDING_ROUTES_ENABLED !== 'false') forbidden.push('FORMAL_MEMBER_BINDING_ROUTES_ENABLED');
  if (environment.ADMIN_GOVERNANCE_ENABLED && environment.ADMIN_GOVERNANCE_ENABLED !== 'false') forbidden.push('ADMIN_GOVERNANCE_ENABLED');
  if (environment.ADMIN_AUTH_MODE && environment.ADMIN_AUTH_MODE !== 'demo_header') forbidden.push('ADMIN_AUTH_MODE');
  if (environment.DATA_REPOSITORY && environment.DATA_REPOSITORY !== 'memory_demo') forbidden.push('DATA_REPOSITORY');
  if (forbidden.length) {
    throw new Error(`CloudBase 匿名测试配置禁止注入真实集成或本机存储变量：${forbidden.join(', ')}`);
  }

  return { profile, anonymousDemoOnly: true };
}

module.exports = { CLOUDBASE_STAGING_PROFILE, CLOUDBASE_PRODUCTION_BOOTSTRAP_PROFILE, parsePort, validateDeploymentEnvironment };
