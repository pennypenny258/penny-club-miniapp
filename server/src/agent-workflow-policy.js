'use strict';

const crypto=require('node:crypto');
const {redact}=require('./demand-match-planner');
const {validateConnectionApplication}=require('./member-crm-mvp');

const DISTRIBUTION_MODES=Object.freeze(['full_public','redacted_public','private_match']);
const REVIEW_TRANSITIONS=Object.freeze({
  pending_review:['needs_more_information','rejected','archived','approved'],
  needs_more_information:['pending_review','rejected','archived'],
  published:['archived'],
  private_match_approved:['archived']
});
const APPLICATION_TRANSITIONS=Object.freeze({
  submitted:['shortlisted','declined'],
  shortlisted:['needs_more_information','approved_intro','declined'],
  needs_more_information:['submitted','declined'],
  approved_intro:['operator_relay_pending'],
  operator_relay_pending:['relayed','cancelled']
});
const DIRECTIONAL_DIMENSIONS=Object.freeze(['person','organization','role','matter']);
const DEDUPLICATION_DAYS=14;

function invalid(message){const error=new Error(message);error.code='AGENT_WORKFLOW_INVALID';error.statusCode=400;throw error}
function clean(value,max){return redact(String(value||'').trim()).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max)}
function cleanTags(value){return [...new Set((Array.isArray(value)?value:[]).map(item=>clean(item,24)).filter(Boolean))].slice(0,10)}
function cleanId(value,label='记录 ID'){const text=String(value||'').trim();if(!/^[A-Za-z0-9_-]{6,128}$/.test(text))invalid(`${label} 格式无效`);return text}

function transitionAllowed(map,current,next){return Boolean(map[current]?.includes(next))}
function reviewDemandTransition({currentStatus='pending_review',decision,distributionMode,publicInput={}}={}){
  if(!transitionAllowed(REVIEW_TRANSITIONS,currentStatus,decision))invalid('需求审核状态转换无效');
  if(decision!=='approved')return {nextStatus:decision,humanReviewStatus:decision,distributionMode:null,publicProjection:null,automaticPublish:false,automaticPush:false,contactDisclosed:false};
  if(!DISTRIBUTION_MODES.includes(distributionMode))invalid('需求发布方式无效');
  if(distributionMode==='private_match')return {nextStatus:'private_match_approved',humanReviewStatus:'approved',distributionMode,publicProjection:null,automaticPublish:false,automaticPush:false,contactDisclosed:false};
  const title=clean(publicInput.anonymousTitle,120),summary=clean(publicInput.anonymousSummary,500);
  if(title.length<4||summary.length<8)invalid('人工审核后的公开标题或摘要不完整');
  const base={anonymousTitle:title,anonymousSummary:summary,publicTags:cleanTags(publicInput.publicTags),distributionMode,status:'published',contactDisclosed:false};
  if(distributionMode==='redacted_public')return {nextStatus:'published',humanReviewStatus:'approved',distributionMode,publicProjection:base,automaticPublish:false,automaticPush:false,contactDisclosed:false};
  const details=publicInput.publicDetails||{};
  return {nextStatus:'published',humanReviewStatus:'approved',distributionMode,publicProjection:{...base,publicDetails:{organization:clean(details.organization,120),role:clean(details.role,80),opportunity:clean(details.opportunity,240)}},automaticPublish:false,automaticPush:false,contactDisclosed:false};
}

function applicationDraft(input={}){
  const checked=validateConnectionApplication(input);if(!checked.valid)invalid(checked.errors.join('；'));
  return {statement:{who:clean(checked.data.who,180),why:clean(checked.data.why,300),topic:clean(checked.data.topic,300)},status:'submitted',agentReviewStatus:'pending',ownerDecision:null,contactDisclosed:false,deliveryMode:'operator_relay_only'};
}
function applicationTransition({currentStatus,decision}={}){
  if(!transitionAllowed(APPLICATION_TRANSITIONS,currentStatus,decision))invalid('对接申请状态转换无效');
  const operatorRelayRequired=decision==='approved_intro';
  return {nextStatus:operatorRelayRequired?'operator_relay_pending':decision,ownerDecision:operatorRelayRequired?'approved_intro':null,operatorRelayRequired,automaticContactRelease:false,contactDisclosed:false,deliveryMode:'operator_relay_only'};
}

function directionalCandidate({demandId,targetMemberId,criteria={},lastSentAt=null,now=new Date()}={}){
  const matched=DIRECTIONAL_DIMENSIONS.filter(key=>clean(criteria[key],120));
  if(matched.length<3)invalid('定向候选至少需要人、机构、角色、事项中的三项明确匹配');
  const current=now instanceof Date?now:new Date(now);if(Number.isNaN(current.getTime()))invalid('当前时间无效');
  const previous=lastSentAt?new Date(lastSentAt):null;
  const duplicateUntil=previous&&!Number.isNaN(previous.getTime())?new Date(previous.getTime()+DEDUPLICATION_DAYS*86400000):null;
  const suppressed=Boolean(duplicateUntil&&duplicateUntil>current);
  const demand=cleanId(demandId,'需求 ID'),target=cleanId(targetMemberId,'候选会员 ID');
  const deduplicationKey=crypto.createHash('sha256').update(`agent-directional-v1\0${demand}\0${target}`).digest('hex');
  return {demandId:demand,targetMemberId:target,matchedDimensions:matched,matchedDimensionCount:matched.length,eligible:true,deduplicationKey,suppressedBy14DayWindow:suppressed,nextEligibleAt:suppressed?duplicateUntil.toISOString():null,status:suppressed?'duplicate_suppressed':'awaiting_operator_send',automaticSend:false,contactDisclosed:false};
}

module.exports={DISTRIBUTION_MODES,REVIEW_TRANSITIONS,APPLICATION_TRANSITIONS,DIRECTIONAL_DIMENSIONS,DEDUPLICATION_DAYS,reviewDemandTransition,applicationDraft,applicationTransition,directionalCandidate};
