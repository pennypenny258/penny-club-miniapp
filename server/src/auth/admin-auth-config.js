'use strict';

const crypto=require('node:crypto');
const REQUIRED_MIGRATION='008_admin_session_rbac';
const ACCEPTED_MIGRATIONS=new Set([REQUIRED_MIGRATION]);
function present(value){return Boolean(String(value||'').trim())}
function flag(value,fallback,name){if(value===undefined||value===null||value==='')return fallback;if(value==='true')return true;if(value==='false')return false;throw new Error(`${name} 只允许 true 或 false`)}
function integer(value,fallback,min,max,name){const parsed=value===undefined||value===''?fallback:Number(value);if(!Number.isInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} 必须是 ${min}–${max} 的整数`);return parsed}
function key32(environment,name){const text=String(environment[name]||'');const decoded=Buffer.from(text,'base64');if(!text||decoded.length!==32||decoded.toString('base64').replace(/=+$/,'')!==text.replace(/=+$/,''))throw new Error(`${name} 必须是 32 字节 base64 服务端密钥`);return decoded}

function resolveFormalAdminAuthConfig(environment=process.env){
  const enabled=flag(environment.FORMAL_ADMIN_AUTH_ENABLED,false,'FORMAL_ADMIN_AUTH_ENABLED');
  const keys=['ADMIN_AUTH_MODE','ADMIN_IDENTITY_PROVIDER','ADMIN_SESSION_STORE','ADMIN_SESSION_HASH_KEY','ADMIN_SUBJECT_HMAC_KEY','ADMIN_SESSION_ISSUER'];
  if(!enabled){if(keys.some(key=>present(environment[key])))throw new Error('正式后台认证未启用，拒绝静默保留身份或会话配置');return {enabled:false,safeSummary:{enabled:false,mode:'disabled',memoryFallback:false,credentialsExposed:false}}}
  if(environment.NODE_ENV!=='production'||environment.DATA_REPOSITORY!=='cloudbase_gateway')throw new Error('正式后台认证只允许在生产 CloudBase 后端网关模式启用');
  if(environment.DEPLOYMENT_PROFILE==='cloudbase_staging_demo'||environment.DEMO_DATA_ONLY==='true')throw new Error('匿名 staging 禁止启用正式后台认证');
  const required=[...keys,'CLOUDBASE_PG_MIGRATIONS_APPLIED'];const missing=required.filter(key=>!present(environment[key]));if(missing.length)throw new Error(`正式后台认证配置不完整：缺少 ${missing.join(', ')}`);
  if(environment.ADMIN_AUTH_MODE!=='external_session'||environment.ADMIN_IDENTITY_PROVIDER!=='external_verified'||environment.ADMIN_SESSION_STORE!=='cloudbase_pg')throw new Error('正式后台必须使用外部已验证身份和 CloudBase PG 会话');
  if(!ACCEPTED_MIGRATIONS.has(environment.CLOUDBASE_PG_MIGRATIONS_APPLIED))throw new Error(`正式后台认证要求迁移版本至少包含 ${REQUIRED_MIGRATION}`);
  const issuer=String(environment.ADMIN_SESSION_ISSUER).trim();if(!/^[a-z0-9._:-]{3,80}$/i.test(issuer))throw new Error('ADMIN_SESSION_ISSUER 格式无效');
  const ttlSeconds=integer(environment.ADMIN_SESSION_TTL_SECONDS,3600,600,28800,'ADMIN_SESSION_TTL_SECONDS');
  const stepUpMaxAgeSeconds=integer(environment.ADMIN_STEP_UP_MAX_AGE_SECONDS,300,60,900,'ADMIN_STEP_UP_MAX_AGE_SECONDS');
  return {enabled:true,mode:'external_session',identityProvider:'external_verified',sessionStore:'cloudbase_pg',issuer,ttlSeconds,stepUpMaxAgeSeconds,sessionHashKey:key32(environment,'ADMIN_SESSION_HASH_KEY'),subjectHmacKey:key32(environment,'ADMIN_SUBJECT_HMAC_KEY'),safeSummary:{enabled:true,mode:'external_session',serverOnly:true,opaqueBearer:true,persistentRevocation:true,rolesResolvedPerRequest:true,memoryFallback:false,credentialsExposed:false}};
}
function keyedHash(key,purpose,value){return crypto.createHmac('sha256',key).update(`${purpose}\0${value}`).digest('hex')}
module.exports={REQUIRED_MIGRATION,resolveFormalAdminAuthConfig,keyedHash};
