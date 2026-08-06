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

test('admin CRM update remains private and does not activate membership',async()=>{
  const id='u-renewal-followup',before={...(store.memberCrmProfiles.get(id)||{})};
  try{const response=await call(`/api/admin/members/${id}/crm-profile`,{role:'administrator',method:'PATCH',body:{wechatGroupNickname:'匿名更新昵称',membershipExpiryMonth:'2026-08',renewalPriceCents:20000},headers:{'x-admin-confirmation':'membership.crm_update','idempotency-key':'crm-master-fixture'}});assert.equal(response.status,200);assert.equal(response.payload.publicDirectoryChanged,false);assert.equal(response.payload.membershipActivated,false);assert.equal(response.payload.crmProfile.missingCoreFields.includes('phone'),true);const member=await call('/api/me',{user:'renewal_followup'});assert.equal(JSON.stringify(member.payload).includes('wechatGroupNickname'),false)}finally{store.memberCrmProfiles.set(id,before)}
});

test('opportunity application rejects vague text and returns no contact after complete explanation',async()=>{
  const demand=store.demands.find(x=>x.status==='published'&&x.ownerUserId!=='u-active'),existing=store.applications.filter(x=>x.demandId===demand.id&&x.userId==='u-active');for(const item of existing)store.applications.splice(store.applications.indexOf(item),1);
  const vague=await call(`/api/demands/${demand.id}/apply`,{method:'POST',body:{who:'我',why:'想认识',topic:'加微信'}});assert.equal(vague.status,400);
  const good=await call(`/api/demands/${demand.id}/apply`,{method:'POST',body:{who:'我是产业研究方向的一名匿名会员',why:'长期研究该产业并能提供相关方法和案例',topic:'希望讨论行业验证方法与一项具体共创计划'}});assert.equal(good.status,201);assert.equal(good.payload.contactReleaseStatus,'not_released');assert.equal(JSON.stringify(good.payload).includes('phone'),false);store.applications.splice(store.applications.findIndex(x=>x.id===good.payload.id),1)
});
