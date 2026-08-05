'use strict';

// All records in this file are synthetic product-demo fixtures. They must never
// be enriched with, matched to, or replaced by production personal data.
const now = Date.now();
const days = n => new Date(now + n * 86400000).toISOString();

const users = {
  active: { id:'u-active', nickname:'演示会员·青岚', userStatus:'active', status:'active', startsAt:days(-40), endsAt:days(325), groupStatus:'in_group', crmVerificationStatus:'verified', latestPaymentEvidenceStatus:'verified', latestValidPaymentAt:days(-40),matchStatus:'matched',renewalNoticeStatus:'not_notified',groupLabel:'年费会员',groupLabelExpiry:days(325) },
  peer: { id:'u-peer', nickname:'演示会员·远汀', userStatus:'active', status:'active', startsAt:days(-150), endsAt:days(215), groupStatus:'in_group', crmVerificationStatus:'verified', latestPaymentEvidenceStatus:'verified', latestValidPaymentAt:days(-150),matchStatus:'matched',renewalNoticeStatus:'not_notified',groupLabel:'续费已确认',groupLabelExpiry:days(215) },
  near_expiry: { id:'u-near-expiry', nickname:'演示会员·星野', userStatus:'active', status:'active', startsAt:days(-350), endsAt:days(15), groupStatus:'in_group', crmVerificationStatus:'verified', latestPaymentEvidenceStatus:'verified', latestValidPaymentAt:days(-350),matchStatus:'matched',renewalNoticeStatus:'not_notified',groupLabel:'本月到期',groupLabelExpiry:days(15) },
  active_private: { id:'u-active-private', nickname:'演示会员·白榆', userStatus:'active', status:'active', startsAt:days(-90), endsAt:days(275), groupStatus:'in_group', crmVerificationStatus:'verified', latestPaymentEvidenceStatus:'verified', latestValidPaymentAt:days(-90) },
  expired: { id:'u-expired', nickname:'演示会员·旧页', userStatus:'active', status:'expired', startsAt:days(-520), endsAt:days(-155), groupStatus:'left', crmVerificationStatus:'verified', latestPaymentEvidenceStatus:'verified', latestValidPaymentAt:days(-520) },
  guest: { id:'u-guest', nickname:'演示用户·待核验', userStatus:'active', status:'pending_verification', startsAt:days(-2), endsAt:days(2), groupStatus:'unknown', crmVerificationStatus:'needs_review', latestPaymentEvidenceStatus:'unverified' },
  frozen: { id:'u-frozen', nickname:'演示会员·冻结', userStatus:'suspended', status:'suspended', startsAt:days(-100), endsAt:days(265), groupStatus:'removed', crmVerificationStatus:'suspended', latestPaymentEvidenceStatus:'verified', latestValidPaymentAt:days(-100) },
  refund_review: { id:'u-refund-review', nickname:'演示会员·退款复核', userStatus:'active', status:'pending_verification', startsAt:days(-20), endsAt:days(345), groupStatus:'in_group', crmVerificationStatus:'needs_review', latestPaymentEvidenceStatus:'needs_review', latestValidPaymentAt:days(-20),matchStatus:'conflict',renewalNoticeStatus:'not_notified',groupLabel:'待核对',groupLabelExpiry:null },
  renewal_followup: { id:'u-renewal-followup', nickname:'演示会员·南枝', userStatus:'active', status:'expired', startsAt:days(-390), endsAt:days(-25), groupStatus:'in_group', crmVerificationStatus:'verified', latestPaymentEvidenceStatus:'needs_review', latestValidPaymentAt:days(-390),matchStatus:'matched',renewalNoticeStatus:'not_notified',groupLabel:'已到期',groupLabelExpiry:days(-25) }
};

const crmVerifications = Object.values(users).map((user, index) => ({
  id:`crm-demo-${index + 1}`, userId:user.id, verificationStatus:user.crmVerificationStatus,
  membershipEnd:user.endsAt, groupStatus:user.groupStatus,
  employmentVerificationStatus:index === 0 ? 'pending_review' : index === 1 ? 'verified' : index === 2 ? 'returned_for_revision' : 'not_submitted',
  evidenceSummary:index === 7 ? '付款退款状态待人工复核' : '演示核验摘要（无身份或联系方式）',
  publicDirectorySyncAllowed:false
}));

const profile = (id, userId, displayName, organization, title, city, industry, interests, stage, expertise, bio, preferences, extra={}) => ({
  id,userId,displayName,organization,title,city,industry,interests,stage,expertise,bio,
  collaborationPreferences:preferences,visibility:'visible',consentStatus:'granted',reviewStatus:'approved',
  contactMode:'request_only',privateContactRef:null,...extra
});
const directoryProfiles = [
  profile('dir-demo-1','u-peer','远汀（演示）','折光产业研究社（虚构）','产业研究负责人','示例城·东岸',['先进制造','机器人'],['产业协同','研究交流'],['成长期'],['产业研究','商业分析'],'关注制造业升级与产业协同的公开演示简介。',['联合研究','行业交流']),
  profile('dir-demo-2','u-near-expiry','星野（演示）','云尺创新观察室（虚构）','早期项目观察员','示例城·南港',['企业服务','人工智能'],['产品验证','早期投资'],['种子期','天使轮'],['产品策略','市场洞察'],'希望交流早期产品验证方法，仅用于产品演示。',['主题分享','项目交流']),
  profile('dir-demo-3','u-active-private','白榆（演示）','澄湾产业协作组（虚构）','生态合作经理','示例城·西岭',['新能源','产业互联网'],['城市活动','产业连接'],['成长期','成熟期'],['生态合作','活动策划'],'关注跨区域产业协作，所有联系均通过平台申请。',['城市沙龙','资源协作'],{visibility:'hidden'}),
  profile('dir-demo-4','u-active','青岚（演示）','微澜价值实验室（虚构）','投研顾问','示例城·北屿',['医疗科技','数据工具'],['投研工具','知识共建'],['A轮','B轮'],['行业研究','知识管理'],'以公开资料共建和研究方法交流为主。',['报告共创','工具测评'],{reviewStatus:'pending'})
];

const publicProfileUpdates = [
  { id:'ppu-demo-submitted',userId:'u-active',status:'submitted',submittedAt:days(-1),proposedProfile:{public_display_name:'青岚（演示）',organization:'微澜价值实验室（虚构）',title:'投研顾问',city:'示例城·北屿',industry_tracks:['医疗科技','数据工具'],interests:['知识共建'],investment_stages:['A轮'],expertise:['行业研究'],bio:'申请更新的公开演示简介，等待运营审核。',collaboration_preferences:['报告共创'],visibility:'visible'} },
  { id:'ppu-demo-pending',userId:'u-near-expiry',status:'pending_review',submittedAt:days(-3),reviewedAt:days(-2),proposedProfile:{public_display_name:'星野（演示）',organization:'云尺创新观察室（虚构）',title:'项目观察员',city:'示例城·南港',industry_tracks:['企业服务'],interests:['产品验证'],investment_stages:['天使轮'],expertise:['市场洞察'],bio:'正在人工复核的公开资料演示。',collaboration_preferences:['项目交流'],visibility:'visible'} },
  { id:'ppu-demo-returned',userId:'u-peer',status:'returned_for_revision',submittedAt:days(-12),reviewedAt:days(-10),returnReasonCode:'content_incomplete',proposedProfile:{public_display_name:'远汀（演示）',organization:'折光产业研究社（虚构）',title:'产业研究负责人',city:'示例城·东岸',industry_tracks:['先进制造'],interests:['产业协同'],investment_stages:['成长期'],expertise:['产业研究'],bio:'需要补充合作偏好的演示资料。',collaboration_preferences:[],visibility:'visible'} },
  { id:'ppu-demo-published',userId:'u-peer',status:'published',submittedAt:days(-35),reviewedAt:days(-32),publishedProfileId:'dir-demo-1',proposedProfile:{public_display_name:'远汀（演示）',organization:'折光产业研究社（虚构）',title:'产业研究负责人',city:'示例城·东岸',industry_tracks:['先进制造','机器人'],interests:['产业协同'],investment_stages:['成长期'],expertise:['产业研究'],bio:'已审核发布的公开演示资料。',collaboration_preferences:['联合研究'],visibility:'visible'} }
];

// Artifact content, filename, object key and note body are intentionally absent.
const employmentVerifications = [
  { id:'ev-demo-submitted',userId:'u-active',status:'submitted',mimeType:'image/png',sizeBytes:420000,notePresent:true,artifactStored:false,storageMode:'demo_metadata_only',submittedAt:days(-1) },
  { id:'ev-demo-pending',userId:'u-near-expiry',status:'pending_review',mimeType:'application/pdf',sizeBytes:780000,notePresent:false,artifactStored:false,storageMode:'demo_metadata_only',submittedAt:days(-4),reviewedAt:days(-3) },
  { id:'ev-demo-verified',userId:'u-peer',status:'verified',mimeType:'image/jpeg',sizeBytes:360000,notePresent:false,artifactStored:false,storageMode:'demo_metadata_only',submittedAt:days(-30),reviewedAt:days(-28) },
  { id:'ev-demo-returned',userId:'u-active-private',status:'returned_for_revision',returnReasonCode:'needs_new_artifact',mimeType:'image/png',sizeBytes:510000,notePresent:false,artifactStored:false,storageMode:'demo_metadata_only',submittedAt:days(-16),reviewedAt:days(-15) }
];

const paymentEvidence = [
  {id:'pay-demo-1',userId:'u-active',source:'manual_transfer',evidenceStatus:'verified',occurredAt:days(-40),amountBand:'standard',refundStatus:'none',productRuleStatus:'matched',importBatchId:'batch-payment-reviewed'},
  {id:'pay-demo-2',userId:'u-peer',source:'wechat_merchant_receipt',evidenceStatus:'verified',occurredAt:days(-150),amountBand:'standard',refundStatus:'none',productRuleStatus:'matched',importBatchId:'batch-manual-entry'},
  {id:'pay-demo-3',userId:'u-near-expiry',source:'wechat_shop_order',evidenceStatus:'verified',occurredAt:days(-350),amountBand:'legacy_offer',refundStatus:'none',productRuleStatus:'matched',importBatchId:'batch-payment-reviewed'},
  {id:'pay-demo-4',userId:'u-refund-review',source:'shop_evidence',evidenceStatus:'needs_review',occurredAt:days(-20),amountBand:'standard',refundStatus:'partial',productRuleStatus:'manual_review',importBatchId:'batch-payment-errors'},
  {id:'pay-demo-5',userId:null,source:'shop_evidence',evidenceStatus:'excluded',occurredAt:days(-8),amountBand:'unknown',refundStatus:'full',productRuleStatus:'excluded_refund',importBatchId:'batch-payment-errors'},
  {id:'pay-demo-6',userId:null,source:'shop_evidence',evidenceStatus:'excluded',occurredAt:days(-6),amountBand:'unknown',refundStatus:'none',productRuleStatus:'excluded_unpaid',importBatchId:'batch-payment-errors'}
];
const groupLabelOcrResults = [
  {id:'ocr-demo-1',candidateUserId:'u-active',alias:'青岚（匿名）',labelSuggestion:'年费会员',expirySuggestion:days(325),matchStatus:'matched',confidenceBand:'high',reviewStatus:'pending_human_confirmation'},
  {id:'ocr-demo-2',candidateUserId:'u-renewal-followup',alias:'南枝（匿名）',labelSuggestion:'已到期',expirySuggestion:days(-25),matchStatus:'matched',confidenceBand:'medium',reviewStatus:'pending_human_confirmation'},
  {id:'ocr-demo-3',candidateUserId:null,alias:'未匹配成员甲',labelSuggestion:'续费待核对',expirySuggestion:null,matchStatus:'unmatched',confidenceBand:'low',reviewStatus:'pending_human_confirmation'}
];
const membershipDecisions = Object.values(users).map((user,index) => ({id:`decision-demo-${index+1}`,userId:user.id,crmStatus:user.crmVerificationStatus,paymentStatus:user.latestPaymentEvidenceStatus,expiryStatus:new Date(user.endsAt)>new Date()?'current':'expired',groupStatus:user.groupStatus,finalStatus:user.groupStatus==='in_group'&&(user.status==='active'||(user.status==='expired'&&user.renewalNoticeStatus==='not_notified'))?'active':'needs_review',operationalStatus:user.id==='u-renewal-followup'?'renewal_follow_up_temporarily_active':undefined,decidedBy:'rule_and_human_review',decidedAt:days(-index)}));

const resourceRows = [
  ['usage_guide','会员平台使用说明','会籍核验、内容访问、活动报名与对接规则。',['新手指引','规则'],'飞书/使用说明','published','completed'],
  ['directory_guide','公开名册填写指南','说明公开同意、审核和申请对接机制。',['名册','隐私'],'飞书/会员名册','published','completed'],
  ['fundraising_guide','融资资源对接手册','匿名发布、申请筛选和分级披露流程。',['融资','对接'],'飞书/融资资源对接','published','completed'],
  ['recruitment_guide','招聘专区使用指南','招聘需求的匿名发布与申请规范。',['招聘','规范'],'飞书/招聘专区','published','completed'],
  ['activity_notice','活动参与须知','报名、候补、变更通知及线上容量说明。',['活动','通知'],'飞书/活动发布通知','published','completed'],
  ['meeting_replay','线上圆桌：产业智能化复盘','演示回放条目，包含纪要与资料归档状态。',['回放','产业'],'飞书/历史线上回放','published','completed'],
  ['group_digest','本周群聊精华：商业化验证','经运营整理和脱敏的讨论要点。',['群聊精华','商业化'],'飞书/群聊精华','published','completed'],
  ['industry_report','机器人产业链观察（演示）','虚构样本报告，用于演示分类与权限。',['机器人','产业链'],'飞书/行业报告','published','completed'],
  ['book','创投方法书目导读','仅展示可合法分享的书目与导读信息。',['书目','方法'],'飞书/书籍资源','published','completed'],
  ['data_source','常用公开数据源导航','公开数据源的用途、更新频率和使用提示。',['数据源','投研'],'飞书/常用数据源','published','completed'],
  ['tool','尽调文件清单工具','不含真实材料的结构化清单模板说明。',['工具','尽调'],'飞书/文件工具','published','completed'],
  ['industry_report','低空应用场景扫描（待复核）','迁移后待版权与来源复核的演示条目。',['场景','待复核'],'飞书/行业报告','draft','needs_review']
];
const resources = resourceRows.map((r,i)=>({id:`r-demo-${i+1}`,type:r[0],title:r[1],summary:r[2],tags:r[3],accessLevel:i===0?'verified_user':'active_member',sourceCollection:r[4],sourceStatus:i===11?'needs_rights_review':'source_confirmed',migrationStatus:r[6],status:r[5],publishedAt:days(-i*7)}));
const mobileSectionByType={meeting_replay:'replays',industry_report:'research_reports',group_digest:'group_digests',book:'books',data_source:'files_templates',tool:'files_templates',usage_guide:'files_templates',directory_guide:'files_templates',fundraising_guide:'files_templates',recruitment_guide:'files_templates',activity_notice:'benefits'};
for(const resource of resources){resource.mobileSection=mobileSectionByType[resource.type]||'files_templates';resource.downloadEnabled=['industry_report','tool'].includes(resource.type)&&resource.status==='published'}
resources.push({id:'r-demo-benefit',type:'benefit_update',title:'会员福利领取规则更新（演示）',summary:'仅展示虚构福利领取说明，不包含兑换码或外部联系方式。',tags:['福利','规则'],accessLevel:'active_member',sourceStatus:'source_confirmed',migrationStatus:'completed',mobileSection:'benefits',downloadEnabled:false,status:'published',publishedAt:days(-2)});

const activities = [
  {id:'a-online-open',format:'online',category:'topic_discussion',title:'线上圆桌：智能制造的新机会（演示）',startsAt:days(7),endsAt:days(7.1),registrationEndsAt:days(6),meetingLinkOpensAt:days(6.9),meetingLinkClosesAt:days(7.1),status:'registration_open',capacity:120,registeredCount:64,waitlistCount:0,archiveResourceIds:[]},
  {id:'a-offline-full',format:'offline',category:'city_salon',city:'示例城·东岸',title:'城市沙龙：产业协同案例拆解（演示）',startsAt:days(14),endsAt:days(14.2),registrationEndsAt:days(10),status:'waitlist_open',capacity:24,registeredCount:24,waitlistCount:7,archiveResourceIds:[]},
  {id:'a-hybrid-live',format:'hybrid',category:'topic_discussion',city:'示例城·南港',title:'混合活动：早期产品验证工作坊（演示）',startsAt:days(-0.03),endsAt:days(0.15),registrationEndsAt:days(-1),meetingLinkOpensAt:days(-0.1),meetingLinkClosesAt:days(0.15),status:'in_progress',capacity:80,registeredCount:71,waitlistCount:3,archiveResourceIds:[]},
  {id:'a-ended',format:'online',category:'topic_discussion',title:'线上分享：投研工具实践（演示）',startsAt:days(-21),endsAt:days(-20.9),registrationEndsAt:days(-22),meetingLinkOpensAt:days(-21.1),meetingLinkClosesAt:days(-20.9),status:'ended',capacity:100,registeredCount:86,waitlistCount:0,archiveResourceIds:['r-demo-6']},
  {id:'a-cancelled',format:'offline',category:'city_salon',city:'示例城·西岭',title:'城市沙龙：新能源生态交流（已取消演示）',startsAt:days(20),endsAt:days(20.2),registrationEndsAt:days(18),status:'cancelled',capacity:30,registeredCount:12,waitlistCount:0,cancellationReasonCode:'venue_unavailable',archiveResourceIds:[]},
  {id:'a-annual',format:'offline',category:'annual_gathering',city:'示例城·北屿',title:'会员年度聚会（演示）',startsAt:days(100),endsAt:days(100.35),registrationEndsAt:days(90),status:'draft',capacity:160,registeredCount:0,waitlistCount:0,archiveResourceIds:[]}
];
[ -2,-4,-1,-22,-10,-5 ].forEach((offset,index)=>{activities[index].createdAt=days(offset)});

const demands = [
  {id:'d-fund-published',ownerUserId:'u-peer',type:'fundraising',anonymousTitle:'工业软件项目寻 A 轮合作方',anonymousSummary:'处于规模化验证阶段，寻理解产业场景的长期合作方。',publicTags:['工业软件','A轮'],companyName:'内部敏感字段占位（不返回会员端）',transactionDetails:'内部交易字段占位（不返回会员端）',disclosurePolicy:{company:'owner_confirm',transaction:'owner_confirm',contact:'never_public'},disclosureLevel:'anonymous',aiReviewStatus:'passed',humanReviewStatus:'approved',status:'published'},
  {id:'d-job-published',ownerUserId:'u-near-expiry',type:'recruitment',anonymousTitle:'早期基金招聘产业研究岗位',anonymousSummary:'关注先进制造方向，工作地点为华东区域。',publicTags:['招聘','先进制造'],disclosurePolicy:{company:'after_shortlist',contact:'never_public'},disclosureLevel:'anonymous',aiReviewStatus:'passed',humanReviewStatus:'approved_with_notes',status:'published'},
  {id:'d-ma-published',ownerUserId:'u-peer',type:'ma',anonymousTitle:'产业方寻企业服务并购标的',anonymousSummary:'关注具备稳定订阅收入和行业交付能力的团队。',publicTags:['并购','企业服务'],transactionDetails:'内部交易字段占位（不返回会员端）',disclosurePolicy:{company:'owner_confirm',transaction:'owner_confirm',contact:'never_public'},disclosureLevel:'anonymous',aiReviewStatus:'flagged',humanReviewStatus:'approved_with_notes',status:'published'},
  {id:'d-fund-ai-review',ownerUserId:'u-active-private',type:'fundraising',anonymousTitle:'新能源材料项目融资需求草案',anonymousSummary:'等待 AI 风险项复核的演示需求。',publicTags:['新能源','融资'],disclosurePolicy:{company:'owner_confirm',contact:'never_public'},disclosureLevel:'internal_only',aiReviewStatus:'manual_review',humanReviewStatus:'pending',status:'ai_review'},
  {id:'d-job-human-review',ownerUserId:'u-active',type:'recruitment',anonymousTitle:'产业平台招聘战略合作岗位',anonymousSummary:'AI 初筛通过，等待运营终审。',publicTags:['招聘','战略合作'],disclosurePolicy:{company:'after_shortlist',contact:'never_public'},disclosureLevel:'internal_only',aiReviewStatus:'passed',humanReviewStatus:'pending',status:'human_review'},
  {id:'d-ma-rejected',ownerUserId:'u-refund-review',type:'ma',anonymousTitle:'并购合作需求（未通过演示）',anonymousSummary:'因信息不足退回，不在会员端发布。',publicTags:['并购'],disclosurePolicy:{company:'never_public',contact:'never_public'},disclosureLevel:'internal_only',aiReviewStatus:'flagged',humanReviewStatus:'rejected',status:'rejected'},
  {id:'d-fund-closed',ownerUserId:'u-peer',type:'fundraising',anonymousTitle:'数据工具项目融资（已结束）',anonymousSummary:'需求方已结束本轮对接。',publicTags:['数据工具','融资'],disclosurePolicy:{company:'owner_confirm',contact:'never_public'},disclosureLevel:'anonymous',aiReviewStatus:'passed',humanReviewStatus:'approved',status:'closed'}
];
demands.push(
  {id:'d-investment-published',ownerUserId:'u-active-private',type:'investment',anonymousTitle:'早期科技项目投资机会（演示）',anonymousSummary:'关注完成产品验证的技术项目，仅接受平台内匿名申请。',publicTags:['投资','早期'],disclosurePolicy:{company:'owner_confirm',contact:'never_public'},disclosureLevel:'anonymous',aiReviewStatus:'passed',humanReviewStatus:'approved',status:'published'},
  {id:'d-attraction-published',ownerUserId:'u-peer',type:'business_attraction',anonymousTitle:'产业园区招商合作机会（演示）',anonymousSummary:'面向先进制造服务团队的虚构招商场景，需运营筛选后对接。',publicTags:['招商','先进制造'],disclosurePolicy:{company:'owner_confirm',contact:'never_public'},disclosureLevel:'anonymous',aiReviewStatus:'passed',humanReviewStatus:'approved_with_notes',status:'published'}
);
demands.filter(x=>x.status==='published').forEach((item,index)=>{item.publishedAt=days(-3-index*2)});

const registrations = new Map([
  ['a-online-open:u-active',{activityId:'a-online-open',userId:'u-active',status:'registered'}],
  ['a-offline-full:u-active',{activityId:'a-offline-full',userId:'u-active',status:'waitlisted'}],
  ['a-hybrid-live:u-peer',{activityId:'a-hybrid-live',userId:'u-peer',status:'registered'}],
  ['a-ended:u-active',{activityId:'a-ended',userId:'u-active',status:'attended'}]
]);
const applications = [
  {id:'app-demo-1',demandId:'d-fund-published',userId:'u-active',reason:'演示申请：具备相关产业研究经验。',status:'submitted',agentReviewStatus:'pending',createdAt:days(-2)},
  {id:'app-demo-2',demandId:'d-job-published',userId:'u-peer',reason:'演示申请：希望进一步了解岗位职责。',status:'shortlisted',agentReviewStatus:'shortlisted',ownerDecisionStatus:'pending',createdAt:days(-5)},
  {id:'app-demo-3',demandId:'d-ma-published',userId:'u-near-expiry',reason:'演示申请：可提供符合方向的匿名案例。',status:'owner_confirmed',agentReviewStatus:'shortlisted',ownerDecisionStatus:'approved_intro',disclosureGranted:'company_only',createdAt:days(-8)},
  {id:'app-demo-4',demandId:'d-fund-published',userId:'u-active-private',reason:'演示申请：合作方向暂不匹配。',status:'declined',agentReviewStatus:'declined',createdAt:days(-10)}
];
const memberConnections = [
  {id:'mc-demo-1',requesterUserId:'u-active',targetUserId:'u-peer',reason:'围绕产业研究方法进行交流。',status:'submitted',createdAt:days(-1)},
  {id:'mc-demo-2',requesterUserId:'u-near-expiry',targetUserId:'u-peer',reason:'邀请参与一次匿名主题分享。',status:'accepted_for_intro',createdAt:days(-7)},
  {id:'mc-demo-3',requesterUserId:'u-peer',targetUserId:'u-active',reason:'希望交流产业研究共创方法（演示）。',status:'submitted',createdAt:days(-2)}
];
const agentMatchRequests = [
  {id:'amr-demo-1',userId:'u-active',statementSummary:'寻找产业研究共创与投研工具交流机会（演示）',inputMode:'text',status:'human_review_pending',aiStatus:'awaiting_configuration',humanStatus:'pending',createdAt:days(-1)}
];
const memberFavorites = new Map([
  ['u-active',new Set(['resource:r-demo-8','resource:r-demo-11','activity:a-online-open'])],
  ['u-near-expiry',new Set(['resource:r-demo-6'])]
]);
const internalMemberProfiles = new Map([
  ['u-active',{organization:'微澜价值实验室（虚构）',city:'示例城·北屿',needPreferences:['报告共创','投研工具'],phonePresent:false,employmentArtifactStatus:'submitted'}],
  ['u-near-expiry',{organization:'云尺创新观察室（虚构）',city:'示例城·南港',needPreferences:['早期项目交流'],phonePresent:false,employmentArtifactStatus:'pending_review'}]
]);

const orders = [
  {id:'evidence-record-demo-1',userId:'u-active',type:'payment_evidence',status:'verified',source:'manual_payment',amountBand:'standard',refundStatus:'none',importBatchId:'batch-manual-entry',determinesMembershipAlone:false},
  {id:'evidence-record-demo-2',userId:'u-near-expiry',type:'payment_evidence',status:'verified',source:'shop_evidence',amountBand:'legacy_offer',refundStatus:'none',importBatchId:'batch-payment-reviewed',determinesMembershipAlone:false},
  {id:'evidence-record-demo-3',userId:'u-refund-review',type:'payment_evidence',status:'needs_review',source:'shop_evidence',amountBand:'standard',refundStatus:'partial',importBatchId:'batch-payment-errors',determinesMembershipAlone:false},
  {id:'evidence-record-demo-4',userId:null,type:'payment_evidence',status:'excluded',source:'shop_evidence',amountBand:'unknown',refundStatus:'full',importBatchId:'batch-payment-errors',determinesMembershipAlone:false}
];
const renewalOffers = [
  {id:'offer-demo-1',userId:'u-near-expiry',standardPriceCents:199900,offeredPriceCents:169900,discountReason:'演示：早期会员续费规则',eligibilityRule:{membershipStatus:'active',daysToExpiryMax:30},validUntil:days(20)},
  {id:'offer-demo-2',userId:'u-expired',standardPriceCents:199900,offeredPriceCents:199900,discountReason:'标准续费价',eligibilityRule:{membershipStatus:'expired',manualReviewRequired:true},validUntil:days(30)}
];
const aiReviews = demands.map((d,i)=>({id:`ai-demo-${i+1}`,subjectType:'demand',subjectId:d.id,provider:'demo-adapter-no-external-call',recommendation:d.aiReviewStatus,riskFlags:d.aiReviewStatus==='flagged'?['信息完整性待人工确认']:[],humanDecision:d.humanReviewStatus,rawContentStored:false}));

const importBatches = [
  {id:'batch-crm-rehearsal',kind:'crm_verification',source:'synthetic_csv',status:'needs_correction',totalRows:3,validRows:1,reviewRows:1,excludedRows:1,errorRows:1,createdAt:days(-7)},
  {id:'batch-knowledge-ready',kind:'knowledge',source:'synthetic_csv',status:'ready_for_human_review',totalRows:10,validRows:9,reviewRows:1,excludedRows:0,errorRows:0,createdAt:days(-6)},
  {id:'batch-directory-review',kind:'voluntary_directory',source:'synthetic_csv',status:'needs_correction',totalRows:5,validRows:3,reviewRows:3,excludedRows:1,errorRows:1,createdAt:days(-5)},
  {id:'batch-payment-reviewed',kind:'shop_order_evidence',source:'synthetic_csv',status:'ready_for_human_review',totalRows:6,validRows:4,reviewRows:2,excludedRows:2,errorRows:0,createdAt:days(-4)},
  {id:'batch-payment-errors',kind:'shop_order_evidence',source:'synthetic_csv',status:'needs_correction',totalRows:5,validRows:1,reviewRows:1,excludedRows:2,errorRows:2,createdAt:days(-3)},
  {id:'batch-manual-entry',kind:'manual_payment',source:'controlled_manual_entry',status:'completed_demo',totalRows:2,validRows:2,reviewRows:0,excludedRows:0,errorRows:0,createdAt:days(-2)}
];
const importItems = [
  {id:'item-crm-review',batchId:'batch-crm-rehearsal',kind:'crm_verification',rowNumber:2,status:'needs_human_review',data:{internal_member_ref:'anonymous-member-ref',crm_verification_status:'verified',membership_start:'2026-01-01',membership_end:'2027-01-01',group_status:'in_group',migration_status:'ready'},errors:[],warnings:['匿名演练：仍需核对会员匹配与付款证据，不能仅凭 CRM 激活会籍']},
  {id:'item-crm-conflict',batchId:'batch-crm-rehearsal',kind:'crm_verification',rowNumber:3,status:'error',data:{internal_member_ref:'anonymous-conflict-ref',crm_verification_status:'needs_review',group_status:'unknown',migration_status:'needs_review'},errors:['匿名演练：会员匹配冲突且会籍窗口不完整'],warnings:['保持待复核，不写入最终会籍判定']},
  {id:'item-knowledge-ready',batchId:'batch-knowledge-ready',kind:'knowledge',rowNumber:2,status:'ready',data:{source_directory:'行业报告',title:'演示行业观察条目',summary:'可上架的虚构资料摘要',type:'industry_report',tags:['演示','行业'],access_level:'active_member',migration_status:'ready',destination:'knowledge_base'},errors:[],warnings:[]},
  {id:'item-knowledge-review',batchId:'batch-knowledge-ready',kind:'knowledge',rowNumber:6,status:'needs_human_review',data:{source_directory:'书籍资源',title:'待确认授权的演示书目',summary:'只保留书目信息',type:'book',tags:['书目'],access_level:'active_member',migration_status:'needs_review',destination:'knowledge_base'},errors:[],warnings:['需人工确认版权与来源状态']},
  {id:'item-directory-consent',batchId:'batch-directory-review',kind:'voluntary_directory',rowNumber:3,status:'needs_human_review',data:{member_reference:'demo-ref-only',public_display_name:'候审代号（演示）',organization:'虚构协作组',industry:'企业服务',interests:'研究交流',investment_stage:'成长期',city:'示例城',expertise:'行业研究',bio:'自愿公开名册候审演示',source_sheet:'演示空模板',eligibleForReview:true},errors:[],warnings:['联系方式不会导入公开名册']},
  {id:'item-directory-error',batchId:'batch-directory-review',kind:'voluntary_directory',rowNumber:5,status:'error',data:{public_display_name:'缺少同意标记的演示行'},errors:['缺少明确的公开展示同意'],warnings:['不得从 CRM 或付款证据自动同步']},
  {id:'item-payment-review',batchId:'batch-payment-errors',kind:'shop_order_evidence',rowNumber:4,status:'needs_human_review',data:{paymentStatus:'paid',refundStatus:'partial',productRuleStatus:'manual_review',evidenceCandidate:true,determinesMembershipAlone:false},errors:[],warnings:['部分退款需人工复核；不得单独改变会籍']},
  {id:'item-payment-excluded',batchId:'batch-payment-errors',kind:'shop_order_evidence',rowNumber:5,status:'excluded',data:{paymentStatus:'cancelled',refundStatus:'none',productRuleStatus:'excluded',evidenceCandidate:false,determinesMembershipAlone:false},errors:[],warnings:['已取消记录已排除']},
  {id:'item-payment-corrected',batchId:'batch-payment-errors',kind:'shop_order_evidence',rowNumber:6,status:'ready',data:{paymentStatus:'paid',refundStatus:'none',productRuleStatus:'matched_after_correction',evidenceCandidate:true,determinesMembershipAlone:false},errors:[],warnings:['异常字段已由运营修正，仍待会籍人工复核']}
];

// Synthetic one-time migration metadata. No Feishu URL, token, content body,
// filename, external ID or private storage key is included in demo fixtures.
const feishuMigrationTasks = [{
  id:'fm-demo-offline',sourceMode:'export_package',scope:'all_descendants',classificationStrategy:'directory_first',
  status:'reviewing_imported_items',sourceReady:false,continuousSync:false,defaultPublishPolicy:'pending_review',
  rootLinkValidated:false,rootLinkStored:false,credentialStored:false,sourceDisconnected:false,
  directoryTree:[
    {id:'tree-demo-guides',label:'使用说明（演示）',kind:'directory',itemCount:2},
    {id:'tree-demo-members',label:'会员名册（隔离演示）',kind:'directory',itemCount:1},
    {id:'tree-demo-needs',label:'招聘与融资（演示）',kind:'directory',itemCount:2},
    {id:'tree-demo-events',label:'活动与回放（演示）',kind:'directory',itemCount:2},
    {id:'tree-demo-knowledge',label:'报告、精华与工具（演示）',kind:'directory',itemCount:3}
  ],createdAt:days(-9),updatedAt:days(-1)
}];
const feishuMigrationItems = [
  {id:'fmi-demo-1',taskId:'fm-demo-offline',displayLabel:'使用指南条目（演示）',sourceKind:'markdown',directoryCode:'usage_guide',destination:'knowledge_review',status:'pending_review',ownedContentCreated:true,privateFileRefCreated:false,sourceHandlePresent:false},
  {id:'fmi-demo-2',taskId:'fm-demo-offline',displayLabel:'行业资料条目（演示）',sourceKind:'pdf',directoryCode:'industry_reports',destination:'knowledge_review',status:'migrated',ownedContentCreated:true,privateFileRefCreated:true,sourceHandlePresent:false},
  {id:'fmi-demo-3',taskId:'fm-demo-offline',displayLabel:'名册数据条目（隔离演示）',sourceKind:'html',directoryCode:'member_directory',destination:'directory_review',status:'pending_review',ownedContentCreated:true,privateFileRefCreated:false,sourceHandlePresent:false},
  {id:'fmi-demo-4',taskId:'fm-demo-offline',displayLabel:'招聘条目（演示）',sourceKind:'markdown',directoryCode:'recruitment',destination:'recruitment_review',status:'pending_review',ownedContentCreated:true,privateFileRefCreated:false,sourceHandlePresent:false},
  {id:'fmi-demo-5',taskId:'fm-demo-offline',displayLabel:'融资对接条目（演示）',sourceKind:'html',directoryCode:'fundraising_connections',destination:'fundraising_review',status:'needs_classification',ownedContentCreated:true,privateFileRefCreated:false,sourceHandlePresent:false},
  {id:'fmi-demo-6',taskId:'fm-demo-offline',displayLabel:'活动通知条目（演示）',sourceKind:'markdown',directoryCode:'activity_notices',destination:'activity_review',status:'migrated',ownedContentCreated:true,privateFileRefCreated:false,sourceHandlePresent:false},
  {id:'fmi-demo-7',taskId:'fm-demo-offline',displayLabel:'线上回放条目（演示）',sourceKind:'attachment',directoryCode:'meeting_replays',destination:'replay_review',status:'attachment_pending',ownedContentCreated:true,privateFileRefCreated:false,sourceHandlePresent:false},
  {id:'fmi-demo-8',taskId:'fm-demo-offline',displayLabel:'未知格式条目（隔离演示）',sourceKind:'unknown',directoryCode:'unknown',destination:'quarantine',status:'failed',failureCode:'unsupported_format',retryCount:0,ownedContentCreated:false,privateFileRefCreated:false,sourceHandlePresent:false},
  {id:'fmi-demo-9',taskId:'fm-demo-offline',displayLabel:'重复资料条目（演示）',sourceKind:'pdf',directoryCode:'books',destination:'knowledge_review',status:'skipped',skipReasonCode:'duplicate_content',ownedContentCreated:false,privateFileRefCreated:false,sourceHandlePresent:false},
  {id:'fmi-demo-10',taskId:'fm-demo-offline',displayLabel:'群聊精华条目（演示）',sourceKind:'markdown',directoryCode:'group_digests',destination:'knowledge_review',status:'pending_review',ownedContentCreated:true,privateFileRefCreated:false,sourceHandlePresent:false}
];
const feishuOwnedContents = [];
const localImportBatches = [];
const localImportItems = [];

const notificationJobs = [
  {id:'n-demo-1',activityId:'a-online-open',trigger:'registration_success',channel:'wechat_subscription',status:'queued'},
  {id:'n-demo-2',activityId:'a-offline-full',trigger:'waitlist_joined',channel:'wechat_subscription',status:'sent_demo'},
  {id:'n-demo-3',activityId:'a-hybrid-live',trigger:'before_start',channel:'wechat_subscription',status:'sent_demo'},
  {id:'n-demo-4',activityId:'a-cancelled',trigger:'activity_cancelled',channel:'wechat_subscription',status:'retry_pending'},
  {id:'n-demo-5',activityId:'a-ended',trigger:'after_end_archive',channel:'wechat_subscription',status:'sent_demo'},
  {id:'n-demo-6',activityId:'a-online-open',trigger:'activity_changed',channel:'wechat_subscription',status:'template_pending'}
];
const requirementCoverage = [
  {area:'会员准入',status:'prototype',placement:'会员 CRM 汇总；大群状态为最终门禁，标签到期可进入续费跟进'},
  {area:'公开名册',status:'prototype',placement:'独立同意、人工审核、申请对接'},
  {area:'知识库十类迁移',status:'prototype',placement:'知识库与业务模块路由'},
  {area:'招聘融资并购',status:'prototype',placement:'AI 初筛 / 人工终审 / Agent 分发'},
  {area:'活动全生命周期',status:'prototype',placement:'报名候补 / 通知 / 回放归档'},
  {area:'审计与敏感信息',status:'prototype',placement:'服务端门禁 / 安全响应'}
];
const operationsReadiness = [
  {domain:'会籍四域隔离',status:'complete',owner:'运营负责人',acceptance:'CRM、付款证据、公开名册与最终会籍独立处理并留审计'},
  {domain:'退款与人工补录规则',status:'user_decision',owner:'会员运营',acceptance:'确认部分退款、重复付款、非小店续费与退群宽限规则'},
  {domain:'公开名册与在职核验',status:'complete',owner:'审核人员',acceptance:'公开同意和发布审核独立；在职材料只显示安全元数据'},
  {domain:'知识库与一次性迁入',status:'needs_external',owner:'内容运营',acceptance:'配置飞书只读应用、目标资源读权和私有对象存储后完成实迁演练'},
  {domain:'活动与通知',status:'needs_external',owner:'活动运营',acceptance:'微信订阅模板、授权留痕及腾讯会议容量和特邀链接真机验收'},
  {domain:'需求与撮合',status:'user_decision',owner:'撮合负责人',acceptance:'确定终审、Agent 分发、需求方披露确认的责任人和 SLA'},
  {domain:'生产持久化与恢复',status:'needs_external',owner:'技术负责人',acceptance:'数据库迁移、对象存储、加密、备份恢复演练和监控告警全部通过'},
  {domain:'微信登录支付隐私',status:'needs_external',owner:'公司主体',acceptance:'真实主体、AppID、支付商户、隐私政策与授权记录完成官方环境验收'},
  {domain:'RBAC 与高风险保护',status:'complete',owner:'系统管理员',acceptance:'四角色最小权限、再次确认、幂等键和审计均可验证'}
];
const audits = [
  {id:'log-demo-1',actor:'demo-operator',action:'membership.review',subjectType:'membership_decision',subjectId:'decision-demo-3',summary:{result:'active',sensitiveDataIncluded:false},createdAt:days(-1)},
  {id:'log-demo-2',actor:'demo-operator',action:'public_profile_update.return',subjectType:'public_profile_update',subjectId:'ppu-demo-returned',summary:{reasonCode:'content_incomplete',contactExposed:false},createdAt:days(-2)},
  {id:'log-demo-3',actor:'demo-operator',action:'employment_verification.review',subjectType:'employment_verification',subjectId:'ev-demo-verified',summary:{result:'verified',artifactContentLogged:false,membershipChanged:false},createdAt:days(-3)},
  {id:'log-demo-4',actor:'demo-operator',action:'payment_evidence.exclude',subjectType:'payment_evidence',subjectId:'pay-demo-5',summary:{reasonCode:'full_refund',membershipChanged:false},createdAt:days(-4)},
  {id:'log-demo-5',actor:'demo-operator',action:'demand.human_review',subjectType:'demand',subjectId:'d-ma-published',summary:{decision:'approved_with_notes',sensitiveFieldsPublished:false},createdAt:days(-5)},
  {id:'log-demo-6',actor:'demo-system',action:'activity.notification.retry_scheduled',subjectType:'notification_job',subjectId:'n-demo-4',summary:{reasonCode:'demo_delivery_unavailable',credentialUsed:false},createdAt:days(-6)},
  {id:'log-demo-7',actor:'demo-operator',action:'import_item.correct',subjectType:'import_item',subjectId:'item-payment-corrected',summary:{status:'ready',protectedDataLogged:false},createdAt:days(-7)}
];

function audit(actor, action, subjectType, subjectId, summary = {}) {
  audits.unshift({id:`log-${Date.now()}-${audits.length}`,actor,action,subjectType,subjectId,summary,createdAt:new Date().toISOString()});
}

module.exports = {users,crmVerifications,directoryProfiles,publicProfileUpdates,employmentVerifications,paymentEvidence,groupLabelOcrResults,membershipDecisions,resources,activities,demands,registrations,applications,memberConnections,agentMatchRequests,memberFavorites,internalMemberProfiles,orders,renewalOffers,aiReviews,importBatches,importItems,feishuMigrationTasks,feishuMigrationItems,feishuOwnedContents,localImportBatches,localImportItems,notificationJobs,requirementCoverage,operationsReadiness,audits,audit};
