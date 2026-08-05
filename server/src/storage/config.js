'use strict';

const REQUIRED_STORAGE_MIGRATION='005_resource_private_storage';
const ACCEPTED_STORAGE_MIGRATIONS=new Set([REQUIRED_STORAGE_MIGRATION,'006_governed_member_import','007_governed_materialization']);
const STORAGE_PROVIDER='cloudbase_pg_storage';
const STORAGE_REGION='ap-shanghai';
const MAX_MVP_FILE_BYTES=25*1024*1024;

function present(value){return Boolean(String(value||'').trim())}
function flag(value,fallback,name){if(value===undefined||value===null||value==='')return fallback;if(value==='true')return true;if(value==='false')return false;throw new Error(`${name} 只允许 true 或 false`)}
function integer(value,fallback,min,max,name){const parsed=value===undefined||value===''?fallback:Number(value);if(!Number.isInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} 必须是 ${min}–${max} 的整数`);return parsed}
function key32(environment,name){const text=String(environment[name]||'');const decoded=Buffer.from(text,'base64');if(!text||decoded.length!==32||decoded.toString('base64').replace(/=+$/,'')!==text.replace(/=+$/,''))throw new Error(`${name} 必须是 32 字节 base64 服务端密钥`);return decoded}

function resolvePrivateObjectStorageConfig(environment=process.env){
  const provider=String(environment.PRIVATE_STORAGE_PROVIDER||'disabled').trim();
  const storageKeys=['CLOUDBASE_STORAGE_BUCKET_ID','CLOUDBASE_STORAGE_BUCKET_PRIVATE_CONFIRMED','CLOUDBASE_STORAGE_ENABLED','CLOUDBASE_STORAGE_CREDENTIAL_PURPOSE','CLOUDBASE_STORAGE_DOWNLOAD_MODE','CLOUDBASE_STORAGE_PREVIEW_MODE','CLOUDBASE_STORAGE_MAX_FILE_BYTES','OBJECT_LOCATOR_ENCRYPTION_KEY'];
  const anyStorageConfig=storageKeys.some(name=>present(environment[name]));
  if(provider==='disabled'||provider==='local'){
    if(anyStorageConfig)throw new Error('未启用 CloudBase 私有对象存储，拒绝静默忽略存储配置');
    return {enabled:false,provider,safeSummary:{enabled:false,persistent:false,provider,credentialsExposed:false}};
  }
  if(provider!==STORAGE_PROVIDER)throw new Error(`PRIVATE_STORAGE_PROVIDER 只允许 disabled、local 或 ${STORAGE_PROVIDER}`);
  if(flag(environment.CLOUDBASE_STORAGE_ENABLED,false,'CLOUDBASE_STORAGE_ENABLED')!==true)throw new Error('CLOUDBASE_STORAGE_ENABLED 必须显式为 true');
  if(environment.NODE_ENV!=='production')throw new Error('CloudBase 私有对象存储只允许在 production 显式启用');
  if(environment.DEPLOYMENT_PROFILE==='cloudbase_staging_demo'||environment.DEMO_DATA_ONLY==='true')throw new Error('匿名 staging 禁止启用真实私有对象存储');
  if(environment.DATA_REPOSITORY!=='cloudbase_gateway')throw new Error('CloudBase 私有对象存储必须配合 cloudbase_gateway 持久化仓库');
  const required=['CLOUDBASE_PG_ENV_ID','CLOUDBASE_PG_SERVER_API_KEY','CLOUDBASE_PG_REGION','CLOUDBASE_PG_MIGRATIONS_APPLIED','CLOUDBASE_STORAGE_BUCKET_ID','CLOUDBASE_STORAGE_CREDENTIAL_PURPOSE','CLOUDBASE_STORAGE_DOWNLOAD_MODE','CLOUDBASE_STORAGE_PREVIEW_MODE','OBJECT_LOCATOR_ENCRYPTION_KEY'];
  const missing=required.filter(name=>!present(environment[name]));if(missing.length)throw new Error(`CloudBase 私有对象存储配置不完整：缺少 ${missing.join(', ')}`);
  if(environment.CLOUDBASE_PG_REGION!==STORAGE_REGION)throw new Error(`CLOUDBASE_PG_REGION 当前只允许 ${STORAGE_REGION}`);
  if(!ACCEPTED_STORAGE_MIGRATIONS.has(environment.CLOUDBASE_PG_MIGRATIONS_APPLIED))throw new Error(`CloudBase PostgreSQL 迁移版本必须已包含 ${REQUIRED_STORAGE_MIGRATION}`);
  if(environment.CLOUDBASE_STORAGE_CREDENTIAL_PURPOSE!=='server_runtime')throw new Error('对象存储凭据用途必须为 server_runtime');
  if(flag(environment.CLOUDBASE_STORAGE_BUCKET_PRIVATE_CONFIRMED,false,'CLOUDBASE_STORAGE_BUCKET_PRIVATE_CONFIRMED')!==true)throw new Error('必须显式确认对象 Bucket 为 private');
  if(environment.CLOUDBASE_STORAGE_DOWNLOAD_MODE!=='node_proxy')throw new Error('当前下载模式必须为 node_proxy，禁止向客户端返回长期或裸链接');
  if(environment.CLOUDBASE_STORAGE_PREVIEW_MODE!=='metadata_only')throw new Error('当前预览模式必须为 metadata_only，不得伪称已配置转码/预览');
  const envId=String(environment.CLOUDBASE_PG_ENV_ID).trim(),bucketId=String(environment.CLOUDBASE_STORAGE_BUCKET_ID).trim();
  if(!/^[a-z][a-z0-9-]{2,62}$/i.test(envId))throw new Error('CLOUDBASE_PG_ENV_ID 格式无效');
  if(!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucketId))throw new Error('CLOUDBASE_STORAGE_BUCKET_ID 格式无效');
  const maxFileBytes=integer(environment.CLOUDBASE_STORAGE_MAX_FILE_BYTES,MAX_MVP_FILE_BYTES,1024,MAX_MVP_FILE_BYTES,'CLOUDBASE_STORAGE_MAX_FILE_BYTES');
  const timeoutMs=integer(environment.CLOUDBASE_STORAGE_TIMEOUT_MS,15000,1000,30000,'CLOUDBASE_STORAGE_TIMEOUT_MS');
  return {enabled:true,provider:STORAGE_PROVIDER,envId,bucketId,region:STORAGE_REGION,origin:`https://${envId}.api.tcloudbasegateway.com`,serverApiKey:String(environment.CLOUDBASE_PG_SERVER_API_KEY),locatorEncryptionKey:key32(environment,'OBJECT_LOCATOR_ENCRYPTION_KEY'),maxFileBytes,timeoutMs,downloadMode:'node_proxy',previewMode:'metadata_only',safeSummary:{enabled:true,persistent:true,provider:STORAGE_PROVIDER,privateBucketConfirmed:true,serverOnly:true,downloadMode:'node_proxy',previewMode:'metadata_only',maxFileBytes,multipartEnabled:false,credentialsExposed:false}};
}

module.exports={REQUIRED_STORAGE_MIGRATION,STORAGE_PROVIDER,STORAGE_REGION,MAX_MVP_FILE_BYTES,resolvePrivateObjectStorageConfig};
