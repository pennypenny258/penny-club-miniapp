'use strict';

const {hashWechatSubject}=require('./wechat-config');
const {createBindingReviewCandidate,evaluateAutomaticBindingEligibility}=require('./member-binding-policy');

const CONFIRM_REASON_CODES=new Set(['crm_unique_match','phone_match_confirmed','wechat_id_match_confirmed','manual_evidence_review']);
const REJECT_REASON_CODES=new Set(['no_safe_match','identity_conflict','member_cancelled','evidence_insufficient']);
function token(value,name){const text=String(value||'');if(!/^[0-9a-f]{64}$/.test(text))throw new Error(`${name} 必须返回不可逆服务端匹配令牌`);return text}
function bindingInput(value,max){return String(value||'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max)}
function bad(message){const error=new Error(message);error.code='MEMBER_BINDING_INPUT_INVALID';error.statusCode=400;return error}
function unavailable(){const error=new Error('会员身份匹配服务暂时不可用');error.code='MEMBER_BINDING_UNAVAILABLE';error.statusCode=503;return error}

class FormalFirstBindingService{
  constructor({identityConfig,exchangeClient,phoneGrantVerifier,matchTokenizer,adminSessionService,repository}){
    if(!identityConfig?.enabled||identityConfig.bindingMode!=='crm_exact_match_or_operator_review')throw new Error('首次绑定要求 crm_exact_match_or_operator_review 身份配置');
    if(typeof exchangeClient?.exchange!=='function'||typeof phoneGrantVerifier?.verify!=='function'||typeof matchTokenizer?.tokenize!=='function')throw new Error('首次绑定需要微信交换、手机号授权验证和服务端匹配令牌器');
    if(typeof adminSessionService?.authorizeAction!=='function'||repository?.kind!=='member_binding_gateway_contract')throw new Error('首次绑定需要 008 后台授权与受控绑定仓库');
    this.identityConfig=identityConfig;this.exchangeClient=exchangeClient;this.phoneGrantVerifier=phoneGrantVerifier;this.matchTokenizer=matchTokenizer;this.adminSessionService=adminSessionService;this.repository=repository;
  }
  async start({code,phoneGrantCode,wechatId,groupNickname}={}){
    const exchanged=await this.exchangeClient.exchange(code),{appScopeHash,subjectHash}=hashWechatSubject({config:this.identityConfig,...exchanged}),matchTokens={},evidence=[];
    evidence.push('openid_verified');
    if(phoneGrantCode){let verified;try{verified=await this.phoneGrantVerifier.verify(phoneGrantCode)}catch{throw unavailable()}if(!verified?.verified||typeof verified.phoneNumber!=='string')throw bad('手机号授权未通过服务端验证');try{matchTokens.phone=token(await this.matchTokenizer.tokenize('phone',verified.phoneNumber),'手机号')}catch{throw unavailable()}evidence.push('phone_user_consent')}
    const safeWechatId=bindingInput(wechatId,80);if(safeWechatId){try{matchTokens.wechatId=token(await this.matchTokenizer.tokenize('wechat_id',safeWechatId),'微信号')}catch{throw unavailable()}evidence.push('wechat_id_user_provided')}
    const safeGroupNickname=bindingInput(groupNickname,80);if(safeGroupNickname){try{matchTokens.groupNickname=token(await this.matchTokenizer.tokenize('group_nickname',safeGroupNickname),'群昵称')}catch{throw unavailable()}evidence.push('group_nickname_user_provided')}
    const candidate=createBindingReviewCandidate({subjectHash,phonePresent:Boolean(phoneGrantCode),phoneAuthorizationVerified:Boolean(phoneGrantCode),wechatIdSource:safeWechatId?'member_self_reported':undefined,groupNicknameSource:safeGroupNickname?'member_self_reported':undefined});
    const result=await this.repository.stageCandidate({appScopeHash,subjectHash,matchTokens,evidence:{evidenceTypes:evidence,phoneEvidence:candidate.phoneEvidence,wechatIdEvidence:candidate.wechatIdEvidence,groupNicknameEvidence:candidate.groupNicknameEvidence,automaticMembershipActivation:false}});
    const eligibility=evaluateAutomaticBindingEligibility({phoneConsentVerified:evidence.includes('phone_user_consent'),conflictStatus:result?.conflictStatus,selectedMatchId:result?.selectedMatchId,crmAccessProjection:result?.crmAccessProjection});
    if(!eligibility.eligible)return {id:result?.id||null,status:'operator_review_required',reviewReasons:eligibility.reasons,evidenceTypes:evidence,candidateCount:Number.isInteger(result?.candidateCount)?result.candidateCount:0,automaticMemberBinding:false,automaticMembershipActivation:false,sessionIssued:false,rawValuesReturned:false};
    const bound=await this.repository.confirmAndReevaluate({candidateId:result.id,selectedMatchId:result.selectedMatchId,actorId:'system_binding_policy',reasonCode:'crm_exact_match_auto',authorizationId:null,confirmationMode:'automatic_exact_match'});
    if(bound?.bindingStatus!=='auto_confirmed'||bound?.entitlementReevaluated!==true)throw unavailable();
    return {id:result.id,status:bound.entitlementActive===true?'bound_active':'bound_access_pending_review',reviewReasons:bound.entitlementActive===true?[]:['entitlement_recheck_failed'],evidenceTypes:evidence,candidateCount:1,automaticMemberBinding:true,automaticMembershipActivation:false,entitlementReevaluated:true,accessUnlocked:bound.entitlementActive===true,sessionIssued:false,nextStep:'member_login_again',rawValuesReturned:false};
  }
  async listPending({request,limit,idempotencyKey}){await this.adminSessionService.authorizeAction({request,permission:'member_import.review',idempotencyKey});return {items:await this.repository.listPending({limit}),rawValuesReturned:false}}
  async confirm({request,candidateId,selectedMatchId,reasonCode,idempotencyKey}){
    if(!CONFIRM_REASON_CODES.has(reasonCode))throw bad('身份绑定确认原因无效');
    const admin=await this.adminSessionService.authorizeAction({request,permission:'membership.recompute',idempotencyKey});
    const result=await this.repository.confirmAndReevaluate({candidateId,selectedMatchId,actorId:admin.userId,reasonCode,authorizationId:admin.authorizationId,confirmationMode:'operator_review'});
    if(result?.bindingStatus!=='operator_confirmed'||result?.entitlementReevaluated!==true)throw new Error('绑定写入或会籍重算未完成');
    return {candidateId,bindingStatus:'operator_confirmed',entitlementReevaluated:true,entitlementActive:result.entitlementActive===true,automaticMembershipActivation:false,sessionIssued:false,nextStep:'member_login_again',crmChanged:false,rawValuesReturned:false};
  }
  async reject({request,candidateId,reasonCode,idempotencyKey}){
    if(!REJECT_REASON_CODES.has(reasonCode))throw bad('身份绑定拒绝原因无效');
    const admin=await this.adminSessionService.authorizeAction({request,permission:'member_import.review',idempotencyKey});
    await this.repository.rejectCandidate({candidateId,operatorId:admin.userId,reasonCode,authorizationId:admin.authorizationId});
    return {candidateId,status:'rejected',bindingCreated:false,membershipChanged:false,rawValuesReturned:false};
  }
  safeReadiness(){return {activated:false,routesMounted:false,bindingMode:'crm_exact_match_or_operator_review',automaticBinding:'verified_phone_unique_crm_active_in_group_effective_no_risk',migrationBaseline:'008_admin_session_rbac',phoneRequiresExplicitUserConsent:true,groupStatusSource:'crm_operator_only',crmWrites:false,memoryFallback:false}}
}

module.exports={FormalFirstBindingService,CONFIRM_REASON_CODES,REJECT_REASON_CODES};
