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
  return {subjectHash:String(input.subjectHash),status:'pending_operator_confirmation',openidVerified:true,phoneEvidence:input.phonePresent?'explicit_user_authorization_verified':'not_provided',wechatIdEvidence:input.wechatIdSource||'not_provided',groupNicknameEvidence:input.groupNicknameSource||'not_provided',groupStatusEvidence:input.groupStatusSource||'not_confirmed',automaticMemberBinding:false,automaticMembershipActivation:false,rawProfileReturned:false};
}

function assertOperatorConfirmedBinding(binding={}){
  if(binding.status!=='operator_confirmed'||!binding.memberId||binding.subjectHashVerified!==true){const error=new Error('微信身份尚未由运营与 CRM 主档确认绑定');error.code='IDENTITY_NOT_BOUND';error.statusCode=403;throw error}
  return {memberId:String(binding.memberId),operatorConfirmed:true};
}

module.exports={WECHAT_IDENTITY_CAPABILITIES,createBindingReviewCandidate,assertOperatorConfirmedBinding};
