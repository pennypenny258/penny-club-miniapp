'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const FEISHU_API_ORIGIN = 'https://open.feishu.cn';
const SAFE_CATEGORIES = ['not_configured','invalid_credentials','permission_denied','resource_not_found','rate_limited','network_error','invalid_response','upstream_error','private_storage_not_configured','attachment_too_large'];

class FeishuSafeError extends Error {
  constructor(category,message,statusCode=502){super(message);this.name='FeishuSafeError';this.category=SAFE_CATEGORIES.includes(category)?category:'upstream_error';this.statusCode=statusCode}
}

class EnvFeishuSecretProvider {
  constructor(environment=process.env){this.environment=environment}
  async getCredentials(){
    const appId=String(this.environment.FEISHU_APP_ID||'').trim();
    const appSecret=String(this.environment.FEISHU_APP_SECRET||'').trim();
    return appId&&appSecret?{configured:true,appId,appSecret}:{configured:false};
  }
}

function safeErrorFromStatus(status,code,phase='api') {
  if(status===401||(phase==='token'&&status===400))return new FeishuSafeError('invalid_credentials','服务端飞书应用凭据无效',502);
  if(status===403||code===131006)return new FeishuSafeError('permission_denied','应用缺少所需只读权限或知识库资源读权',403);
  if(status===404||code===131005)return new FeishuSafeError('resource_not_found','飞书节点或文件不存在，或应用不可见',404);
  if(status===429||code===99991400)return new FeishuSafeError('rate_limited','飞书接口限流，请稍后重试',503);
  return new FeishuSafeError('upstream_error','飞书服务调用失败',502);
}

class FeishuOpenApiClient {
  constructor({secretProvider=new EnvFeishuSecretProvider(),fetchImpl=globalThis.fetch,apiOrigin=FEISHU_API_ORIGIN,timeoutMs=15000}={}){
    this.secretProvider=secretProvider;this.fetchImpl=fetchImpl;this.apiOrigin=apiOrigin;this.timeoutMs=timeoutMs;
  }
  async configurationStatus(){const credentials=await this.secretProvider.getCredentials();return {configured:Boolean(credentials?.configured)}}
  async fetchWithTimeout(url,options){
    if(typeof this.fetchImpl!=='function')throw new FeishuSafeError('network_error','服务端网络客户端不可用');
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{return await this.fetchImpl(url,{...options,signal:controller.signal})}
    catch{throw new FeishuSafeError('network_error','无法连接飞书开放平台',503)}
    finally{clearTimeout(timer)}
  }
  async getTenantAccessToken(){
    const credentials=await this.secretProvider.getCredentials();
    if(!credentials?.configured)throw new FeishuSafeError('not_configured','等待服务端配置飞书应用凭据',409);
    const response=await this.fetchWithTimeout(`${this.apiOrigin}/open-apis/auth/v3/tenant_access_token/internal`,{method:'POST',headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({app_id:credentials.appId,app_secret:credentials.appSecret})});
    let payload;try{payload=await response.json()}catch{throw new FeishuSafeError('invalid_response','飞书鉴权响应格式无效')}
    if(!response.ok||payload?.code!==0)throw safeErrorFromStatus(response.status,payload?.code,'token');
    if(typeof payload.tenant_access_token!=='string'||!payload.tenant_access_token)throw new FeishuSafeError('invalid_response','飞书鉴权响应缺少访问凭证');
    return {token:payload.tenant_access_token,expiresIn:Number(payload.expire)||0};
  }
  async authorizedJson(pathname,token){
    const response=await this.fetchWithTimeout(`${this.apiOrigin}${pathname}`,{method:'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json; charset=utf-8'}});
    let payload;try{payload=await response.json()}catch{throw new FeishuSafeError('invalid_response','飞书数据响应格式无效')}
    if(!response.ok||payload?.code!==0)throw safeErrorFromStatus(response.status,payload?.code);
    return payload.data||{};
  }
  async authorizedBinary(pathname,token,maxBytes){
    const response=await this.fetchWithTimeout(`${this.apiOrigin}${pathname}`,{method:'GET',headers:{authorization:`Bearer ${token}`}});
    if(!response.ok)throw safeErrorFromStatus(response.status);
    const declared=Number(response.headers?.get?.('content-length')||0);if(declared&&declared>maxBytes)throw new FeishuSafeError('attachment_too_large','附件超过服务端迁入大小限制',413);
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>maxBytes)throw new FeishuSafeError('attachment_too_large','附件超过服务端迁入大小限制',413);
    return {bytes,mimeType:String(response.headers?.get?.('content-type')||'application/octet-stream').split(';')[0]};
  }
}

class FeishuConnectionService {
  constructor(client){this.client=client;this.last={status:'unknown',lastTestAt:null,errorCategory:null}}
  async getSafeStatus(){const {configured}=await this.client.configurationStatus();if(!configured)return {status:'not_configured',configured:false,lastTestAt:this.last.lastTestAt,errorCategory:null};return {status:this.last.status==='connection_success'||this.last.status==='connection_failed'?this.last.status:'configured',configured:true,lastTestAt:this.last.lastTestAt,errorCategory:this.last.errorCategory}}
  async testConnection(){
    const at=new Date().toISOString();
    try{const configured=await this.client.configurationStatus();if(!configured){this.last={status:'not_configured',lastTestAt:at,errorCategory:'not_configured'};return this.getSafeStatus()}await this.client.getTenantAccessToken();this.last={status:'connection_success',lastTestAt:at,errorCategory:null};return this.getSafeStatus()}
    catch(error){const category=error instanceof FeishuSafeError?error.category:'upstream_error';this.last={status:'connection_failed',lastTestAt:at,errorCategory:category};return {status:category==='not_configured'?'not_configured':'connection_failed',configured:category!=='not_configured',lastTestAt:at,errorCategory:category}}
  }
}
function validateConnectionTestInput(input){if(Object.keys(input||{}).length)throw new FeishuSafeError('invalid_response','测试连接不接受任何前端凭据或参数',400);return true}

function buildMigrationReadiness({connection,privateStorageConfigured,environmentName='development'}={}){
  const safeConnection={status:connection?.status||'not_configured',configured:Boolean(connection?.configured),lastTestAt:connection?.lastTestAt||null,errorCategory:connection?.errorCategory||null};
  const identityReady=safeConnection.status==='connection_success';
  const connectionFailed=safeConnection.status==='connection_failed';
  const steps=[
    {key:'server_credentials',label:'服务端 App ID / Secret',status:safeConnection.configured?'complete':'blocked',detail:safeConnection.configured?'已由服务端私密环境读取；后台不会显示值':'在部署平台或本机私密启动环境配置后重启服务'},
    {key:'connection_test',label:'应用身份测试',status:identityReady?'complete':connectionFailed?'failed':'pending',detail:identityReady?'已取得安全连接成功状态；不代表目标 Wiki 已授权':connectionFailed?'按安全错误分类修正凭据、网络或应用配置':'服务端配置生效后，在后台点击“测试连接”'},
    {key:'wiki_authorization',label:'目标 Wiki 资源读权',status:'operator_action',detail:'在飞书侧把目标知识库/节点授予该应用读取；首次迁入读取目录时才可验证'},
    {key:'private_storage',label:'私有附件存储',status:privateStorageConfigured?'complete':'blocked',detail:privateStorageConfigured?'服务端私有存储适配器已配置':'迁入执行前必须配置；浏览器不接收存储凭据或路径'},
    {key:'root_link',label:'根 Wiki 链接',status:'task_input',detail:'只在创建任务时校验并提取节点标识；链接不回显、不记日志'},
    {key:'preflight_and_run',label:'预检与一次性迁入',status:identityReady&&privateStorageConfigured?'ready':'pending',detail:'创建任务后再运行；所有内容固定进入待审核区，不持续同步'}
  ];
  let nextAction='GRANT_WIKI_AND_CREATE_TASK',nextActionText='确认目标 Wiki 已授权给应用，粘贴根链接并创建预检任务';
  if(!safeConnection.configured){nextAction='CONFIGURE_SERVER_SECRETS';nextActionText='先在部署环境配置 FEISHU_APP_ID、FEISHU_APP_SECRET，并重启服务'}
  else if(connectionFailed){nextAction='FIX_CONNECTION';nextActionText='根据安全错误分类修正配置后，再次测试连接'}
  else if(!identityReady){nextAction='TEST_CONNECTION';nextActionText='点击“测试连接”，仅验证服务端应用身份'}
  else if(!privateStorageConfigured){nextAction='CONFIGURE_PRIVATE_STORAGE';nextActionText='配置私有附件存储并重启服务，再运行迁入'}
  return {environmentMode:environmentName==='production'?'production':'local_demo',connection:safeConnection,privateStorageConfigured:Boolean(privateStorageConfigured),canCreateOfficialTask:identityReady,canRunOfficialMigration:identityReady&&Boolean(privateStorageConfigured),nextAction,nextActionText,serverRestartRequiredAfterConfiguration:true,browserAcceptsSecrets:false,rawUpstreamDataReturned:false,steps};
}

class DisabledPrivateStorageAdapter {
  async putPrivate(){throw new FeishuSafeError('private_storage_not_configured','附件私有存储尚未配置',409)}
  get configured(){return false}
}
class LocalPrivateStorageAdapter {
  constructor(rootDirectory){this.rootDirectory=path.resolve(rootDirectory)}
  get configured(){return true}
  async putPrivate({bytes}){const id=randomUUID();await fs.mkdir(this.rootDirectory,{recursive:true,mode:0o700});await fs.writeFile(path.join(this.rootDirectory,id),bytes,{mode:0o600,flag:'wx'});return {storageRef:`private:${id}`}}
}
function privateStorageFromEnvironment(environment=process.env){const directory=String(environment.PRIVATE_STORAGE_DIR||'').trim();return directory?new LocalPrivateStorageAdapter(directory):new DisabledPrivateStorageAdapter()}

function collectMediaTokens(blocks){
  const result=[];
  for(const block of blocks||[]){if(block?.image?.token)result.push({kind:'media',token:block.image.token});if(block?.file?.token)result.push({kind:'media',token:block.file.token})}
  return result;
}

class OfficialFeishuReadonlyAdapter {
  constructor({client,privateStorage=new DisabledPrivateStorageAdapter(),maxAttachmentBytes=20*1024*1024,maxNodes=500}={}){this.client=client;this.privateStorage=privateStorage;this.maxAttachmentBytes=maxAttachmentBytes;this.maxNodes=maxNodes}
  async isConfigured(){return (await this.client.configurationStatus()).configured}
  async readJsonPages(pathFactory,token,itemPath='items'){
    const items=[];let pageToken='';
    do{const data=await this.client.authorizedJson(pathFactory(pageToken),token);items.push(...(data[itemPath]||[]));pageToken=data.has_more?String(data.page_token||''):'';if(items.length>this.maxNodes)throw new FeishuSafeError('upstream_error','迁入节点数量超过单任务安全上限',409)}while(pageToken);
    return items;
  }
  async getNode(nodeToken,token){const data=await this.client.authorizedJson(`/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(nodeToken)}`,token);if(!data.node)throw new FeishuSafeError('invalid_response','飞书节点响应缺少节点信息');return data.node}
  async listChildren(spaceId,parentNodeToken,token){return this.readJsonPages(pageToken=>`/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes?page_size=50&parent_node_token=${encodeURIComponent(parentNodeToken)}${pageToken?`&page_token=${encodeURIComponent(pageToken)}`:''}`,token)}
  async readTree(rootNodeToken){
    const {token}=await this.client.getTenantAccessToken();const root=await this.getNode(rootNodeToken,token);const nodes=[root];const queue=root.has_child?[root]:[];
    while(queue.length){const parent=queue.shift();const children=await this.listChildren(parent.space_id,parent.node_token,token);for(const child of children){nodes.push(child);if(child.has_child)queue.push(child)}if(nodes.length>this.maxNodes)throw new FeishuSafeError('upstream_error','迁入节点数量超过单任务安全上限',409)}
    return {token,nodes};
  }
  async readDocx(documentId,token){
    const raw=await this.client.authorizedJson(`/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`,token);
    const blocks=await this.readJsonPages(pageToken=>`/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks?page_size=500${pageToken?`&page_token=${encodeURIComponent(pageToken)}`:''}`,token);
    const attachments=[];for(const media of collectMediaTokens(blocks)){const file=await this.client.authorizedBinary(`/open-apis/drive/v1/medias/${encodeURIComponent(media.token)}/download`,token,this.maxAttachmentBytes);const stored=await this.privateStorage.putPrivate(file);attachments.push({storageRef:stored.storageRef,mimeType:file.mimeType})}
    return {body:String(raw.content||''),attachments};
  }
  async readFile(fileToken,token){const file=await this.client.authorizedBinary(`/open-apis/drive/v1/files/${encodeURIComponent(fileToken)}/download`,token,this.maxAttachmentBytes);const stored=await this.privateStorage.putPrivate(file);return {body:'',attachments:[{storageRef:stored.storageRef,mimeType:file.mimeType}]}}
  async readNode(node,token){if(node.obj_type==='docx')return this.readDocx(node.obj_token,token);if(node.obj_type==='file')return this.readFile(node.obj_token,token);return {body:'',attachments:[],unsupportedType:node.obj_type||'unknown'}}
}

async function executeOfficialMigration({task,rootNodeToken,adapter,routeNode}){
  if(!task?.rootLinkValidated)throw new FeishuSafeError('invalid_response','迁入任务缺少已校验的 Wiki 根节点',409);
  if(!rootNodeToken)throw new FeishuSafeError('invalid_response','迁入任务缺少私有根节点引用',409);
  if(!(await adapter.isConfigured()))throw new FeishuSafeError('not_configured','等待服务端配置飞书应用凭据',409);
  const {token,nodes}=await adapter.readTree(rootNodeToken);const results=[];const safeIds=new Map(nodes.map((node,index)=>[node.node_token,`node-${index+1}`]));
  for(const node of nodes){const route=routeNode(node);try{const content=await adapter.readNode(node,token);results.push({title:String(node.title||'未命名资料'),sourceKind:String(node.obj_type||'unknown'),destination:content.unsupportedType?'quarantine':route.destination,status:content.unsupportedType?'needs_classification':'pending_review',body:content.body,privateAttachments:content.attachments,sourceHandlePresent:false})}catch(error){results.push({title:String(node.title||'未命名资料'),sourceKind:String(node.obj_type||'unknown'),destination:'quarantine',status:'failed',failureCategory:error instanceof FeishuSafeError?error.category:'upstream_error',body:'',privateAttachments:[],sourceHandlePresent:false})}}
  return {items:results,directoryTree:nodes.map(node=>({id:safeIds.get(node.node_token),parentId:safeIds.get(node.parent_node_token)||null,label:String(node.title||'未命名资料'),kind:node.has_child?'directory':'item',itemCount:node.has_child?null:1}))};
}

module.exports={FEISHU_API_ORIGIN,FeishuSafeError,EnvFeishuSecretProvider,FeishuOpenApiClient,FeishuConnectionService,validateConnectionTestInput,buildMigrationReadiness,DisabledPrivateStorageAdapter,LocalPrivateStorageAdapter,privateStorageFromEnvironment,collectMediaTokens,OfficialFeishuReadonlyAdapter,executeOfficialMigration};
