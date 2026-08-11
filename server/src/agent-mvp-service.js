'use strict';

const {validateDemandSubmission}=require('./demand-submission-policy');
const {applicationDraft,applicationTransition,directionalCandidate,reviewDemandTransition}=require('./agent-workflow-policy');
const {AgentRepositoryUnavailableError}=require('./persistence/agent-mvp-repository');

const DEMAND_TYPES=new Set(['investment','fundraising','ma','recruitment','business_attraction']);
const REVIEW_DECISIONS=new Set(['needs_more_information','rejected','archived','approved']);
const DISPATCH_DECISIONS=new Set(['shortlisted','declined']);
function bad(message){const error=new Error(message);error.code='AGENT_INPUT_INVALID';error.statusCode=400;return error}

class AgentMvpService{
  constructor({memberIdentityService,adminSessionService,repository}){
    if(typeof memberIdentityService?.resolveAuthorizationRequest!=='function')throw new Error('Agent 服务需要 004 真实会员身份门禁');
    if(typeof adminSessionService?.authorizeAction!=='function')throw new Error('Agent 服务需要 008 正式后台授权边界');
    if(repository?.kind!=='agent_gateway_contract')throw new Error('Agent 服务需要受控网关仓库契约');
    this.memberIdentityService=memberIdentityService;this.adminSessionService=adminSessionService;this.repository=repository;
  }
  async member(request){return this.memberIdentityService.resolveAuthorizationRequest(request)}
  async listOpportunities({request,limit}){const member=await this.member(request);return {items:await this.repository.listPublishedOpportunities({memberId:member.id,limit}),contactDisclosed:false}}
  async submitDemand({request,input}){
    const member=await this.member(request),validated=validateDemandSubmission(input);
    if(!validated.valid)throw bad(validated.errors.join('；'));
    const type=String(input?.type||'').trim();if(!DEMAND_TYPES.has(type))throw bad('需求分类无效');
    const draft={type,reviewElements:validated.data,requestedDistributionMode:validated.data.distributionMode,status:'pending_review',humanReviewStatus:'pending',modelStatus:'not_configured',automaticPublish:false,automaticPush:false,contactDisclosed:false};
    const result=await this.repository.stageDemandForReview({memberId:member.id,draft});
    return {id:result?.id||null,status:'pending_review',humanReviewRequired:true,automaticPublish:false,automaticPush:false,contactDisclosed:false};
  }
  async applyToDemand({request,demandId,input}){
    const member=await this.member(request),application=applicationDraft(input);
    const result=await this.repository.stageApplication({memberId:member.id,demandId,application});
    return {id:result?.id||null,status:'submitted',humanReviewRequired:true,contactDisclosed:false,deliveryMode:'operator_relay_only'};
  }
  async reviewDemand({request,demandId,input,idempotencyKey}){
    const decision=String(input?.decision||'');if(!REVIEW_DECISIONS.has(decision))throw bad('审核决定无效');
    const admin=await this.adminSessionService.authorizeAction({request,permission:'demand.review',idempotencyKey});
    const transition=reviewDemandTransition({currentStatus:String(input?.currentStatus||'pending_review'),decision,distributionMode:String(input?.distributionMode||'private_match'),publicInput:{anonymousTitle:input?.anonymousTitle,anonymousSummary:input?.anonymousSummary,publicTags:input?.publicTags,publicDetails:input?.publicDetails}});
    await this.repository.reviewDemand({adminId:admin.userId,demandId,decision,publicProjection:transition,authorizationId:admin.authorizationId});
    return {decision,status:transition.nextStatus,distributionMode:transition.distributionMode,humanReviewed:true,automaticPublish:false,automaticPush:false,contactDisclosed:false};
  }
  async prepareDirectionalCandidate({request,demandId,targetMemberId,criteria,lastSentAt,idempotencyKey}){
    const admin=await this.adminSessionService.authorizeAction({request,permission:'demand.review',idempotencyKey});
    const candidate=directionalCandidate({demandId,targetMemberId,criteria,lastSentAt});
    await this.repository.upsertDirectionalCandidate({adminId:admin.userId,candidate,authorizationId:admin.authorizationId});
    return {status:candidate.status,matchedDimensionCount:candidate.matchedDimensionCount,suppressedBy14DayWindow:candidate.suppressedBy14DayWindow,nextEligibleAt:candidate.nextEligibleAt,notificationSent:false,contactDisclosed:false};
  }
  async dispatchApplication({request,applicationId,input,idempotencyKey}){
    const decision=String(input?.decision||'');if(!DISPATCH_DECISIONS.has(decision))throw bad('分发决定无效');
    const admin=await this.adminSessionService.authorizeAction({request,permission:'demand.review',idempotencyKey});
    await this.repository.dispatchApplication({adminId:admin.userId,applicationId,decision,safeReasonCode:input?.safeReasonCode,authorizationId:admin.authorizationId});
    return {decision,humanReviewed:true,notificationSent:false,contactDisclosed:false,deliveryMode:'operator_relay_only'};
  }
  async recordOwnerDecision({request,applicationId,decision}){
    const member=await this.member(request),transition=applicationTransition({currentStatus:'shortlisted',decision});
    await this.repository.recordOwnerDecision({memberId:member.id,applicationId,decision});
    return {status:transition.nextStatus,operatorRelayRequired:transition.operatorRelayRequired,contactDisclosed:false,deliveryMode:'operator_relay_only'};
  }
  async recordOperatorRelay({request,applicationId,decision,idempotencyKey}){
    const admin=await this.adminSessionService.authorizeAction({request,permission:'demand.review',idempotencyKey}),transition=applicationTransition({currentStatus:'operator_relay_pending',decision});
    await this.repository.recordOperatorRelay({adminId:admin.userId,applicationId,decision,authorizationId:admin.authorizationId});
    return {status:transition.nextStatus,humanReviewed:true,contactDisclosed:false,deliveryMode:'operator_relay_only'};
  }
  safeReadiness(){return {activated:false,routesMounted:false,rpcCapabilityVerified:false,memberGate:'004_wechat_identity_entitlement',adminReviewBoundary:'008_admin_session_rbac',crmWrites:false,memoryFallback:false,automaticPublish:false,automaticPush:false,contactDisclosure:false}}
}

module.exports={AgentMvpService,DEMAND_TYPES,REVIEW_DECISIONS,DISPATCH_DECISIONS,AgentRepositoryUnavailableError};
