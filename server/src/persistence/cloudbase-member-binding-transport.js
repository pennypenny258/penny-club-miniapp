'use strict';

const crypto=require('node:crypto');
const {TRANSPORT_KIND}=require('./member-binding-gateway-adapter');

const REQUIRED_BASELINE='008_admin_session_rbac';
const TRANSPORT_MODE='verified_postgrest_rpc';
const MAX_REQUEST_BYTES=32768;
const LOGICAL_OPERATIONS=Object.freeze(['resolveExactCrmMatch','persistCandidate','listPending','bindIdentityIdempotently','rejectCandidate']);
const EVIDENCE_KEYS=Object.freeze(['rpcExistence','serviceRoleExecute','publicExecuteDenied','anonExecuteDenied','authenticatedExecuteDenied','transactionalIdentityWrite','idempotencyKeyUnique','safeResponseProjection']);
class CloudBaseMemberBindingRpcError extends Error{constructor(code='CLOUDBASE_MEMBER_BINDING_RPC_UNAVAILABLE'){super('CloudBase 会员绑定服务暂时不可用');this.code=code;this.statusCode=503}}
function present(value){return Boolean(String(value||'').trim())}
function flag(value,name){if(value===undefined||value===null||value==='')return false;if(value==='true')return true;if(value==='false')return false;throw new Error(`${name} 只允许 true 或 false`)}
function canonicalManifest(manifest){return JSON.stringify({version:manifest.version,baseline:manifest.baseline,platform:manifest.platform,rpc:Object.fromEntries(LOGICAL_OPERATIONS.map(key=>[key,manifest.rpc?.[key]])),evidence:{source:manifest.evidence?.source,verifiedAt:manifest.evidence?.verifiedAt,...Object.fromEntries(EVIDENCE_KEYS.map(key=>[key,manifest.evidence?.[key]]))}})}
function manifestChecksum(manifest){return crypto.createHash('sha256').update(canonicalManifest(manifest)).digest('hex')}
function verifyCapabilityManifest(manifest){
  if(!manifest||manifest.version!=='member-binding-rpc-v1'||manifest.baseline!==REQUIRED_BASELINE||manifest.platform!=='cloudbase_postgrest_rpc')throw new Error('会员绑定 RPC 能力清单版本或基线无效');
  for(const operation of LOGICAL_OPERATIONS)if(!/^venture_[a-z0-9_]{8,80}$/.test(String(manifest.rpc?.[operation]||'')))throw new Error(`会员绑定 RPC 能力清单缺少 ${operation}`);
  if(new Set(Object.values(manifest.rpc)).size!==LOGICAL_OPERATIONS.length)throw new Error('会员绑定 RPC 名称必须逐操作隔离');
  const evidence=manifest.evidence||{};for(const key of EVIDENCE_KEYS)if(evidence[key]!==true)throw new Error(`会员绑定 RPC 能力证明缺少 ${key}`);
  if(evidence.source!=='cloudbase_readonly_contract_check'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(evidence.verifiedAt||'')))throw new Error('会员绑定 RPC 能力证明来源或时间无效');
  const checksum=manifestChecksum(manifest);if(manifest.checksum!==checksum)throw new Error('会员绑定 RPC 能力清单校验和不一致');return Object.freeze({...manifest,rpc:Object.freeze({...manifest.rpc}),evidence:Object.freeze({...evidence})});
}
function resolveCloudBaseMemberBindingTransportConfig(environment=process.env,{persistenceConfig,capabilityManifest}={}){
  const enabled=flag(environment.CLOUDBASE_MEMBER_BINDING_WRITES_ENABLED,'CLOUDBASE_MEMBER_BINDING_WRITES_ENABLED'),hasPrepared=present(environment.CLOUDBASE_MEMBER_BINDING_TRANSPORT)||present(environment.CLOUDBASE_MEMBER_BINDING_CAPABILITY_SHA256);
  if(!enabled){if(hasPrepared)throw new Error('会员绑定写入未启用，拒绝静默保留 transport 或能力清单配置');return {enabled:false,mode:'disabled',safeSummary:{enabled:false,serverOnly:true,directTableWrites:false,routesEnabled:false,credentialsExposed:false}}}
  if(environment.NODE_ENV!=='production'||environment.DEPLOYMENT_PROFILE==='cloudbase_staging_demo'||environment.DEMO_DATA_ONLY==='true')throw new Error('会员绑定写入 transport 只允许非 demo production');
  if(environment.FORMAL_MEMBER_BINDING_ROUTES_ENABLED!=='false')throw new Error('离线准备阶段要求正式会员绑定路由继续保持 false');
  if(environment.CLOUDBASE_MEMBER_BINDING_TRANSPORT!==TRANSPORT_MODE)throw new Error(`CLOUDBASE_MEMBER_BINDING_TRANSPORT 必须为 ${TRANSPORT_MODE}`);
  if(persistenceConfig?.mode!=='cloudbase_gateway'||persistenceConfig.runtimeEnvironment!=='production'||persistenceConfig.safeSummary?.rolePurpose==='migrator')throw new Error('会员绑定写入 transport 需要生产 CloudBase server_runtime 网关配置');
  if(environment.CLOUDBASE_PG_CREDENTIAL_PURPOSE!=='server_runtime')throw new Error('会员绑定写入 transport 只接受 CloudBase 服务端 runtime API Key');
  if(environment.CLOUDBASE_PG_MIGRATIONS_APPLIED!==REQUIRED_BASELINE)throw new Error(`会员绑定写入 transport 只允许 ${REQUIRED_BASELINE} 基线`);
  const manifest=verifyCapabilityManifest(capabilityManifest),expected=String(environment.CLOUDBASE_MEMBER_BINDING_CAPABILITY_SHA256||'');if(!/^[0-9a-f]{64}$/.test(expected)||expected!==manifest.checksum)throw new Error('CLOUDBASE_MEMBER_BINDING_CAPABILITY_SHA256 未匹配已验证能力清单');
  return {enabled:true,mode:TRANSPORT_MODE,origin:persistenceConfig.origin,serverApiKey:persistenceConfig.serverApiKey,timeoutMs:persistenceConfig.timeoutMs,maxResponseBytes:Math.min(persistenceConfig.maxResponseBytes,65536),manifest,safeSummary:{enabled:true,serverOnly:true,credentialType:'cloudbase_service_role_api_key',verifiedRpcOnly:true,directTableWrites:false,routesEnabled:false,credentialsExposed:false}};
}

class CloudBaseVerifiedRpcClient{
  constructor({config,fetchImpl=globalThis.fetch}){if(!config?.enabled||config.mode!==TRANSPORT_MODE||!config.manifest)throw new Error('CloudBase RPC client 需要已验证能力配置');const origin=new URL(config.origin);if(origin.protocol!=='https:'||!/^[a-z][a-z0-9-]{2,62}\.api\.tcloudbasegateway\.com$/i.test(origin.hostname)||origin.pathname!=='/')throw new Error('CloudBase RPC client origin 无效');verifyCapabilityManifest(config.manifest);if(!present(config.serverApiKey)||typeof fetchImpl!=='function')throw new Error('CloudBase RPC client 需要服务端 API Key 与 fetch');this.config=config;this.fetchImpl=fetchImpl}
  async call(operation,payload){
    if(!LOGICAL_OPERATIONS.includes(operation))throw new Error('CloudBase 会员绑定 RPC 操作不在固定白名单');if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new CloudBaseMemberBindingRpcError('CLOUDBASE_MEMBER_BINDING_RPC_REQUEST_INVALID');const requestBody=JSON.stringify(payload);if(Buffer.byteLength(requestBody,'utf8')>MAX_REQUEST_BYTES)throw new CloudBaseMemberBindingRpcError('CLOUDBASE_MEMBER_BINDING_RPC_REQUEST_TOO_LARGE');const functionName=this.config.manifest.rpc[operation],url=new URL(`/v1/rdb/rest/rpc/${functionName}`,this.config.origin),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);let response,text;
    try{response=await this.fetchImpl(url,{method:'POST',redirect:'error',signal:controller.signal,headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${this.config.serverApiKey}`},body:requestBody});if(!response?.ok)throw new CloudBaseMemberBindingRpcError();const contentType=String(response.headers?.get?.('content-type')||'').toLowerCase();if(contentType&&!contentType.includes('application/json'))throw new CloudBaseMemberBindingRpcError('CLOUDBASE_MEMBER_BINDING_RPC_INVALID_RESPONSE');const declared=Number(response.headers?.get?.('content-length'));if(Number.isFinite(declared)&&declared>this.config.maxResponseBytes)throw new CloudBaseMemberBindingRpcError('CLOUDBASE_MEMBER_BINDING_RPC_RESPONSE_TOO_LARGE');text=await response.text();if(Buffer.byteLength(text,'utf8')>this.config.maxResponseBytes)throw new CloudBaseMemberBindingRpcError('CLOUDBASE_MEMBER_BINDING_RPC_RESPONSE_TOO_LARGE')}catch(error){if(error instanceof CloudBaseMemberBindingRpcError)throw error;throw new CloudBaseMemberBindingRpcError(error?.name==='AbortError'?'CLOUDBASE_MEMBER_BINDING_RPC_TIMEOUT':'CLOUDBASE_MEMBER_BINDING_RPC_UNAVAILABLE')}finally{clearTimeout(timer)}
    try{return JSON.parse(text)}catch{throw new CloudBaseMemberBindingRpcError('CLOUDBASE_MEMBER_BINDING_RPC_INVALID_RESPONSE')}
  }
  safeReadiness(){return {transport:'cloudbase_postgrest_rpc',serverOnly:true,verifiedCapabilityManifest:true,directTableWrites:false,credentialsExposed:false,routesEnabled:false}}
}

class PreparedCloudBaseMemberBindingTransport{
  constructor({client}){if(!(client instanceof CloudBaseVerifiedRpcClient))throw new Error('会员绑定 transport 需要已验证 CloudBase RPC client');this.kind=TRANSPORT_KIND;this.client=client}
  resolveExactCrmMatch(payload){return this.client.call('resolveExactCrmMatch',payload)}
  persistCandidate(payload){return this.client.call('persistCandidate',payload)}
  listPending(payload){return this.client.call('listPending',payload)}
  bindIdentityIdempotently(payload){return this.client.call('bindIdentityIdempotently',payload)}
  rejectCandidate(payload){return this.client.call('rejectCandidate',payload)}
  safeReadiness(){return {kind:this.kind,prepared:true,runtimeEnabled:false,verifiedRpcOnly:true,directTableWrites:false,routesEnabled:false,credentialsExposed:false}}
}

module.exports={REQUIRED_BASELINE,TRANSPORT_MODE,MAX_REQUEST_BYTES,LOGICAL_OPERATIONS,CloudBaseMemberBindingRpcError,manifestChecksum,verifyCapabilityManifest,resolveCloudBaseMemberBindingTransportConfig,CloudBaseVerifiedRpcClient,PreparedCloudBaseMemberBindingTransport};
