'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeCrmProfile,membershipDuration,extendExpiryFromOriginalMonth,publicDirectoryProjection,validateConnectionApplication,directionalMatchEligible}=require('../src/member-crm-mvp');
const {previewCrmVerificationCsv}=require('../src/imports');
const {PassThrough}=require('node:stream');
const server=require('../src/server'),store=require('../src/store');
const call=(path,{user='active',role,method='GET',body,headers={}}={})=>new Promise((resolve,reject)=>{const req=new PassThrough();req.method=method;req.url=path;req.headers={host:'localhost','x-demo-user':user,...(role?{'x-demo-role':role}:{}),...(body?{'content-type':'application/json'}:{}),...headers};const response={statusCode:200,writeHead(status){this.statusCode=status},end(chunk=''){const text=String(chunk||'');resolve({status:this.statusCode,payload:text?JSON.parse(text):{}})}};req.on('error',reject);server.emit('request',req,response);req.end(body?JSON.stringify(body):'')});

test('CRM master allows incomplete history and reports missing core fields',()=>{
  const profile=normalizeCrmProfile({wechatGroupNickname:'匿名群昵称',membershipExpiryMonth:'2026-08',renewalPriceCents:69900,firstGroupEntryMonth:'2025-01',accumulatedGroupMonths:5});
  assert.deepEqual(profile.missingCoreFields,['wechatId','phone','realName']);
  assert.equal(extendExpiryFromOriginalMonth(profile.membershipExpiryMonth),'2027-08');
  assert.match(membershipDuration({...profile,groupStatus:'in_group'},'2026-08').label,/年/);
});

test('historical renewal sheet aliases enter human review without exposing identifiers',()=>{
  const csv='昵称,备注名,到期月份,续费价格,通知状态,付款状态,群状态\n匿名甲,群备注,2026-08,69900,not_notified,unpaid,in_group';
  const preview=previewCrmVerificationCsv(csv);
  assert.deepEqual(preview.headerErrors,[]);
  const row=preview.results[0];
  assert.equal(row.valid,true);assert.equal(row.disposition,'needs_human_review');
  assert.equal(row.normalized.wechatGroupNicknamePresent,true);
  assert.equal(row.normalized.missingCoreFieldCount,3);
  assert.equal('wechat_group_nickname' in row.normalized,false);
  assert.equal(row.normalized.determinesMembershipAlone,false);
});

test('public directory is independent and always omits private CRM facts',()=>{
  assert.equal(publicDirectoryProjection({publicMode:'private',consentStatus:'granted',reviewStatus:'approved'}),null);
  const result=publicDirectoryProjection({publicMode:'full_safe',consentStatus:'granted',reviewStatus:'approved',publicDisplayName:'匿名成员',company:'虚构机构',title:'研究员',institutionType:'投资机构',cities:['示例城'],tracks:['先进制造'],professionalTags:['研究'],introduction:'公开简介',collaborationPreference:'报告共创',phone:'never-return',wechatId:'never-return',groupStatus:'in_group'});
  assert.equal(result.contactMode,'request_only');
  for(const key of ['phone','wechatId','groupStatus','paymentStatus','agentInternalTags'])assert.equal(key in result,false);
});

test('connection application requires guided three-part explanation',()=>{
  assert.equal(validateConnectionApplication({who:'我',why:'想认识',topic:'加微信'}).valid,false);
  const good=validateConnectionApplication({who:'我是产业研究方向的匿名会员',why:'我的研究方向与该机会的产业场景高度相关',topic:'希望讨论行业验证方法以及可以共同推进的研究事项'});
  assert.equal(good.valid,true);
});

test('directional reminders require three of four dimensions and never auto-send',()=>{
  assert.deepEqual(directionalMatchEligible({person:'投资人',organization:'产业基金'}),{eligible:false,matchedDimensions:2,requiresHumanSend:true,contactDisclosed:false});
  assert.equal(directionalMatchEligible({person:'投资人',organization:'产业基金',role:'投资负责人',matter:'A轮融资'}).eligible,true);
});

test('admin review selects distribution mode while private match stays out of member flow',async()=>{
  const demand={id:'d-review-private-fixture',ownerUserId:'u-peer',type:'investment',anonymousTitle:'待审匿名需求',anonymousSummary:'仅用于匿名测试',publicTags:['投资'],requestedDistributionMode:'private_match',reviewElements:{who:'产业研究员',why:'验证行业判断',target:'寻找产业投资人'},directionalCriteria:{person:'投资人',organization:'产业基金',role:'投资负责人',matter:'项目交流'},humanReviewStatus:'pending',status:'human_review',expiresAt:new Date(Date.now()+86400000).toISOString()};store.demands.unshift(demand);
  try{const reviewed=await call(`/api/admin/demands/${demand.id}/human-review`,{role:'administrator',method:'PATCH',body:{decision:'approve_distribution',distributionMode:'private_match'},headers:{'x-admin-confirmation':'demand.finalize','idempotency-key':'private-match-review-fixture'}});assert.equal(reviewed.status,200);assert.equal(reviewed.payload.status,'private_match_approved');assert.equal(reviewed.payload.distributionMode,'private_match');assert.equal(reviewed.payload.contactDisclosed,false);const memberFlow=await call('/api/opportunities');assert.equal(memberFlow.payload.some(x=>x.id===demand.id),false)}finally{store.demands.splice(store.demands.indexOf(demand),1)}
});

test('redacted public approval replaces member input with a generic safe summary',async()=>{
  const beforeDemands=store.demands.length,beforeRequests=store.agentMatchRequests.length;
  try{const submitted=await call('/api/agent-match-requests',{method:'POST',body:{inputMode:'text',category:'fundraising',who:'虚构机构负责人',why:'希望为代号项目寻找合作',target:'寻找特定产业基金负责人',distributionMode:'redacted_public'}});assert.equal(submitted.status,201);const demand=store.demands[0];const reviewed=await call(`/api/admin/demands/${demand.id}/human-review`,{role:'administrator',method:'PATCH',body:{decision:'approve_distribution',distributionMode:'redacted_public'},headers:{'x-admin-confirmation':'demand.finalize','idempotency-key':'redacted-review-fixture'}});assert.equal(reviewed.status,200);const publicRows=await call('/api/opportunities'),row=publicRows.payload.find(x=>x.id===demand.id);assert.ok(row);assert.equal(row.anonymousTitle,'匿名融资机会');assert.equal(JSON.stringify(row).includes('代号项目'),false);assert.equal(JSON.stringify(row).includes('特定产业基金负责人'),false);assert.equal(row.contactDisclosed,false)}finally{store.demands.splice(0,store.demands.length-beforeDemands);store.agentMatchRequests.splice(0,store.agentMatchRequests.length-beforeRequests)}
});

test('admin CRM update remains private and does not activate membership',async()=>{
  const id='u-renewal-followup',before={...(store.memberCrmProfiles.get(id)||{})};
  try{const response=await call(`/api/admin/members/${id}/crm-profile`,{role:'administrator',method:'PATCH',body:{wechatGroupNickname:'匿名更新昵称',membershipExpiryMonth:'2026-08',renewalPriceCents:20000},headers:{'x-admin-confirmation':'membership.crm_update','idempotency-key':'crm-master-fixture'}});assert.equal(response.status,200);assert.equal(response.payload.publicDirectoryChanged,false);assert.equal(response.payload.membershipActivated,false);assert.equal(response.payload.crmProfile.missingCoreFields.includes('phone'),true);const member=await call('/api/me',{user:'renewal_followup'});assert.equal(JSON.stringify(member.payload).includes('wechatGroupNickname'),false)}finally{store.memberCrmProfiles.set(id,before)}
});

test('opportunity application rejects vague text and returns no contact after complete explanation',async()=>{
  const demand=store.demands.find(x=>x.status==='published'&&x.ownerUserId!=='u-active'),existing=store.applications.filter(x=>x.demandId===demand.id&&x.userId==='u-active');for(const item of existing)store.applications.splice(store.applications.indexOf(item),1);
  const vague=await call(`/api/demands/${demand.id}/apply`,{method:'POST',body:{who:'我',why:'想认识',topic:'加微信'}});assert.equal(vague.status,400);
  const good=await call(`/api/demands/${demand.id}/apply`,{method:'POST',body:{who:'我是产业研究方向的一名匿名会员',why:'长期研究该产业并能提供相关方法和案例',topic:'希望讨论行业验证方法与一项具体共创计划'}});assert.equal(good.status,201);assert.equal(good.payload.contactReleaseStatus,'not_released');assert.equal(JSON.stringify(good.payload).includes('phone'),false);store.applications.splice(store.applications.findIndex(x=>x.id===good.payload.id),1)
});

test('admin demand queue exposes only safe CRM submitter context and separates approved work',async()=>{
  const demand={id:'d-admin-queue-fixture',ownerUserId:'u-peer',type:'investment',anonymousTitle:'待审核需求',anonymousSummary:'仅用于审核队列测试',publicTags:['投资'],requestedDistributionMode:'redacted_public',reviewElements:{who:'产业研究员',why:'验证合作可能',target:'寻找产业投资负责人'},humanReviewStatus:'pending',status:'human_review',expiresAt:new Date(Date.now()+86400000).toISOString()};
  store.demands.unshift(demand);
  try{
    const before=await call('/api/admin/demands',{role:'administrator'}),row=before.payload.find(item=>item.id===demand.id);
    assert.equal(row.reviewQueue,'pending_review');
    assert.equal(typeof row.submitter.wechatContactAvailable,'boolean');
    assert.equal('wechatId' in row.submitter,false);
    assert.equal('phone' in row.submitter,false);
    const reviewed=await call(`/api/admin/demands/${demand.id}/human-review`,{role:'administrator',method:'PATCH',body:{decision:'approve_distribution',distributionMode:'redacted_public'},headers:{'x-admin-confirmation':'demand.finalize','idempotency-key':'admin-queue-review-fixture'}});
    assert.equal(reviewed.status,200);
    assert.equal(reviewed.payload.reviewQueue,'reviewed');
  }finally{store.demands.splice(store.demands.indexOf(demand),1)}
});

test('operator records manual WeChat relay without persisting contact data',async()=>{
  const demand={id:'d-relay-fixture',ownerUserId:'u-peer',type:'investment',anonymousTitle:'受控对接需求',anonymousSummary:'仅用于运营代转测试',status:'published',humanReviewStatus:'approved'};
  const application={id:'app-relay-fixture',demandId:demand.id,userId:'u-active',applicationSummary:{who:'匿名会员',why:'希望讨论合作',topic:'具体项目交流'},agentReviewStatus:'shortlisted',ownerDecisionStatus:'approved_intro',operatorRelayStatus:'not_started',status:'shortlisted',createdAt:new Date().toISOString()};
  store.demands.unshift(demand);store.applications.unshift(application);
  try{
    const result=await call(`/api/admin/applications/${application.id}/operator-relay`,{role:'administrator',method:'PATCH',body:{decision:'wechat_group_created'},headers:{'x-admin-confirmation':'application.dispatch','idempotency-key':'operator-relay-fixture'}});
    assert.equal(result.status,200);
    assert.equal(result.payload.operatorRelayStatus,'completed');
    assert.equal(result.payload.operatorRelayMethod,'wechat_group_created');
    assert.equal(result.payload.contactDisclosed,false);
    assert.equal(JSON.stringify(result.payload).includes('wechatId'),false);
  }finally{store.demands.splice(store.demands.indexOf(demand),1);store.applications.splice(store.applications.indexOf(application),1)}
});
