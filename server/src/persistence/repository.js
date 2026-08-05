'use strict';

class MemoryDemoRepository{
  constructor(store){this.kind='memory_demo';this.store=store}
  getDomainStore(){return this.store}
  safeReadiness(){return {kind:this.kind,persistent:false,anonymousDemoOnly:true}}
}

class PostgresRepository{
  constructor({config,clientFactory}){if(!config?.enabled||config.mode!=='postgres')throw new Error('PostgresRepository 需要已通过预检的 postgres 配置');if(typeof clientFactory!=='function')throw new Error('PostgresRepository 需要服务端 PostgreSQL clientFactory');this.kind='postgres';this.config=config;this.clientFactory=clientFactory}
  async withTransaction(work){const client=await this.clientFactory();try{await client.query('BEGIN');await client.query(`SET LOCAL search_path TO ${this.config.schema}, pg_catalog`);await client.query(`SET LOCAL statement_timeout TO '${this.config.statementTimeoutMs}ms'`);const result=await work(client);await client.query('COMMIT');return result}catch(error){try{await client.query('ROLLBACK')}catch{void 0}throw error}finally{if(typeof client.release==='function')client.release()}}
  safeReadiness(){return {kind:this.kind,persistent:true,schema:this.config.schema,tlsVerified:true,credentialsExposed:false}}
}

const CLOUDBASE_READ_VIEWS=Object.freeze({resources:'venture_resources_published',activities:'venture_activities_public',entitlements:'venture_member_access_entitlement',resourceStorageCompliance:'venture_resource_storage_compliance',resourceDownloadObject:'venture_resource_download_object',governedImportReviewQueue:'venture_governed_import_review_queue',membershipRecomputeInputs:'venture_membership_recompute_inputs',materializationSource:'venture_materialization_source',materializationStatus:'venture_materialization_status',adminSessionAccess:'venture_admin_session_access'});
const RESOURCE_FIELDS='id,type,title,summary,tags,access_level,mobile_section,preview_status,download_enabled,published_at,updated_at';
const ACTIVITY_FIELDS='id,format,title,description,starts_at,ends_at,registration_ends_at,category,city,venue,status,created_at';
const ENTITLEMENT_FIELDS='subject_hash,member_id,account_active,membership_start,membership_end,crm_verified,payment_verified,payment_reviewed_at,group_active,decision_active,entitlement_version';

class CloudBaseGatewayError extends Error{
  constructor(message,{status,requestId,code='CLOUDBASE_GATEWAY_REQUEST_FAILED'}={}){super(message);this.name='CloudBaseGatewayError';this.code=code;this.status=status;this.requestId=requestId}
}

class CloudBaseGatewayTransport{
  constructor({config,fetchImpl=globalThis.fetch}){if(!config?.enabled||config.mode!=='cloudbase_gateway')throw new Error('CloudBaseGatewayTransport 需要已通过预检的 cloudbase_gateway 配置');if(typeof fetchImpl!=='function')throw new Error('CloudBaseGatewayTransport 需要服务端 fetch 实现');this.config=config;this.fetchImpl=fetchImpl}
  async readView(view,parameters){
    if(!Object.values(CLOUDBASE_READ_VIEWS).includes(view))throw new Error('CloudBase PostgreSQL 视图不在服务端只读白名单');
    const url=new URL(`/v1/rdb/rest/${view}`,this.config.origin);for(const [key,value] of parameters)url.searchParams.append(key,String(value));
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),this.config.timeoutMs);
    let response;
    try{response=await this.fetchImpl(url,{method:'GET',redirect:'error',signal:controller.signal,headers:{accept:'application/json',authorization:`Bearer ${this.config.serverApiKey}`}})}catch(error){const code=error?.name==='AbortError'?'CLOUDBASE_GATEWAY_TIMEOUT':'CLOUDBASE_GATEWAY_UNAVAILABLE';throw new CloudBaseGatewayError(code==='CLOUDBASE_GATEWAY_TIMEOUT'?'CloudBase PostgreSQL 网关请求超时':'CloudBase PostgreSQL 网关不可用',{code})}finally{clearTimeout(timeout)}
    const requestId=response.headers?.get?.('x-request-id')||undefined;
    if(!response.ok)throw new CloudBaseGatewayError('CloudBase PostgreSQL 网关拒绝请求',{status:response.status,requestId});
    const contentType=String(response.headers?.get?.('content-type')||'').toLowerCase();if(!contentType.includes('application/json'))throw new CloudBaseGatewayError('CloudBase PostgreSQL 网关返回了非 JSON 响应',{status:response.status,requestId,code:'CLOUDBASE_GATEWAY_INVALID_RESPONSE'});
    const text=await readResponseText(response,this.config.maxResponseBytes,{status:response.status,requestId});
    let data;try{data=JSON.parse(text)}catch{throw new CloudBaseGatewayError('CloudBase PostgreSQL 网关响应无法解析',{status:response.status,requestId,code:'CLOUDBASE_GATEWAY_INVALID_RESPONSE'})}
    if(!Array.isArray(data))throw new CloudBaseGatewayError('CloudBase PostgreSQL 网关响应契约不匹配',{status:response.status,requestId,code:'CLOUDBASE_GATEWAY_INVALID_RESPONSE'});return data;
  }
}

async function readResponseText(response,maxBytes,errorContext){
  const declared=Number(response.headers?.get?.('content-length'));if(Number.isFinite(declared)&&declared>maxBytes)throw new CloudBaseGatewayError('CloudBase PostgreSQL 网关响应超过安全上限',{...errorContext,code:'CLOUDBASE_GATEWAY_RESPONSE_TOO_LARGE'});
  if(!response.body?.getReader){const text=await response.text();if(Buffer.byteLength(text,'utf8')>maxBytes)throw new CloudBaseGatewayError('CloudBase PostgreSQL 网关响应超过安全上限',{...errorContext,code:'CLOUDBASE_GATEWAY_RESPONSE_TOO_LARGE'});return text}
  const reader=response.body.getReader(),chunks=[];let total=0;
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw new CloudBaseGatewayError('CloudBase PostgreSQL 网关响应超过安全上限',{...errorContext,code:'CLOUDBASE_GATEWAY_RESPONSE_TOO_LARGE'})}chunks.push(Buffer.from(value))}
  return Buffer.concat(chunks,total).toString('utf8');
}

class CloudBaseGatewayRepository{
  constructor({config,fetchImpl}){this.kind='cloudbase_gateway';this.config=config;this.transport=new CloudBaseGatewayTransport({config,fetchImpl})}
  listPublishedResources({limit=50}={}){const safeLimit=boundedLimit(limit);return this.transport.readView(CLOUDBASE_READ_VIEWS.resources,[['select',RESOURCE_FIELDS],['order','published_at.desc'],['limit',safeLimit]])}
  listPublicActivities({limit=50}={}){const safeLimit=boundedLimit(limit);return this.transport.readView(CLOUDBASE_READ_VIEWS.activities,[['select',ACTIVITY_FIELDS],['order','starts_at.asc'],['limit',safeLimit]])}
  async resolveMemberEntitlement({subjectHash}){if(!/^[0-9a-f]{64}$/.test(String(subjectHash||'')))throw new Error('会员 subject 哈希格式无效');const rows=await this.transport.readView(CLOUDBASE_READ_VIEWS.entitlements,[['select',ENTITLEMENT_FIELDS],['subject_hash',`eq.${subjectHash}`],['limit',1]]);return rows[0]||null}
  safeReadiness(){return {kind:this.kind,persistent:true,transport:'https_postgrest',serverOnly:true,methods:['published_resources.read','public_activities.read'],identityEntitlementPrepared:true,credentialsExposed:false}}
}

function boundedLimit(value){const parsed=Number(value);if(!Number.isInteger(parsed)||parsed<1||parsed>100)throw new Error('CloudBase 网关分页上限必须为 1–100 的整数');return parsed}
function createRepository({config,store,clientFactory,fetchImpl}){if(config.mode==='memory_demo')return new MemoryDemoRepository(store);if(config.mode==='postgres')return new PostgresRepository({config,clientFactory});return new CloudBaseGatewayRepository({config,fetchImpl})}

module.exports={CLOUDBASE_READ_VIEWS,CloudBaseGatewayError,CloudBaseGatewayTransport,CloudBaseGatewayRepository,MemoryDemoRepository,PostgresRepository,createRepository};
