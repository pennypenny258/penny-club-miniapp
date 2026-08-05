'use strict';

const crypto=require('node:crypto');

function present(value){return Boolean(String(value||'').trim())}
function bool(value,fallback,name){if(value===undefined||value===null||value==='')return fallback;if(value==='true')return true;if(value==='false')return false;throw new Error(`${name} 只允许 true 或 false`)}
function integer(value,fallback,min,max,name){const parsed=value===undefined||value===''?fallback:Number(value);if(!Number.isInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} 必须是 ${min}–${max} 的整数`);return parsed}
function secretKey(environment,name){const value=String(environment[name]||'');let decoded;try{decoded=Buffer.from(value,'base64')}catch{throw new Error(`${name} 必须是 32 字节 base64 服务端密钥`)}if(!value||decoded.length!==32||decoded.toString('base64').replace(/=+$/,'')!==value.replace(/=+$/,''))throw new Error(`${name} 必须是 32 字节 base64 服务端密钥`);return decoded}

function resolveWechatIdentityConfig(environment=process.env){
  const enabled=bool(environment.WECHAT_LOGIN_ENABLED,false,'WECHAT_LOGIN_ENABLED');
  const sensitiveKeys=['WECHAT_MINIPROGRAM_APP_SECRET','WECHAT_IDENTITY_SUBJECT_HMAC_KEY','MEMBER_SESSION_ENCRYPTION_KEY'];
  const anyIdentityConfig=['WECHAT_MINIPROGRAM_APP_ID',...sensitiveKeys,'MEMBER_SESSION_ISSUER','MEMBER_SESSION_AUDIENCE','MEMBER_SESSION_REVOCATION_STORE'].some(key=>present(environment[key]));
  if(!enabled){if(anyIdentityConfig)throw new Error('微信真实登录未启用，拒绝静默保留身份凭据或会话配置');return {enabled:false,mode:'disabled',safeSummary:{enabled:false,provider:'none',credentialsExposed:false}}}
  if(environment.NODE_ENV!=='production')throw new Error('微信真实登录只允许在 production 显式启用');
  if(environment.DEPLOYMENT_PROFILE==='cloudbase_staging_demo'||environment.DEMO_DATA_ONLY==='true')throw new Error('匿名 staging 禁止启用微信真实登录');
  if(environment.DATA_REPOSITORY!=='cloudbase_gateway')throw new Error('微信真实登录当前只允许配合 cloudbase_gateway');
  if(environment.MEMBER_IDENTITY_PROVIDER!=='external_verified_session')throw new Error('MEMBER_IDENTITY_PROVIDER 必须为 external_verified_session');
  if(environment.MEMBER_SESSION_REVOCATION_STORE!=='external_persistent')throw new Error('MEMBER_SESSION_REVOCATION_STORE 必须为 external_persistent');
  const required=['WECHAT_MINIPROGRAM_APP_ID','WECHAT_MINIPROGRAM_APP_SECRET','WECHAT_IDENTITY_SUBJECT_HMAC_KEY','MEMBER_SESSION_ENCRYPTION_KEY','MEMBER_SESSION_ISSUER','MEMBER_SESSION_AUDIENCE'];
  const missing=required.filter(key=>!present(environment[key]));if(missing.length)throw new Error(`微信身份配置不完整：缺少 ${missing.join(', ')}`);
  const appId=String(environment.WECHAT_MINIPROGRAM_APP_ID).trim();if(!/^wx[0-9a-f]{16}$/i.test(appId))throw new Error('WECHAT_MINIPROGRAM_APP_ID 格式无效');
  const issuer=String(environment.MEMBER_SESSION_ISSUER).trim(),audience=String(environment.MEMBER_SESSION_AUDIENCE).trim();
  if(!/^[a-z0-9._:-]{3,80}$/i.test(issuer)||!/^[a-z0-9._:-]{3,80}$/i.test(audience))throw new Error('会话 issuer/audience 格式无效');
  const ttlSeconds=integer(environment.MEMBER_SESSION_TTL_SECONDS,900,300,3600,'MEMBER_SESSION_TTL_SECONDS');
  return {enabled:true,mode:'server_code_exchange',appId,appSecret:String(environment.WECHAT_MINIPROGRAM_APP_SECRET),subjectHmacKey:secretKey(environment,'WECHAT_IDENTITY_SUBJECT_HMAC_KEY'),sessionEncryptionKey:secretKey(environment,'MEMBER_SESSION_ENCRYPTION_KEY'),issuer,audience,ttlSeconds,revocationStore:'external_persistent',safeSummary:{enabled:true,provider:'wechat_miniprogram',exchange:'server_only',session:'opaque_aes_256_gcm',ttlSeconds,persistentRevocationRequired:true,credentialsExposed:false}};
}

function hashWechatSubject({config,subjectType,subject}){if(!config?.enabled)throw new Error('微信身份配置未启用');if(!['openid','unionid'].includes(subjectType))throw new Error('微信 subject 类型无效');if(!present(subject)||String(subject).length>128)throw new Error('微信 subject 无效');const appScopeHash=crypto.createHmac('sha256',config.subjectHmacKey).update(`wechat_miniprogram\0${config.appId}`).digest('hex');const subjectHash=crypto.createHmac('sha256',config.subjectHmacKey).update(`wechat_miniprogram\0${config.appId}\0${subjectType}\0${subject}`).digest('hex');return {appScopeHash,subjectHash}}

module.exports={resolveWechatIdentityConfig,hashWechatSubject};
