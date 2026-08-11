'use strict';

const crypto=require('node:crypto');
const {MEMBER_BINDING_OPERATIONS}=require('./member-binding-repository');

const REQUIRED_BASELINE='008_admin_session_rbac';
const TRANSPORT_KIND='mockable_member_binding_transport';
const RISK_FLAGS=new Set(['identity_conflict','duplicate_phone_token','existing_binding_conflict','crm_data_incomplete','manual_hold']);
const EVIDENCE_TYPES=new Set(['openid_verified','phone_user_consent','wechat_id_user_provided','group_nickname_user_provided']);
const BIND_REASONS=new Set(['crm_exact_match_auto','crm_unique_match','phone_match_confirmed','wechat_id_match_confirmed','manual_evidence_review']);
const REJECT_REASONS=new Set(['no_safe_match','identity_conflict','member_cancelled','evidence_insufficient']);
class MemberBindingGatewayContractError extends Error{constructor(){super('会员身份绑定网关暂时不可用');this.code='MEMBER_BINDING_GATEWAY_UNAVAILABLE';this.statusCode=503}}
function id(value,name='标识'){const text=String(value||'');if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/.test(text))throw new MemberBindingGatewayContractError();return text}
function hex(value){const text=String(value||'');if(!/^[0-9a-f]{64}$/.test(text))throw new MemberBindingGatewayContractError();return text}
function bool(value){return value===true}
function idempotency(parts){return crypto.createHash('sha256').update(parts.map(String).join('\0')).digest('hex')}
function safeEvidence(value={}){return {evidenceTypes:Array.isArray(value.evidenceTypes)?[...new Set(value.evidenceTypes.map(String).filter(item=>EVIDENCE_TYPES.has(item)))]:[],phoneEvidence:['explicit_user_authorization_verified','not_provided'].includes(value.phoneEvidence)?value.phoneEvidence:'not_provided',wechatIdEvidence:['member_self_reported','operator_import','not_provided'].includes(value.wechatIdEvidence)?value.wechatIdEvidence:'not_provided',groupNicknameEvidence:['member_self_reported','operator_import','not_provided'].includes(value.groupNicknameEvidence)?value.groupNicknameEvidence:'not_provided',automaticMembershipActivation:false}}
function safeProjection(value={}){return {accountActive:bool(value.accountActive),groupStatus:value.groupStatus==='in_group'?'in_group':['left_group','removed','unknown'].includes(value.groupStatus)?value.groupStatus:'unknown',membershipMonthEffective:bool(value.membershipMonthEffective),dataComplete:bool(value.dataComplete),contradiction:bool(value.contradiction),riskFlags:Array.isArray(value.riskFlags)?[...new Set(value.riskFlags.map(String).filter(flag=>RISK_FLAGS.has(flag)))].slice(0,10):[],entitlementProjectionReady:bool(value.entitlementProjectionReady)}}
function safeMatch(value={}){const candidateCount=Number(value.candidateCount);if(!Number.isInteger(candidateCount)||candidateCount<0||candidateCount>20)throw new MemberBindingGatewayContractError();const conflictStatus=['no_match','unique_candidate','multiple_candidates','conflict'].includes(value.conflictStatus)?value.conflictStatus:'conflict';const selectedMatchId=conflictStatus==='unique_candidate'&&candidateCount===1?id(value.selectedMatchId,'匹配候选'):null;return {candidateCount,conflictStatus,selectedMatchId,crmAccessProjection:safeProjection(value.crmAccessProjection),rawValuesReturned:false}}
function activeEntitlement(row,subjectHash,memberId){if(!row||row.subject_hash!==subjectHash||String(row.member_id)!==memberId)throw new MemberBindingGatewayContractError();return row.account_active===true&&row.crm_verified===true&&row.payment_verified===true&&row.group_active===true&&row.decision_active===true}

class OfflineMemberBindingGatewayAdapter{
  constructor({migrationBaseline,transport,entitlementRepository}){
    if(migrationBaseline!==REQUIRED_BASELINE)throw new Error(`会员绑定 adapter 只允许 ${REQUIRED_BASELINE} 基线`);
    const methods=['resolveExactCrmMatch','persistCandidate','listPending','bindIdentityIdempotently','rejectCandidate'];
    if(transport?.kind!==TRANSPORT_KIND||methods.some(method=>typeof transport[method]!=='function'))throw new Error('会员绑定 adapter 需要完整可 mock transport 合约');
    if(entitlementRepository?.kind!=='cloudbase_gateway'||typeof entitlementRepository.resolveMemberEntitlement!=='function')throw new Error('会员绑定 adapter 需要 004 最小 entitlement 只读仓库');
    this.kind='offline_member_binding_gateway_adapter';this.transport=transport;this.entitlementRepository=entitlementRepository;
  }
  async execute(operation,payload={}){
    try{
      if(operation===MEMBER_BINDING_OPERATIONS.STAGE_CANDIDATE)return await this.stage(payload);
      if(operation===MEMBER_BINDING_OPERATIONS.LIST_PENDING)return await this.transport.listPending({limit:payload.limit});
      if(operation===MEMBER_BINDING_OPERATIONS.CONFIRM_AND_REEVALUATE)return await this.bind(payload);
      if(operation===MEMBER_BINDING_OPERATIONS.REJECT_CANDIDATE)return await this.reject(payload);
      throw new Error('会员绑定操作不在固定白名单');
    }catch(error){if(error?.message==='会员绑定操作不在固定白名单')throw error;if(error instanceof MemberBindingGatewayContractError)throw error;throw new MemberBindingGatewayContractError()}
  }
  async stage(payload){
    const appScopeHash=hex(payload.appScopeHash),subjectHash=hex(payload.subjectHash),matchTokens={};for(const [key,value] of Object.entries(payload.matchTokens||{})){if(!['phone','wechatId','groupNickname'].includes(key))continue;matchTokens[key]=hex(value)}
    const match=safeMatch(await this.transport.resolveExactCrmMatch({appScopeHash,subjectHash,matchTokens,readScope:'crm_access_projection_only'}));
    const stored=await this.transport.persistCandidate({appScopeHash,subjectHash,matchTokens,evidence:safeEvidence(payload.evidence),match,status:'operator_review_required_unless_exact_policy_passes',writeScope:'binding_candidate_only'});
    if(stored?.persisted!==true)throw new MemberBindingGatewayContractError();
    return {id:id(stored.id,'绑定候选'),...match,persisted:true,storageMode:'durable_contract',rawValuesReturned:false};
  }
  async bind(payload){
    const candidateId=id(payload.candidateId,'绑定候选'),selectedMatchId=id(payload.selectedMatchId,'匹配候选'),actorId=id(payload.actorId,'操作方');
    const confirmationMode=String(payload.confirmationMode),reasonCode=String(payload.reasonCode);if(!['automatic_exact_match','operator_review'].includes(confirmationMode)||!BIND_REASONS.has(reasonCode))throw new MemberBindingGatewayContractError();const authorizationId=confirmationMode==='operator_review'?id(payload.authorizationId,'授权'):null;
    const key=idempotency(['member_binding_v1',candidateId,selectedMatchId,confirmationMode,authorizationId||'automatic']);
    const written=await this.transport.bindIdentityIdempotently({candidateId,selectedMatchId,actorId,reasonCode,authorizationId,confirmationMode,idempotencyKey:key,writeScope:'external_identity_binding_only'});
    if(!['created','reused'].includes(written?.idempotencyStatus))throw new MemberBindingGatewayContractError();
    const subjectHash=hex(written.subjectHash),memberId=id(written.memberId,'会员');
    const entitlement=await this.entitlementRepository.resolveMemberEntitlement({subjectHash});
    return {bindingStatus:confirmationMode==='automatic_exact_match'?'auto_confirmed':'operator_confirmed',idempotencyStatus:written.idempotencyStatus,entitlementReevaluated:true,entitlementActive:activeEntitlement(entitlement,subjectHash,memberId),rawValuesReturned:false};
  }
  async reject(payload){const candidateId=id(payload.candidateId,'绑定候选'),operatorId=id(payload.operatorId,'操作方'),authorizationId=id(payload.authorizationId,'授权'),reasonCode=String(payload.reasonCode);if(!REJECT_REASONS.has(reasonCode))throw new MemberBindingGatewayContractError();const key=idempotency(['member_binding_reject_v1',candidateId,authorizationId]);const result=await this.transport.rejectCandidate({candidateId,operatorId,reasonCode,authorizationId,idempotencyKey:key});if(!['created','reused'].includes(result?.idempotencyStatus))throw new MemberBindingGatewayContractError();return {status:'rejected',idempotencyStatus:result.idempotencyStatus,rawValuesReturned:false}}
  safeReadiness(){return {kind:this.kind,contractValidated:true,runtimeEnabled:false,migrationBaseline:{entitlement:'004_wechat_identity_entitlement',adminAuthorization:REQUIRED_BASELINE},exactCrmMatchProjection:true,candidatePersistence:true,idempotentIdentityBinding:true,entitlementReevaluation:true,crmWrites:false,memoryFallback:false,routesEnabled:false}}
}

module.exports={REQUIRED_BASELINE,TRANSPORT_KIND,MemberBindingGatewayContractError,OfflineMemberBindingGatewayAdapter,safeEvidence,safeProjection,safeMatch};
