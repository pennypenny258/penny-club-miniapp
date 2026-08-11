'use strict';

const {AGENT_OPERATIONS}=require('./agent-mvp-repository');
const {DISTRIBUTION_MODES}=require('../agent-workflow-policy');
const REQUIRED_BASELINE='008_admin_session_rbac';
const CAPABILITY_VERSION='agent-mvp-rpc-v1';
const RPC_BY_OPERATION=Object.freeze({
  [AGENT_OPERATIONS.LIST_PUBLISHED]:'venture_agent_list_published_opportunities',
  [AGENT_OPERATIONS.STAGE_DEMAND]:'venture_agent_stage_demand_review',
  [AGENT_OPERATIONS.STAGE_APPLICATION]:'venture_agent_stage_application_review',
  [AGENT_OPERATIONS.REVIEW_DEMAND]:'venture_agent_record_demand_review',
  [AGENT_OPERATIONS.UPSERT_DIRECTIONAL_CANDIDATE]:'venture_agent_upsert_directional_candidate',
  [AGENT_OPERATIONS.DISPATCH_APPLICATION]:'venture_agent_record_application_dispatch',
  [AGENT_OPERATIONS.RECORD_OWNER_DECISION]:'venture_agent_record_owner_decision',
  [AGENT_OPERATIONS.RECORD_OPERATOR_RELAY]:'venture_agent_record_operator_relay'
});
const REQUIRED_RPCS=Object.freeze(Object.values(RPC_BY_OPERATION));
const FORBIDDEN_KEYS=new Set(['phone','mobile','wechat','wechat_id','real_name','email','contact','crm','payment','order','remark','secret','credential','api_key','source_row']);

class AgentRpcUnavailableError extends Error{constructor(){super('正式需求撮合持久化能力暂时不可用');this.code='AGENT_RPC_UNAVAILABLE';this.statusCode=503}}
function clean(value,max=300){return String(value||'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max)}
function id(value,label='记录 ID'){const text=clean(value,128);if(!/^[A-Za-z0-9_-]{6,128}$/.test(text))throw new AgentRpcUnavailableError();return text}
function tags(value){return [...new Set((Array.isArray(value)?value:[]).map(x=>clean(x,24)).filter(Boolean))].slice(0,10)}
function assertNoPrivateKeys(value){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(FORBIDDEN_KEYS.has(key.toLowerCase()))throw new AgentRpcUnavailableError();if(item&&typeof item==='object')assertNoPrivateKeys(item)}}
function exactBoolean(value){return value===true}
function oneOf(value,allowed){const text=clean(value,48);if(!allowed.includes(text))throw new AgentRpcUnavailableError();return text}

function verifyAgentRpcCapabilityManifest(manifest={}){
  const rpc=Array.isArray(manifest.rpcs)?manifest.rpcs:[];
  const proofs=manifest.proofs||{};
  return manifest.version===CAPABILITY_VERSION&&manifest.migrationBaseline===REQUIRED_BASELINE&&REQUIRED_RPCS.every(name=>rpc.includes(name))&&rpc.length===REQUIRED_RPCS.length&&exactBoolean(proofs.serviceRoleOnly)&&exactBoolean(proofs.clientRolesDenied)&&exactBoolean(proofs.rlsForced)&&exactBoolean(proofs.idempotentMutations)&&exactBoolean(proofs.humanReviewStateMachine)&&exactBoolean(proofs.publicProjectionAllowlist)&&exactBoolean(proofs.directionalThreeOfFour)&&Number(proofs.directionalDeduplicationDays)===14&&exactBoolean(proofs.operatorRelayOnly)&&exactBoolean(proofs.noContactOrCrmProjection);
}

function resolveCloudBaseAgentRpcConfig(environment=process.env){
  const attempted=environment.CLOUDBASE_AGENT_RPC_ENABLED==='true'||environment.CLOUDBASE_AGENT_RPC_CAPABILITY_VERSION||environment.CLOUDBASE_AGENT_RPC_MANIFEST_SHA256;
  if(attempted)throw new Error('正式 Agent RPC 尚未部署并完成只读能力验收，禁止启用');
  return {enabled:false,runtimeEnabled:false,capabilityVersion:CAPABILITY_VERSION,migrationBaseline:REQUIRED_BASELINE,manifestVerified:false,safeSummary:{status:'offline_preparation_only',enabled:false,routesMounted:false,cloudWrites:false,memoryFallback:false,crmWrites:false,automaticPublish:false,automaticPush:false,contactDisclosure:false,requiredRpcCount:REQUIRED_RPCS.length,blockers:['agent_rpc_not_deployed','readonly_capability_manifest_not_verified','formal_routes_disabled']}};
}

function safePayload(operation,input={}){
  assertNoPrivateKeys(input);
  if(operation===AGENT_OPERATIONS.LIST_PUBLISHED)return {member_id:id(input.memberId,'会员 ID'),limit:Number.isInteger(input.limit)&&input.limit>=1&&input.limit<=50?input.limit:30};
  if(operation===AGENT_OPERATIONS.STAGE_DEMAND){const draft=input.draft||{},elements=draft.reviewElements||{},mode=oneOf(draft.requestedDistributionMode,DISTRIBUTION_MODES),type=oneOf(draft.type,['investment','fundraising','ma','recruitment','business_attraction']),who=clean(elements.who,180),why=clean(elements.why,300),target=clean(elements.target,300);if(who.length<2||why.length<4||target.length<4)throw new AgentRpcUnavailableError();return {member_id:id(input.memberId,'会员 ID'),demand_type:type,review_elements:{who,why,target},requested_distribution_mode:mode,human_review_status:'pending',automatic_publish:false,automatic_push:false}}
  if(operation===AGENT_OPERATIONS.STAGE_APPLICATION){const application=input.application||{},statement=application.statement||{},who=clean(statement.who,180),why=clean(statement.why,300),topic=clean(statement.topic,300);if(who.length<8||why.length<12||topic.length<12)throw new AgentRpcUnavailableError();return {member_id:id(input.memberId,'会员 ID'),demand_id:id(input.demandId,'需求 ID'),statement:{who,why,topic},status:'submitted',contact_disclosed:false,delivery_mode:'operator_relay_only'}}
  if(operation===AGENT_OPERATIONS.REVIEW_DEMAND){const projection=input.publicProjection||{},decision=oneOf(input.decision,['needs_more_information','rejected','archived','approved']),mode=projection.distributionMode===null?null:oneOf(projection.distributionMode,DISTRIBUTION_MODES),publicValue=projection.publicProjection;if((mode==='private_match'||decision!=='approved')&&publicValue)throw new AgentRpcUnavailableError();return {admin_id:id(input.adminId,'管理员 ID'),authorization_id:id(input.authorizationId,'授权 ID'),demand_id:id(input.demandId,'需求 ID'),decision,next_status:oneOf(projection.nextStatus,['needs_more_information','rejected','archived','published','private_match_approved']),distribution_mode:mode,public_projection:publicValue?{anonymous_title:clean(publicValue.anonymousTitle,120),anonymous_summary:clean(publicValue.anonymousSummary,500),public_tags:tags(publicValue.publicTags),distribution_mode:oneOf(publicValue.distributionMode,['full_public','redacted_public']),public_details:publicValue.publicDetails?{organization:clean(publicValue.publicDetails.organization,120),role:clean(publicValue.publicDetails.role,80),opportunity:clean(publicValue.publicDetails.opportunity,240)}:undefined}:null,automatic_publish:false,automatic_push:false,contact_disclosed:false}}
  if(operation===AGENT_OPERATIONS.UPSERT_DIRECTIONAL_CANDIDATE){const candidate=input.candidate||{},dimensions=[...new Set((candidate.matchedDimensions||[]).filter(x=>['person','organization','role','matter'].includes(x)))];if(dimensions.length<3||!/^[a-f0-9]{64}$/.test(candidate.deduplicationKey||''))throw new AgentRpcUnavailableError();const suppressed=candidate.suppressedBy14DayWindow===true,status=oneOf(candidate.status,['awaiting_operator_send','duplicate_suppressed']);if(suppressed!==(status==='duplicate_suppressed'))throw new AgentRpcUnavailableError();return {admin_id:id(input.adminId,'管理员 ID'),authorization_id:id(input.authorizationId,'授权 ID'),demand_id:id(candidate.demandId,'需求 ID'),target_member_id:id(candidate.targetMemberId,'候选会员 ID'),matched_dimensions:dimensions,deduplication_key:candidate.deduplicationKey,suppressed_by_14_day_window:suppressed,status,automatic_send:false,contact_disclosed:false}}
  if(operation===AGENT_OPERATIONS.DISPATCH_APPLICATION)return {admin_id:id(input.adminId,'管理员 ID'),authorization_id:id(input.authorizationId,'授权 ID'),application_id:id(input.applicationId,'申请 ID'),decision:oneOf(input.decision,['shortlisted','declined']),safe_reason_code:clean(input.safeReasonCode,48),notification_sent:false,contact_disclosed:false};
  if(operation===AGENT_OPERATIONS.RECORD_OWNER_DECISION)return {member_id:id(input.memberId,'会员 ID'),application_id:id(input.applicationId,'申请 ID'),decision:oneOf(input.decision,['approved_intro','needs_more_information','declined']),contact_disclosed:false,delivery_mode:'operator_relay_only'};
  if(operation===AGENT_OPERATIONS.RECORD_OPERATOR_RELAY)return {admin_id:id(input.adminId,'管理员 ID'),authorization_id:id(input.authorizationId,'授权 ID'),application_id:id(input.applicationId,'申请 ID'),decision:oneOf(input.decision,['relayed','cancelled']),contact_disclosed:false,delivery_mode:'operator_relay_only'};
  throw new AgentRpcUnavailableError();
}

class PreparedCloudBaseAgentRpcAdapter{
  constructor({config,invoker}){if(config?.runtimeEnabled!==false||typeof invoker?.invoke!=='function')throw new Error('Agent RPC 适配器仅允许离线 mock 验证');this.config=config;this.invoker=invoker}
  async execute(operation,input){const rpc=RPC_BY_OPERATION[operation];if(!rpc)throw new AgentRpcUnavailableError();const payload=safePayload(operation,input);try{const result=await this.invoker.invoke(rpc,{p_request:payload});if(operation===AGENT_OPERATIONS.LIST_PUBLISHED){if(!Array.isArray(result))throw new AgentRpcUnavailableError();return result.map(row=>({id:id(row.id),type:clean(row.type,40),anonymous_title:clean(row.anonymous_title,120),anonymous_summary:clean(row.anonymous_summary,500),public_tags:tags(row.public_tags),distribution_mode:oneOf(row.distribution_mode,['full_public','redacted_public']),human_review_status:oneOf(row.human_review_status,['approved','approved_with_notes']),status:'published',expires_at:row.expires_at||null}))}if(!result||typeof result!=='object'||Array.isArray(result))throw new AgentRpcUnavailableError();return {id:result.id?id(result.id):null,status:clean(result.status,48)||'recorded',idempotent:result.idempotent===true}}catch(error){if(error instanceof AgentRpcUnavailableError)throw error;throw new AgentRpcUnavailableError()}}
  safeReadiness(){return this.config.safeSummary}
}

module.exports={REQUIRED_BASELINE,CAPABILITY_VERSION,RPC_BY_OPERATION,REQUIRED_RPCS,AgentRpcUnavailableError,verifyAgentRpcCapabilityManifest,resolveCloudBaseAgentRpcConfig,safePayload,PreparedCloudBaseAgentRpcAdapter};
