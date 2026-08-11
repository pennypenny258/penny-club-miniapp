'use strict';

const WECHAT_IDENTITY_CAPABILITIES=Object.freeze({
  loginExchange:Object.freeze(['openid','session_key_server_only','unionid_when_eligible']),
  loginDoesNotProvide:Object.freeze(['wechat_nickname','wechat_id','phone_number','group_nickname','group_membership']),
  phoneMode:'explicit_getPhoneNumber_user_action_then_server_exchange',
  groupMembershipMode:'crm_operator_confirmed_only'
});
const USER_PROVIDED_SOURCES=new Set(['member_self_reported','operator_import']);

function createBindingReviewCandidate(input={}){
  if(!/^[0-9a-f]{64}$/.test(String(input.subjectHash||'')))throw new Error('微信 subject 哈希无效');
  if(input.wechatIdSource&&!USER_PROVIDED_SOURCES.has(input.wechatIdSource))throw new Error('微信号只能来自会员填写或运营导入');
  if(input.groupNicknameSource&&!USER_PROVIDED_SOURCES.has(input.groupNicknameSource))throw new Error('群昵称只能来自会员填写或运营导入');
  if(input.groupStatusSource&&input.groupStatusSource!=='operator_confirmed')throw new Error('群状态只能由运营在 CRM 中确认');
  if(input.phonePresent&&input.phoneAuthorizationVerified!==true)throw new Error('手机号必须由用户主动授权后经服务端验证');
  return {subjectHash:String(input.subjectHash),status:'pending_match_evaluation',openidVerified:true,phoneEvidence:input.phonePresent?'explicit_user_authorization_verified':'not_provided',wechatIdEvidence:input.wechatIdSource||'not_provided',groupNicknameEvidence:input.groupNicknameSource||'not_provided',groupStatusEvidence:input.groupStatusSource||'not_confirmed',automaticMembershipActivation:false,rawProfileReturned:false};
}

function evaluateAutomaticBindingEligibility(input={}){
  const reasons=[];
  if(input.phoneConsentVerified!==true)reasons.push('verified_phone_required');
  if(input.conflictStatus!=='unique_candidate'||!input.selectedMatchId)reasons.push(input.conflictStatus==='no_match'?'no_match':'ambiguous_or_conflicting_match');
  const crm=input.crmAccessProjection||{};
  if(crm.accountActive!==true)reasons.push('account_not_active');
  if(crm.groupStatus!=='in_group')reasons.push('group_not_active');
  if(crm.membershipMonthEffective!==true)reasons.push('membership_month_not_effective');
  if(crm.dataComplete!==true||crm.contradiction===true)reasons.push('crm_missing_or_contradictory');
  if(Array.isArray(crm.riskFlags)&&crm.riskFlags.length)reasons.push('risk_flags_present');
  if(crm.entitlementProjectionReady!==true)reasons.push('entitlement_projection_not_ready');
  return {eligible:reasons.length===0,reasons:[...new Set(reasons)],requiresOperatorReview:reasons.length>0,automaticMembershipActivation:false};
}

function assertOperatorConfirmedBinding(binding={}){
  if(!['auto_confirmed','operator_confirmed'].includes(binding.status)||!binding.memberId||binding.subjectHashVerified!==true){const error=new Error('微信身份尚未通过 CRM 唯一匹配或运营复核');error.code='IDENTITY_NOT_BOUND';error.statusCode=403;throw error}
  return {memberId:String(binding.memberId),operatorConfirmed:binding.status==='operator_confirmed',automaticConfirmed:binding.status==='auto_confirmed'};
}

module.exports={WECHAT_IDENTITY_CAPABILITIES,createBindingReviewCandidate,evaluateAutomaticBindingEligibility,assertOperatorConfirmedBinding};
