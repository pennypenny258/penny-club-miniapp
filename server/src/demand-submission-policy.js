'use strict';
const {redact}=require('./demand-match-planner');

const DISTRIBUTION_MODES=Object.freeze(['full_public','redacted_public','private_match']);
const MODE_LABELS=Object.freeze({full_public:'完整公开',redacted_public:'脱敏公开',private_match:'仅私密匹配'});
const safe=(value,max)=>redact(String(value||'').trim()).slice(0,max);

function validateDemandSubmission(input={}){
  const who=safe(input.who,180),why=safe(input.why,300),target=safe(input.target,300),distributionMode=String(input.distributionMode||'redacted_public');
  const errors=[];
  if(who.length<2)errors.push('请填写“我是谁”');
  if(why.length<4)errors.push('请填写“为什么找”');
  if(target.length<4)errors.push('请填写“找哪类人或机会”');
  if(!DISTRIBUTION_MODES.includes(distributionMode))errors.push('需求可见方式无效');
  if(`${who}${why}${target}`.length<12)errors.push('三项说明过于简略，请补充必要上下文');
  return {valid:errors.length===0,errors,data:{who,why,target,distributionMode}};
}

function publicDemandProjection(demand={}){
  if(demand.status!=='published'||!['approved','approved_with_notes'].includes(demand.humanReviewStatus))return null;
  if(!['full_public','redacted_public'].includes(demand.distributionMode))return null;
  const title=demand.distributionMode==='redacted_public'?(demand.redactedPublicTitle||demand.anonymousTitle):demand.anonymousTitle,summary=demand.distributionMode==='redacted_public'?(demand.redactedPublicSummary||demand.anonymousSummary):demand.anonymousSummary;
  const base={id:demand.id,type:demand.type,anonymousTitle:safe(title,120),anonymousSummary:safe(summary,500),publicTags:(demand.publicTags||[]).map(x=>safe(x,24)).filter(Boolean).slice(0,10),distributionMode:demand.distributionMode,distributionLabel:MODE_LABELS[demand.distributionMode],status:'published',expiresAt:demand.expiresAt,contactDisclosed:false};
  if(demand.distributionMode==='redacted_public')return base;
  const details=demand.fullPublicDetails||{};
  return {...base,publicDetails:{organization:safe(details.organization,120),role:safe(details.role,80),opportunity:safe(details.opportunity,240)},contactDisclosed:false};
}

function safeAdminDemandSubmission(demand={}){
  const elements=demand.reviewElements||{};
  return {requestedDistributionMode:demand.requestedDistributionMode||demand.distributionMode||'redacted_public',distributionMode:demand.distributionMode||null,reviewElements:{who:safe(elements.who,180),why:safe(elements.why,300),target:safe(elements.target,300)},modelStatus:demand.modelStatus||'not_configured',humanReviewRequired:true,automaticPublish:false,automaticPush:false,contactDisclosed:false};
}

module.exports={DISTRIBUTION_MODES,MODE_LABELS,validateDemandSubmission,publicDemandProjection,safeAdminDemandSubmission};
