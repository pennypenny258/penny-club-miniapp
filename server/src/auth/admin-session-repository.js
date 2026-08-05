'use strict';

const {CloudBaseGatewayTransport}=require('../persistence/repository');
const VIEWS=Object.freeze({session:'venture_admin_session_access'});
const RPC=Object.freeze({begin:'venture_begin_admin_session',reserve:'venture_reserve_admin_action',revoke:'venture_revoke_admin_session'});
const SESSION_FIELDS='session_id,user_id,status,issued_at,expires_at,authenticated_at,step_up_verified_at,roles,permissions,assignment_version';
class AdminSessionRepositoryUnavailableError extends Error{constructor(){super('后台会话仓库暂时不可用');this.code='ADMIN_SESSION_REPOSITORY_UNAVAILABLE';this.statusCode=503}}
class CloudBaseAdminSessionRepository{
  constructor({config,fetchImpl=globalThis.fetch}){if(!config?.enabled||config.mode!=='cloudbase_gateway'||config.runtimeEnvironment!=='production')throw new Error('后台会话仓库需要生产 CloudBase 网关配置');this.config=config;this.fetchImpl=fetchImpl;this.reader=new CloudBaseGatewayTransport({config,fetchImpl})}
  async resolveSession({sessionHash}){if(!/^[0-9a-f]{64}$/.test(sessionHash))throw new Error('会话哈希格式无效');try{const rows=await this.reader.readView(VIEWS.session,[['select',SESSION_FIELDS],['session_hash',`eq.${sessionHash}`],['limit',1]]);return rows[0]||null}catch{throw new AdminSessionRepositoryUnavailableError()}}
  beginSession(input){return this.call(RPC.begin,{p_subject_hash:hex(input.subjectHash),p_session_hash:hex(input.sessionHash),p_issued_at:input.issuedAt,p_expires_at:input.expiresAt,p_authenticated_at:input.authenticatedAt,p_step_up_verified_at:input.stepUpVerifiedAt})}
  reserveAction(input){return this.call(RPC.reserve,{p_session_id:id(input.sessionId),p_actor_id:id(input.actorId),p_permission:String(input.permission),p_action_key_hash:hex(input.actionKeyHash),p_step_up_required:Boolean(input.stepUpRequired),p_excluded_actor_ids:(input.excludedActorIds||[]).map(id)})}
  revokeSession({sessionId,actorId,reasonCode}){return this.call(RPC.revoke,{p_session_id:id(sessionId),p_actor_id:id(actorId),p_reason_code:String(reasonCode||'security_review')})}
  async call(name,payload){if(!Object.values(RPC).includes(name))throw new Error('后台认证 RPC 不在白名单');const url=new URL(`/v1/rdb/rest/rpc/${name}`,this.config.origin),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);try{const response=await this.fetchImpl(url,{method:'POST',redirect:'error',signal:controller.signal,headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${this.config.serverApiKey}`},body:JSON.stringify(payload)});if(!response?.ok)throw new AdminSessionRepositoryUnavailableError();const text=await response.text();if(Buffer.byteLength(text)>32768)throw new AdminSessionRepositoryUnavailableError();const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new AdminSessionRepositoryUnavailableError();return value}catch(error){if(error instanceof AdminSessionRepositoryUnavailableError)throw error;throw new AdminSessionRepositoryUnavailableError()}finally{clearTimeout(timer)}}
}
function id(value){const text=String(value||'');if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(text))throw new Error('后台标识格式无效');return text}
function hex(value){const text=String(value||'');if(!/^[0-9a-f]{64}$/.test(text))throw new Error('后台哈希格式无效');return text}
module.exports={VIEWS,RPC,CloudBaseAdminSessionRepository,AdminSessionRepositoryUnavailableError};
