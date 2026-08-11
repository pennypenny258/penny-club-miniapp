'use strict';

const AGENT_OPERATIONS=Object.freeze({
  LIST_PUBLISHED:'agent.opportunities.list_published',
  STAGE_DEMAND:'agent.demands.stage_review',
  STAGE_APPLICATION:'agent.applications.stage_review',
  REVIEW_DEMAND:'agent.demands.record_human_review',
  UPSERT_DIRECTIONAL_CANDIDATE:'agent.directional_candidates.upsert',
  DISPATCH_APPLICATION:'agent.applications.record_dispatch',
  RECORD_OWNER_DECISION:'agent.applications.record_owner_decision',
  RECORD_OPERATOR_RELAY:'agent.applications.record_operator_relay'
});
const ALLOWED_OPERATIONS=new Set(Object.values(AGENT_OPERATIONS));

class AgentRepositoryUnavailableError extends Error{
  constructor(){super('需求撮合服务暂时不可用');this.code='AGENT_REPOSITORY_UNAVAILABLE';this.statusCode=503}
}

function cleanId(value,name='记录 ID'){
  const text=String(value||'').trim();
  if(!/^[A-Za-z0-9_-]{6,128}$/.test(text)){const error=new Error(`${name} 格式无效`);error.code='AGENT_INPUT_INVALID';error.statusCode=400;throw error}
  return text;
}
function cleanText(value,max){return String(value||'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max)}
function cleanTags(value){return [...new Set((Array.isArray(value)?value:[]).map(item=>cleanText(item,24)).filter(Boolean))].slice(0,10)}
function safePublishedOpportunity(row={}){
  if(row.status!=='published'||!['approved','approved_with_notes'].includes(row.human_review_status||row.humanReviewStatus))return null;
  const mode=row.distribution_mode||row.distributionMode;
  if(!['full_public','redacted_public'].includes(mode))return null;
  return {id:cleanId(row.id),type:cleanText(row.type,40),anonymousTitle:cleanText(row.anonymous_title||row.anonymousTitle,120),anonymousSummary:cleanText(row.anonymous_summary||row.anonymousSummary,500),publicTags:cleanTags(row.public_tags||row.publicTags),distributionMode:mode,status:'published',expiresAt:row.expires_at||row.expiresAt||null,contactDisclosed:false};
}

class StagedAgentGatewayRepository{
  constructor({adapter}){
    if(!adapter||typeof adapter.execute!=='function')throw new Error('Agent 仓库需要可注入的服务端网关适配器');
    this.kind='agent_gateway_contract';this.adapter=adapter;
  }
  async execute(operation,payload){
    if(!ALLOWED_OPERATIONS.has(operation))throw new Error('Agent 网关操作不在白名单');
    try{return await this.adapter.execute(operation,payload)}catch{throw new AgentRepositoryUnavailableError()}
  }
  async listPublishedOpportunities({memberId,limit=30}){
    const bounded=Number(limit);if(!Number.isInteger(bounded)||bounded<1||bounded>50)throw new Error('列表数量必须为 1–50');
    const rows=await this.execute(AGENT_OPERATIONS.LIST_PUBLISHED,{memberId:cleanId(memberId,'会员 ID'),limit:bounded});
    if(!Array.isArray(rows))throw new AgentRepositoryUnavailableError();
    try{return rows.map(safePublishedOpportunity).filter(Boolean)}catch{throw new AgentRepositoryUnavailableError()}
  }
  stageDemandForReview({memberId,draft}){return this.execute(AGENT_OPERATIONS.STAGE_DEMAND,{memberId:cleanId(memberId,'会员 ID'),draft})}
  stageApplication({memberId,demandId,application}){return this.execute(AGENT_OPERATIONS.STAGE_APPLICATION,{memberId:cleanId(memberId,'会员 ID'),demandId:cleanId(demandId,'需求 ID'),application})}
  reviewDemand({adminId,demandId,decision,publicProjection,authorizationId}){return this.execute(AGENT_OPERATIONS.REVIEW_DEMAND,{adminId:cleanId(adminId,'管理员 ID'),demandId:cleanId(demandId,'需求 ID'),decision,publicProjection,authorizationId:cleanId(authorizationId,'授权 ID')})}
  upsertDirectionalCandidate({adminId,candidate,authorizationId}){return this.execute(AGENT_OPERATIONS.UPSERT_DIRECTIONAL_CANDIDATE,{adminId:cleanId(adminId,'管理员 ID'),candidate,authorizationId:cleanId(authorizationId,'授权 ID')})}
  dispatchApplication({adminId,applicationId,decision,safeReasonCode,authorizationId}){return this.execute(AGENT_OPERATIONS.DISPATCH_APPLICATION,{adminId:cleanId(adminId,'管理员 ID'),applicationId:cleanId(applicationId,'申请 ID'),decision,safeReasonCode:cleanText(safeReasonCode,48),authorizationId:cleanId(authorizationId,'授权 ID')})}
  recordOwnerDecision({memberId,applicationId,decision}){return this.execute(AGENT_OPERATIONS.RECORD_OWNER_DECISION,{memberId:cleanId(memberId,'会员 ID'),applicationId:cleanId(applicationId,'申请 ID'),decision})}
  recordOperatorRelay({adminId,applicationId,decision,authorizationId}){return this.execute(AGENT_OPERATIONS.RECORD_OPERATOR_RELAY,{adminId:cleanId(adminId,'管理员 ID'),applicationId:cleanId(applicationId,'申请 ID'),decision,authorizationId:cleanId(authorizationId,'授权 ID')})}
  safeReadiness(){return {kind:this.kind,activated:false,migrationBaseline:'008_admin_session_rbac',rpcCapability:'agent-mvp-rpc-v1-not_verified',memoryFallback:false,crmWrites:false,automaticPublish:false,automaticPush:false,contactDisclosure:false,operations:[...ALLOWED_OPERATIONS]}}
}

module.exports={AGENT_OPERATIONS,AgentRepositoryUnavailableError,StagedAgentGatewayRepository,safePublishedOpportunity};
