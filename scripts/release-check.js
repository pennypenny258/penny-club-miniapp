'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const project = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/project.config.json'), 'utf8'));
const runtimeFiles = ['runtime.js', 'runtime-target.js', 'runtime-profiles.js'];
const runtimeText = runtimeFiles.map(file => fs.readFileSync(path.join(root, 'miniprogram/config', file), 'utf8')).join('\n');
const {resolvePersistenceConfig,assertRuntimeRepositoryReady}=require('../server/src/persistence/config');
const {resolveWechatIdentityConfig}=require('../server/src/auth/wechat-config');
const {resolvePrivateObjectStorageConfig}=require('../server/src/storage/config');
const {resolveGovernedImportConfig}=require('../server/src/persistence/governed-import-config');
const {resolveGovernedMaterializationConfig}=require('../server/src/persistence/governed-materialization-config');
const {resolveFormalAdminAuthConfig}=require('../server/src/auth/admin-auth-config');
const issues = [];

if (!project.appid || project.appid === 'touristappid') issues.push('AppID 仍为游客/占位配置');
if (project.setting?.urlCheck === false) issues.push('项目仍关闭服务器域名校验');
if (/environment:\s*['"]development['"]/.test(runtimeText)) issues.push('运行环境仍为 development');
if (/demoMode:\s*true/.test(runtimeText)) issues.push('演示身份模式仍开启');
if (/http:\/\//.test(runtimeText)) issues.push('API 仍包含非 HTTPS 地址');
if (/cloudbase-staging/.test(runtimeText)) issues.push('仍包含仅供联调的 CloudBase 默认域名配置');

if (process.env.NODE_ENV === 'production') {
  if (process.env.DEPLOYMENT_PROFILE === 'cloudbase_staging_demo') issues.push('生产发布仍使用 CloudBase 匿名测试配置');
  if (process.env.DEMO_DATA_ONLY === 'true') issues.push('生产发布仍限定为匿名演示数据模式');
  if (process.env.ADMIN_AUTH_MODE !== 'external_session') issues.push('生产后台未启用服务端会话/RBAC，禁止使用演示角色头');
  if (process.env.DATA_REPOSITORY === 'postgres' && !process.env.DATABASE_URL) issues.push('标准 PostgreSQL 生产数据库未配置');
  if (process.env.DATA_REPOSITORY === 'cloudbase_gateway' && process.env.CLOUDBASE_CATALOG_READS_ENABLED !== 'true') issues.push('CloudBase 真实目录读取开关尚未启用');
  if (process.env.DATA_REPOSITORY === 'cloudbase_gateway' && process.env.MEMBER_IDENTITY_PROVIDER !== 'external_verified_session') issues.push('CloudBase 真实目录读取尚未接入可验证的服务端会员身份映射');
  try{const identity=resolveWechatIdentityConfig(process.env);if(process.env.DATA_REPOSITORY==='cloudbase_gateway'&&!identity.enabled)issues.push('CloudBase 真实目录读取尚未启用服务端微信身份交换')}catch(error){issues.push(`生产会员身份未就绪：${error.message}`)}
  try{const storage=resolvePrivateObjectStorageConfig(process.env);if(process.env.DATA_REPOSITORY==='cloudbase_gateway'&&!storage.enabled)issues.push('CloudBase 真实资料库尚未启用服务端私有对象存储')}catch(error){issues.push(`生产私有对象存储未就绪：${error.message}`)}
  try{const governed=resolveGovernedImportConfig(process.env);if(process.env.DATA_REPOSITORY==='cloudbase_gateway'&&!governed.enabled)issues.push('CRM、付款、名册持久化导入仍保持禁用')}catch(error){issues.push(`生产会员数据导入未就绪：${error.message}`)}
  try{const materialization=resolveGovernedMaterializationConfig(process.env);if(process.env.DATA_REPOSITORY==='cloudbase_gateway'&&!materialization.enabled)issues.push('人工复核后的分域正式物化仍保持禁用')}catch(error){issues.push(`生产分域物化未就绪：${error.message}`)}
  try{const adminAuth=resolveFormalAdminAuthConfig(process.env);if(!adminAuth.enabled)issues.push('正式运营后台会话与 RBAC 仍保持禁用')}catch(error){issues.push(`生产后台认证未就绪：${error.message}`)}
  try{const database=resolvePersistenceConfig(process.env);assertRuntimeRepositoryReady(database)}catch(error){issues.push(`生产持久化未就绪：${error.message}`)}
  if (!process.env.PRIVATE_STORAGE_PROVIDER || process.env.PRIVATE_STORAGE_PROVIDER === 'local') issues.push('生产私有对象存储未配置');
  if (!process.env.FIELD_ENCRYPTION_KEY_REF) issues.push('敏感字段加密密钥引用未配置');
  if (!process.env.BACKUP_BUCKET) issues.push('备份存储未配置');
  if (!process.env.MONITORING_DSN) issues.push('错误监控未配置');
}

if (issues.length) {
  console.error('发布预检未通过：\n- ' + issues.join('\n- '));
  console.error('请完成 docs/development-and-release-standards.md 的真实账号验收清单。');
  process.exitCode = 1;
} else {
  console.log('静态发布预检通过；仍须在微信开发者工具和真机完成官方能力验收。');
}
