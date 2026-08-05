'use strict';

const {CloudBaseGatewayTransport}=require('./repository');

const RPC=Object.freeze({begin:'venture_begin_governed_import',stage:'venture_stage_governed_import_rows',review:'venture_review_governed_import_row',rollback:'venture_rollback_governed_import_batch',decision:'venture_record_membership_decision'});
const VIEWS=Object.freeze({reviewQueue:'venture_governed_import_review_queue',recompute:'venture_membership_recompute_inputs'});
const REVIEW_FIELDS='row_id,batch_id,domain,row_number,row_status,match_status,validation_codes,warning_codes,candidate_count,created_at,reviewed_at';
const RECOMPUTE_FIELDS='user_id,account_active,window_current,crm_verified,group_status,payment_verified,payment_reviewed_at,refund_status,conflict_present,recompute_required,input_version';

class GovernedImportUnavailableError extends Error{constructor(){super('会员数据持久化导入服务暂时不可用');this.name='GovernedImportUnavailableError';this.code='GOVERNED_IMPORT_UNAVAILABLE';this.statusCode=503}}
function id(value,label='标识'){const text=String(value||'');if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(text))throw new Error(`${label}格式无效`);return text}

class CloudBaseGovernedImportRepository{
  constructor({config,fetchImpl=globalThis.fetch}){if(!config?.enabled||config.mode!=='cloudbase_gateway'||config.runtimeEnvironment!=='production')throw new Error('会员数据导入仓库需要已通过生产预检的 cloudbase_gateway 配置');this.kind='cloudbase_gateway';this.config=config;this.fetchImpl=fetchImpl;this.readTransport=new CloudBaseGatewayTransport({config,fetchImpl})}
  beginBatch(input){return this.callRpc(RPC.begin,{p_batch_id:id(input.batchId,'批次'),p_domain:String(input.domain),p_actor_id:id(input.actorId,'操作者'),p_idempotency_key_hash:String(input.idempotencyKeyHash),p_csv_sha256:String(input.csvSha256),p_total_rows:Number(input.totalRows),p_header_codes:input.headerCodes||[]})}
  stageRows(input){return this.callRpc(RPC.stage,{p_batch_id:id(input.batchId,'批次'),p_rows:input.rows})}
  reviewRow(input){return this.callRpc(RPC.review,{p_row_id:id(input.rowId,'导入行'),p_reviewer_id:id(input.reviewerId,'复核人'),p_decision:String(input.decision),p_matched_user_id:input.matchedUserId?id(input.matchedUserId,'会员'):null,p_reason_codes:input.reasonCodes||[]})}
  rollbackBatch(input){return this.callRpc(RPC.rollback,{p_batch_id:id(input.batchId,'批次'),p_actor_id:id(input.actorId,'操作者'),p_reason_codes:input.reasonCodes||[]})}
  recordDecision(input){return this.callRpc(RPC.decision,{p_decision_id:id(input.decisionId,'会籍判定'),p_user_id:id(input.userId,'会员'),p_actor_id:id(input.actorId,'复核人'),p_final_status:String(input.finalStatus),p_reason_codes:input.reasonCodes||[],p_input_version:String(input.inputVersion),p_manual_approved:Boolean(input.manualApproved)})}
  listReviewQueue({domain,limit=50}={}){const safeLimit=boundedLimit(limit),params=[['select',REVIEW_FIELDS],['order','created_at.asc'],['limit',safeLimit]];if(domain)params.push(['domain',`eq.${String(domain)}`]);return this.readTransport.readView(VIEWS.reviewQueue,params)}
  async getRecomputeInputs(userId){const rows=await this.readTransport.readView(VIEWS.recompute,[['select',RECOMPUTE_FIELDS],['user_id',`eq.${id(userId,'会员')}`],['limit',1]]);return rows[0]||null}
  async callRpc(name,payload){if(!Object.values(RPC).includes(name))throw new Error('会员数据导入 RPC 不在服务端白名单');const url=new URL(`/v1/rdb/rest/rpc/${name}`,this.config.origin),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);try{const response=await this.fetchImpl(url,{method:'POST',redirect:'error',signal:controller.signal,headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${this.config.serverApiKey}`},body:JSON.stringify(payload)});if(!response?.ok)throw new GovernedImportUnavailableError();const text=await response.text();if(Buffer.byteLength(text,'utf8')>65536)throw new GovernedImportUnavailableError();const value=text?JSON.parse(text):null;if(!value||typeof value!=='object'||Array.isArray(value))throw new GovernedImportUnavailableError();return value}catch(error){if(error instanceof GovernedImportUnavailableError)throw error;throw new GovernedImportUnavailableError()}finally{clearTimeout(timer)}}
  safeReadiness(){return {kind:this.kind,persistent:true,serverOnly:true,domains:['crm','payment','directory','membership_decision'],credentialsExposed:false,memoryFallback:false}}
}
function boundedLimit(value){const parsed=Number(value);if(!Number.isInteger(parsed)||parsed<1||parsed>100)throw new Error('复核队列分页上限必须为 1–100 的整数');return parsed}

module.exports={RPC,VIEWS,GovernedImportUnavailableError,CloudBaseGovernedImportRepository};
