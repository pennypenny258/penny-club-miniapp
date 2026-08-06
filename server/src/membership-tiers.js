'use strict';

const MEMBERSHIP_TIERS = Object.freeze([
  Object.freeze({key:'angel_shareholder',label:'天使轮股东',standardPriceCents:20000,qualification:'付款仅生成身份候选，仍需 CRM、付款复核与大群状态确认',paymentCandidateAllowed:true,manualQualificationRequired:false}),
  Object.freeze({key:'a1_shareholder',label:'A1 轮股东',standardPriceCents:66600,qualification:'付款仅生成身份候选，仍需 CRM、付款复核与大群状态确认',paymentCandidateAllowed:true,manualQualificationRequired:false}),
  Object.freeze({key:'a2_shareholder',label:'A2 轮股东',standardPriceCents:79900,qualification:'付款仅生成身份候选，仍需 CRM、付款复核与大群状态确认',paymentCandidateAllowed:true,manualQualificationRequired:false}),
  Object.freeze({key:'honorary_director',label:'荣誉董事',standardPriceCents:49900,qualification:'499 元付款默认生成身份候选；运营也可因受邀、免单或无付款记录手工赋予并记录原因',paymentCandidateAllowed:true,manualQualificationRequired:false})
]);

const TIER_BY_KEY = new Map(MEMBERSHIP_TIERS.map(tier=>[tier.key,tier]));
const TIER_BY_PRICE = new Map(MEMBERSHIP_TIERS.map(tier=>[tier.standardPriceCents,tier]));
const MEMBERSHIP_TIER_REASON_CODES = Object.freeze({payment_amount_candidate:'标准金额候选已核对',payment_499_candidate:'499 元付款候选已核对',invited:'受邀成员',complimentary:'免单成员',no_payment_record:'无付款记录的人工确认',historical_record:'历史档案确认',operator_correction:'运营纠错'});

function getMembershipTier(key){return TIER_BY_KEY.get(String(key||''))||null}
function membershipTierCandidateForPrice(cents){const tier=TIER_BY_PRICE.get(cents)||null;if(!tier)return null;return {tierKey:tier.key,label:tier.label,requiresManualQualification:tier.manualQualificationRequired,candidateStatus:tier.manualQualificationRequired?'honorary_renewal_candidate_pending_confirmation':'tier_candidate_pending_confirmation'}}
function confirmedMembershipTier(member){const tier=getMembershipTier(member?.membershipTier);if(!tier)return null;if(tier.key==='honorary_director'&&(member.honoraryDirectorStatus!=='confirmed'||!MEMBERSHIP_TIER_REASON_CODES[member.membershipTierReasonCode||member.honoraryDirectorReasonCode]))return null;return tier}
function safeMembershipTierRules(){return MEMBERSHIP_TIERS.map(({key,label,standardPriceCents,qualification,paymentCandidateAllowed,manualQualificationRequired})=>({key,label,standardPriceCents,qualification,paymentCandidateAllowed,manualQualificationRequired}))}

module.exports={MEMBERSHIP_TIERS,MEMBERSHIP_TIER_REASON_CODES,getMembershipTier,membershipTierCandidateForPrice,confirmedMembershipTier,safeMembershipTierRules};
