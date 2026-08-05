'use strict';
const {CloudBaseGatewayTransport}=require('./repository');

const RPC=Object.freeze({request:'venture_request_materialization',execute:'venture_execute_materialization',compensate:'venture_compensate_materialization',publishDirectory:'venture_approve_directory_publication'});
const VIEWS=Object.freeze({source:'venture_materialization_source',request:'venture_materialization_status'});
const SOURCE_FIELDS='row_id,batch_id,domain,row_fingerprint,row_status,match_status,matched_user_id,row_reviewed_by,batch_actor_id,validation_codes,safe_projection,protected_payload_ciphertext';
const REQUEST_FIELDS='request_id,row_id,batch_id,domain,status,requester_id,executor_id,batch_actor_id,row_reviewed_by,matched_user_id,fact_id,fact_status,directory_publication_status,created_at,executed_at';
class MaterializationUnavailableError extends Error{constructor(){super('受控分域物化服务暂时不可用');this.name='MaterializationUnavailableError';this.code='MATERIALIZATION_UNAVAILABLE';this.statusCode=503}}
function id(value,label='标识'){const text=String(value||'');if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(text))throw new Error(`${label}格式无效`);return text}

class CloudBaseMaterializationRepository{
  constructor({config,fetchImpl=globalThis.fetch}){if(!config?.enabled||config.mode!=='cloudbase_gateway'||config.runtimeEnvironment!=='production')throw new Error('物化仓库需要已通过生产预检的 cloudbase_gateway 配置');this.kind='cloudbase_gateway';this.config=config;this.fetchImpl=fetchImpl;this.readTransport=new CloudBaseGatewayTransport({config,fetchImpl})}
  async getSource(rowId){const rows=await this.readTransport.readView(VIEWS.source,[['select',SOURCE_FIELDS],['row_id',`eq.${id(rowId,'导入行')}`],['limit',1]]);return rows[0]||null}
  async getRequest(requestId){const rows=await this.readTransport.readView(VIEWS.request,[['select',REQUEST_FIELDS],['request_id',`eq.${id(requestId,'物化请求')}`],['limit',1]]);return rows[0]||null}
  request(input){return this.callRpc(RPC.request,{p_request_id:id(input.requestId,'物化请求'),p_row_id:id(input.rowId,'导入行'),p_requester_id:id(input.requesterId,'复核人'),p_fact_id:id(input.factId,'事实'),p_idempotency_key_hash:String(input.idempotencyKeyHash),p_payload_digest:String(input.payloadDigest),p_fact_payload:input.factPayload})}
  execute(input){return this.callRpc(RPC.execute,{p_request_id:id(input.requestId,'物化请求'),p_executor_id:id(input.executorId,'执行人')})}
  compensate(input){return this.callRpc(RPC.compensate,{p_request_id:id(input.requestId,'物化请求'),p_actor_id:id(input.actorId,'补偿人'),p_reason_codes:input.reasonCodes||[]})}
  approveDirectory(input){return this.callRpc(RPC.publishDirectory,{p_request_id:id(input.requestId,'物化请求'),p_approver_id:id(input.approverId,'名册审批人')})}
  async callRpc(name,payload){if(!Object.values(RPC).includes(name))throw new Error('物化 RPC 不在服务端白名单');const url=new URL(`/v1/rdb/rest/rpc/${name}`,this.config.origin),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);try{const response=await this.fetchImpl(url,{method:'POST',redirect:'error',signal:controller.signal,headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${this.config.serverApiKey}`},body:JSON.stringify(payload)});if(!response?.ok)throw new MaterializationUnavailableError();const text=await response.text();if(Buffer.byteLength(text,'utf8')>65536)throw new MaterializationUnavailableError();const value=text?JSON.parse(text):null;if(!value||typeof value!=='object'||Array.isArray(value))throw new MaterializationUnavailableError();return value}catch(error){if(error instanceof MaterializationUnavailableError)throw error;throw new MaterializationUnavailableError()}finally{clearTimeout(timer)}}
  safeReadiness(){return {kind:this.kind,persistent:true,serverOnly:true,separationOfDuties:true,domains:['crm','payment','directory'],memoryFallback:false,credentialsExposed:false}}
}
module.exports={RPC,VIEWS,MaterializationUnavailableError,CloudBaseMaterializationRepository};
