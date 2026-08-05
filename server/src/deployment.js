'use strict';

const CLOUDBASE_STAGING_PROFILE = 'cloudbase_staging_demo';

function parsePort(value) {
  const raw = value === undefined || value === null || value === '' ? '3000' : String(value).trim();
  if (!/^\d+$/.test(raw)) throw new Error('PORT 必须是 1–61000 之间的整数');
  const port = Number(raw);
  if (port < 1 || port > 61000 || port === 9100) throw new Error('PORT 必须是 1–61000 之间的整数，且不能使用 9100');
  return port;
}

function validateDeploymentEnvironment(environment = process.env) {
  const profile = String(environment.DEPLOYMENT_PROFILE || 'local_development').trim();
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
    'MEMBER_IDENTITY_PROVIDER',
    'WECHAT_MINIPROGRAM_APP_SECRET',
    'WECHAT_APP_SECRET',
    'PAYMENT_API_KEY'
  ].filter(key => String(environment[key] || '').trim());
  if (environment.PRIVATE_STORAGE_PROVIDER && environment.PRIVATE_STORAGE_PROVIDER !== 'disabled') forbidden.push('PRIVATE_STORAGE_PROVIDER');
  if (environment.GOVERNED_MEMBER_IMPORTS_ENABLED && environment.GOVERNED_MEMBER_IMPORTS_ENABLED !== 'false') forbidden.push('GOVERNED_MEMBER_IMPORTS_ENABLED');
  if (environment.DATA_REPOSITORY && environment.DATA_REPOSITORY !== 'memory_demo') forbidden.push('DATA_REPOSITORY');
  if (forbidden.length) {
    throw new Error(`CloudBase 匿名测试配置禁止注入真实集成或本机存储变量：${forbidden.join(', ')}`);
  }

  return { profile, anonymousDemoOnly: true };
}

module.exports = { CLOUDBASE_STAGING_PROFILE, parsePort, validateDeploymentEnvironment };
