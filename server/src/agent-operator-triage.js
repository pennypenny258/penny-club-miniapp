'use strict';

const MODE_LABELS=Object.freeze({full_public:'完整公开',redacted_public:'脱敏公开',private_match:'仅私密匹配'});
const safeMode=value=>Object.prototype.hasOwnProperty.call(MODE_LABELS,value)?value:'redacted_public';

// An operator aid only. It deliberately consumes workflow metadata, not raw demand text.
function buildOperatorTriage(input={}){
  const requestedMode=safeMode(input.requestedDistributionMode);
  const status=String(input.status||'human_review'),humanReviewStatus=String(input.humanReviewStatus||'pending');
  const matchedDimensions=Math.max(0,Math.min(4,Number(input.directionalEligibility?.matchedDimensions)||0));
  const directionalEligible=Boolean(input.directionalEligibility?.eligible);
  const needsHumanReview=humanReviewStatus==='pending'||['human_review','pending_review'].includes(status);
  const nextAction=needsHumanReview
    ? (requestedMode==='private_match'?(directionalEligible?'人工确认后建立定向候选':'先补足定向匹配条件，或改为脱敏公开'):'人工核对三要素与敏感信息后，选择公开方式')
    : requestedMode==='private_match'?(directionalEligible?'人工筛选候选并手动发送':'等待补充可匹配的对象条件'):'等待会员提交完整申请，再由运营代转';
  return {requestedMode,requestedModeLabel:MODE_LABELS[requestedMode],recommendation:requestedMode,recommendationLabel:MODE_LABELS[requestedMode],needsHumanReview,fullPublicRequiresExplicitReview:requestedMode==='full_public',directionalEligible,matchedDimensions,nextAction,automaticPublish:false,automaticPush:false,contactDisclosed:false,operatorRelayRequired:true};
}

module.exports={MODE_LABELS,buildOperatorTriage};
