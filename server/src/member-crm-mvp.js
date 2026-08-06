'use strict';

const INSTITUTION_TYPES = Object.freeze(['投资机构','产业方','FA','咨询','家办或母基金','其他']);
const PUBLIC_MODES = Object.freeze(['private','self_selected','full_safe']);
const AGENT_TAG_SOURCES = Object.freeze(['agent','operator']);

function monthValue(value) {
  const text=String(value||'').trim();
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return null;
  return text;
}

function monthsBetween(startMonth,endMonth) {
  const start=monthValue(startMonth),end=monthValue(endMonth);
  if(!start||!end)return 0;
  const [sy,sm]=start.split('-').map(Number),[ey,em]=end.split('-').map(Number);
  return Math.max(0,(ey-sy)*12+em-sm);
}

function membershipDuration(profile,nowMonth=new Date().toISOString().slice(0,7)) {
  const manual=Number.isInteger(profile.accumulatedGroupMonths)&&profile.accumulatedGroupMonths>=0?profile.accumulatedGroupMonths:0;
  const current=profile.groupStatus==='in_group'?monthsBetween(profile.currentGroupEntryMonth||profile.firstGroupEntryMonth,nowMonth):0;
  const total=manual+current;
  return {totalMonths:total,label:`${Math.floor(total/12)} 年 ${total%12} 月`,basis:'manual_history_plus_current_group_interval'};
}

function extendExpiryFromOriginalMonth(expiryMonth,months=12) {
  const normalized=monthValue(expiryMonth);
  if(!normalized)return null;
  const [year,month]=normalized.split('-').map(Number),index=year*12+(month-1)+months;
  return `${Math.floor(index/12)}-${String(index%12+1).padStart(2,'0')}`;
}

function safeText(value,max=200){return String(value||'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max)}
function safeList(value,maxItems=12,maxLength=40){return [...new Set((Array.isArray(value)?value:[]).map(x=>safeText(x,maxLength)).filter(Boolean))].slice(0,maxItems)}

function normalizeCrmProfile(input={},existing={}) {
  const next={...existing};
  for(const key of ['wechatGroupNickname','wechatId','phone','realName','currentCompany','currentTitle','pastExperience','personalIntroduction','needsPreference','resourcesOffered','operatorOwner','internalNotes']){
    if(Object.hasOwn(input,key))next[key]=safeText(input[key],key==='internalNotes'?1000:400);
  }
  if(Object.hasOwn(input,'institutionType'))next.institutionType=INSTITUTION_TYPES.includes(input.institutionType)?input.institutionType:'';
  for(const key of ['focusTracks','residentCities'])if(Object.hasOwn(input,key))next[key]=safeList(input[key]);
  for(const key of ['firstGroupEntryMonth','currentGroupEntryMonth','membershipExpiryMonth','nextFollowUpMonth','latestNoticeMonth','paymentDateMonth']){
    if(Object.hasOwn(input,key))next[key]=monthValue(input[key]);
  }
  if(Object.hasOwn(input,'accumulatedGroupMonths'))next.accumulatedGroupMonths=Math.min(1200,Math.max(0,Number.parseInt(input.accumulatedGroupMonths,10)||0));
  if(Object.hasOwn(input,'renewalPriceCents'))next.renewalPriceCents=Math.max(0,Number.parseInt(input.renewalPriceCents,10)||0);
  if(Object.hasOwn(input,'firstPaymentCents'))next.firstPaymentCents=Math.max(0,Number.parseInt(input.firstPaymentCents,10)||0);
  if(Object.hasOwn(input,'noticeStatus'))next.noticeStatus=['not_notified','follow_up_pending','notified','notified_overdue'].includes(input.noticeStatus)?input.noticeStatus:'not_notified';
  if(Object.hasOwn(input,'paymentClueStatus'))next.paymentClueStatus=['none','candidate','verified','needs_review'].includes(input.paymentClueStatus)?input.paymentClueStatus:'none';
  next.missingCoreFields=['wechatGroupNickname','wechatId','phone','realName'].filter(key=>!safeText(next[key]));
  return next;
}

function safeAdminCrmProfile(profile={}) {
  const duration=membershipDuration(profile);
  return {...profile,membershipDuration:duration,renewalRule:{notificationTiming:'到期月月底统一通知',extensionBasis:'从原到期月顺延 12 个月，不从付款月重新起算',nextExpiryMonth:extendExpiryFromOriginalMonth(profile.membershipExpiryMonth)},cardArtifact:{status:profile.cardArtifactStatus||'not_submitted',visibility:'internal_only',contentReturned:false}};
}

function publicDirectoryProjection(profile={}) {
  if(profile.publicMode==='private'||profile.consentStatus!=='granted'||profile.reviewStatus!=='approved')return null;
  return {publicDisplayName:profile.publicDisplayName||'匿名会员',company:profile.hideCompany?'':safeText(profile.company,120),title:safeText(profile.title,80),institutionType:safeText(profile.institutionType,40),cities:safeList(profile.cities),tracks:safeList(profile.tracks),professionalTags:safeList(profile.professionalTags),introduction:safeText(profile.introduction,400),collaborationPreference:safeText(profile.collaborationPreference,240),anonymousSummary:profile.hideCompany||profile.hideRealName?safeText(profile.anonymousSummary||'已通过平台审核的匿名会员简介',240):'',contactMode:'request_only'};
}

function validateConnectionApplication(input={}) {
  const who=safeText(input.who,180),why=safeText(input.why,300),topic=safeText(input.topic,300);
  const errors=[];
  if(who.length<8)errors.push('请说明“我是谁”（至少 8 字）');
  if(why.length<12)errors.push('请说明“为什么联系对方”（至少 12 字）');
  if(topic.length<12)errors.push('请说明“希望讨论什么”（至少 12 字）');
  const combined=`${who}${why}${topic}`;
  if(/^(想认识|加微信|认识一下|聊聊)[。！!\s]*$/u.test(combined)||combined.length<40)errors.push('申请过于笼统，请补充身份、匹配理由和具体讨论事项');
  return {valid:errors.length===0,errors,data:{who,why,topic}};
}

function directionalMatchEligible(match={}) {
  const dimensions=['person','organization','role','matter'].filter(key=>safeText(match[key])).length;
  return {eligible:dimensions>=3,matchedDimensions:dimensions,requiresHumanSend:true,contactDisclosed:false};
}

module.exports={INSTITUTION_TYPES,PUBLIC_MODES,AGENT_TAG_SOURCES,monthValue,membershipDuration,extendExpiryFromOriginalMonth,normalizeCrmProfile,safeAdminCrmProfile,publicDirectoryProjection,validateConnectionApplication,directionalMatchEligible};
