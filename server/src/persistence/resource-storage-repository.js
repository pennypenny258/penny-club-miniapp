'use strict';

const {CloudBaseGatewayTransport}=require('./repository');

const RPC=Object.freeze({begin:'venture_begin_resource_upload',complete:'venture_complete_resource_upload',fail:'venture_fail_resource_upload',review:'venture_review_resource_storage'});
const VIEWS=Object.freeze({compliance:'venture_resource_storage_compliance',download:'venture_resource_download_object'});
const COMPLIANCE_FIELDS='resource_id,resource_status,rights_review_status,attachment_count,ready_file_count,upload_status,security_review_status,preview_status,download_enabled,updated_at';
const DOWNLOAD_FIELDS='resource_id,resource_status,rights_review_status,download_enabled,file_status,file_extension,mime_type,size_bytes,sha256,object_ref_ciphertext,object_ref_hash';

class ResourcePersistenceUnavailableError extends Error{constructor(){super('资料持久化服务暂时不可用');this.name='ResourcePersistenceUnavailableError';this.code='RESOURCE_PERSISTENCE_UNAVAILABLE';this.statusCode=503}}
function id(value,label='标识'){const text=String(value||'');if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(text))throw new Error(`${label}格式无效`);return text}

class CloudBaseResourceStorageRepository{
  constructor({config,fetchImpl=globalThis.fetch}){if(!config?.enabled||config.mode!=='cloudbase_gateway'||config.runtimeEnvironment!=='production')throw new Error('资料持久化仓库需要已通过生产预检的 cloudbase_gateway 配置');this.kind='cloudbase_gateway';this.config=config;this.fetchImpl=fetchImpl;this.readTransport=new CloudBaseGatewayTransport({config,fetchImpl})}
  beginUpload(input){return this.callRpc(RPC.begin,{p_intent_id:id(input.intentId,'上传意图'),p_resource_id:id(input.resourceId,'资料'),p_import_item_id:id(input.importItemId,'导入项'),p_batch_id:id(input.batchId,'批次'),p_actor_id:id(input.actorId,'操作者'),p_title:String(input.title),p_summary:String(input.summary||''),p_tags:input.tags||[],p_type:String(input.type),p_mobile_section:String(input.mobileSection),p_expected_extension:String(input.extension).replace(/^\./,''),p_expected_mime_type:String(input.mimeType),p_expected_size_bytes:Number(input.sizeBytes),p_expected_sha256:String(input.sha256),p_requested_download_enabled:Boolean(input.downloadEnabled)})}
  completeUpload(input){return this.callRpc(RPC.complete,{p_intent_id:id(input.intentId,'上传意图'),p_file_id:id(input.fileId,'文件'),p_object_ref_ciphertext:String(input.objectRefCiphertext),p_object_ref_hash:String(input.objectRefHash),p_actual_size_bytes:Number(input.sizeBytes),p_actual_sha256:String(input.sha256)})}
  failUpload(input){return this.callRpc(RPC.fail,{p_intent_id:id(input.intentId,'上传意图'),p_failure_code:String(input.failureCode||'storage_unavailable')})}
  reviewResource(input){return this.callRpc(RPC.review,{p_review_id:id(input.reviewId,'审核'),p_resource_id:id(input.resourceId,'资料'),p_reviewer_id:id(input.reviewerId,'审核人'),p_decision:String(input.decision),p_copyright_confirmed:Boolean(input.copyrightConfirmed),p_security_review_status:String(input.securityReviewStatus),p_download_enabled:Boolean(input.downloadEnabled)})}
  async getCompliance(resourceId){const rows=await this.readTransport.readView(VIEWS.compliance,[['select',COMPLIANCE_FIELDS],['resource_id',`eq.${id(resourceId,'资料')}`],['limit',1]]);return rows[0]||null}
  async resolveDownloadObject(resourceId){const rows=await this.readTransport.readView(VIEWS.download,[['select',DOWNLOAD_FIELDS],['resource_id',`eq.${id(resourceId,'资料')}`],['limit',1]]);return rows[0]||null}
  async callRpc(name,payload){if(!Object.values(RPC).includes(name))throw new Error('资料持久化 RPC 不在服务端白名单');const url=new URL(`/v1/rdb/rest/rpc/${name}`,this.config.origin),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);try{const response=await this.fetchImpl(url,{method:'POST',redirect:'error',signal:controller.signal,headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${this.config.serverApiKey}`},body:JSON.stringify(payload)});if(!response?.ok)throw new ResourcePersistenceUnavailableError();const text=await response.text();if(Buffer.byteLength(text,'utf8')>65536)throw new ResourcePersistenceUnavailableError();const value=text?JSON.parse(text):null;if(!value||typeof value!=='object'||Array.isArray(value))throw new ResourcePersistenceUnavailableError();return value}catch(error){if(error instanceof ResourcePersistenceUnavailableError)throw error;throw new ResourcePersistenceUnavailableError()}finally{clearTimeout(timer)}}
  safeReadiness(){return {kind:this.kind,persistent:true,serverOnly:true,writePath:'fixed_service_role_checked_rpc',readViews:Object.values(VIEWS),credentialsExposed:false}}
}

module.exports={RPC,VIEWS,ResourcePersistenceUnavailableError,CloudBaseResourceStorageRepository};
