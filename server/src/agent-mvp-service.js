'use strict';

const {validateDemandSubmission}=require('./demand-submission-policy');
const {validateConnectionApplication}=require('./member-crm-mvp');
const {AgentRepositoryUnavailableError}=require('./persistence/agent-mvp-repository');

const DEMAND_TYPES=new Set(['investment','financing','ma','recruiting','招商']);
const REVIEW_DECISIONS=new Set(['needs_more_information','rejected','archived','approved']);
const DISPATCH_DECISIONS=new Set(['shortlisted','declined']);
function safe(value,max){return String(value||'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max)}
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
    const member=await this.member(request),validated=validateConnectionApplication(input);
    if(!validated.valid)throw bad(validated.errors.join('；'));
    const result=await this.repository.stageApplication({memberId:member.id,demandId,application:{...validated.data,status:'submitted',agentReviewStatus:'pending',ownerDecision:null,contactDisclosed:false}});
    return {id:result?.id||null,status:'submitted',humanReviewRequired:true,contactDisclosed:false,deliveryMode:'operator_relay_only'};
  }
  async reviewDemand({request,demandId,input,idempotencyKey}){
    const decision=String(input?.decision||'');if(!REVIEW_DECISIONS.has(decision))throw bad('审核决定无效');
    const admin=await this.adminSessionService.authorizeAction({request,permission:'demand.review',idempotencyKey});
    const mode=String(input?.distributionMode||'private_match');
    if(decision==='approved'&&!['full_public','redacted_public','private_match'].includes(mode))throw bad('发布方式无效');
    const projection=decision==='approved'?{distributionMode:mode,anonymousTitle:safe(input?.anonymousTitle,120),anonymousSummary:safe(input?.anonymousSummary,500),publicTags:[...new Set((input?.publicTags||[]).map(value=>safe(value,24)).filter(Boolean))].slice(0,10),contactDisclosed:false}:null;
    await this.repository.reviewDemand({adminId:admin.userId,demandId,decision,publicProjection:projection,authorizationId:admin.authorizationId});
    return {decision,humanReviewed:true,automaticPush:false,contactDisclosed:false};
  }
  async dispatchApplication({request,applicationId,input,idempotencyKey}){
    const decision=String(input?.decision||'');if(!DISPATCH_DECISIONS.has(decision))throw bad('分发决定无效');
    const admin=await this.adminSessionService.authorizeAction({request,permission:'demand.review',idempotencyKey});
    await this.repository.dispatchApplication({adminId:admin.userId,applicationId,decision,safeReasonCode:input?.safeReasonCode,authorizationId:admin.authorizationId});
    return {decision,humanReviewed:true,notificationSent:false,contactDisclosed:false,deliveryMode:'operator_relay_only'};
  }
  safeReadiness(){return {activated:false,routesMounted:false,memberGate:'004_wechat_identity_entitlement',adminReviewBoundary:'008_admin_session_rbac',crmWrites:false,memoryFallback:false}}
}

module.exports={AgentMvpService,DEMAND_TYPES,REVIEW_DECISIONS,DISPATCH_DECISIONS,AgentRepositoryUnavailableError};
