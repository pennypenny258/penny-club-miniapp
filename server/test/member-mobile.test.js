'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const server=require('../src/server');
const store=require('../src/store');

const call=(path,{user='active',method='GET',body}={})=>new Promise((resolve,reject)=>{
  const req=new PassThrough();req.method=method;req.url=path;req.headers={host:'localhost','x-demo-user':user,...(body?{'content-type':'application/json'}:{})};
  const response={statusCode:200,headers:{},writeHead(status,headers){this.statusCode=status;this.headers=headers||{}},end(chunk=''){const text=String(chunk||'');resolve({status:this.statusCode,payload:text?JSON.parse(text):{}})}};
  req.on('error',reject);server.emit('request',req,response);req.end(body?JSON.stringify(body):'');
});

test('inactive members cannot read mobile protected collections',async()=>{
  for(const path of ['/api/feed','/api/resources','/api/opportunities','/api/favorites']){
    const response=await call(path,{user:'expired'});assert.equal(response.status,403,path);
  }
});

test('mobile resources are whitelist-only and a closed download has no locator',async()=>{
  const response=await call('/api/resources');assert.equal(response.status,200);
  const closed=response.payload.find(x=>x.downloadEnabled===false);assert.ok(closed);
  const serialized=JSON.stringify(response.payload);
  for(const field of ['sourceUrl','sourceCollection','attachmentRef','storageKey','privateStorageRef','feishu'])assert.equal(serialized.includes(field),false,field);
  const download=await call(`/api/resources/${closed.id}/download`,{method:'POST'});assert.equal(download.status,403);assert.equal(download.payload.code,'DOWNLOAD_DISABLED');
  const view=await call(`/api/resources/${closed.id}/view`);assert.equal(view.status,200);assert.equal(view.payload.viewEnabled,true);assert.equal(view.payload.viewStatus,'preview_not_configured');assert.match(view.payload.message,/在线预览能力待配置/);
  assert.equal(/url|path|key|ref/i.test(JSON.stringify(download.payload)),false);
});

test('research reports and group digests have independent member sections while ambiguous legacy rows stay private',async()=>{
  const resources=(await call('/api/resources')).payload;
  assert.ok(resources.some(x=>x.type==='industry_report'&&x.mobileSection==='research_reports'));
  assert.ok(resources.some(x=>x.type==='group_digest'&&x.mobileSection==='group_digests'));
  const ambiguous={id:'r-legacy-ambiguous',title:'匿名历史资料',summary:'无法安全判断类别',tags:['历史'],type:'tool',mobileSection:'reports_digests',status:'published',downloadEnabled:true,publishedAt:new Date().toISOString()};store.resources.push(ambiguous);
  try{const hidden=await call('/api/resources?query='+encodeURIComponent('匿名历史资料'));assert.equal(hidden.payload.some(x=>x.id===ambiguous.id),false);const view=await call(`/api/resources/${ambiguous.id}/view`);assert.equal(view.status,404)}finally{store.resources.splice(store.resources.indexOf(ambiguous),1)}
});

test('published tags are searchable while draft tags remain private',async()=>{
  const published=store.resources.find(x=>x.status==='published'&&(x.tags||[]).length);assert.ok(published);
  const tag=published.tags[0],resourceSearch=await call(`/api/resources?query=${encodeURIComponent(tag)}`),feedSearch=await call(`/api/feed?query=${encodeURIComponent(tag)}`);
  assert.equal(resourceSearch.payload.some(x=>x.id===published.id),true);assert.equal(feedSearch.payload.items.some(x=>x.targetId===published.id),true);
  store.resources.push({id:'r-private-tag-test',title:'未发布匿名资料',summary:'仅用于回归',tags:['私有标签不可见'],type:'tool',mobileSection:'files_templates',status:'draft',downloadEnabled:false});
  const privateSearch=await call(`/api/feed?query=${encodeURIComponent('私有标签不可见')}`);assert.equal(privateSearch.payload.items.length,0);
  const privateView=await call('/api/resources/r-private-tag-test/view');assert.equal(privateView.status,404);
});

test('enabled downloads still require private storage and never reveal a locator',async()=>{
  const resources=(await call('/api/resources')).payload;const enabled=resources.find(x=>x.downloadEnabled);assert.ok(enabled);
  const response=await call(`/api/resources/${enabled.id}/download`,{method:'POST'});assert.equal(response.status,503);assert.equal(response.payload.code,'PRIVATE_DOWNLOAD_NOT_CONFIGURED');
  for(const field of ['url','path','storageKey','attachmentRef'])assert.equal(JSON.stringify(response.payload).includes(field),false,field);
});

test('opportunities cover five categories without private demand fields',async()=>{
  const response=await call('/api/opportunities');assert.equal(response.status,200);
  const types=new Set(response.payload.map(x=>x.type));
  for(const type of ['investment','fundraising','ma','recruitment','business_attraction'])assert.ok(types.has(type),type);
  const serialized=JSON.stringify(response.payload);
  for(const field of ['companyName','transactionDetails','ownerUserId','privateAttachments','sensitiveMaterialKey','contact'])assert.equal(serialized.includes(field),false,field);
});

test('agent matching and contact decisions disclose neither private matches nor contact',async()=>{
  const match=await call('/api/agent-match-requests',{method:'POST',body:{inputMode:'text',statement:'我是产业研究从业者，希望寻找报告共创伙伴和合适的主题交流机会。'}});
  assert.equal(match.status,201);assert.equal(match.payload.status,'human_review_pending');assert.equal('matches' in match.payload,false);
  const notices=await call('/api/my/connection-notifications');const pending=notices.payload.find(x=>x.status==='submitted');assert.ok(pending);assert.equal(pending.contactDisclosed,false);
  const decision=await call(`/api/my/connection-notifications/${pending.id}`,{method:'PATCH',body:{decision:'share_contact'}});assert.equal(decision.status,200);assert.equal(decision.payload.contactDisclosed,false);
  const serialized=JSON.stringify({notices:notices.payload,decision:decision.payload});
  for(const field of ['phone','wechat','email','contactValue'])assert.equal(serialized.toLowerCase().includes(field.toLowerCase()),false,field);
});

test('voice and payment clearly remain unconfigured and never fake success',async()=>{
  const capabilities=await call('/api/member-capabilities');assert.equal(capabilities.payload.wechatPaymentConfigured,false);assert.equal(capabilities.payload.asrConfigured,false);
  const voice=await call('/api/agent-voice-sessions',{method:'POST',body:{durationMs:1000}});assert.equal(voice.status,503);assert.equal(voice.payload.code,'VOICE_ASR_NOT_CONFIGURED');
  const offer=await call('/api/my/renewal-offer');assert.equal(offer.payload.paymentConfigured,false);assert.match(offer.payload.paymentNotice,/待配置/);
  assert.equal(offer.payload.membershipTier.label,'天使轮股东');assert.equal(offer.payload.membershipTier.standardPriceCents,20000);assert.equal(offer.payload.offer.offeredPriceCents,20000);
  for(const field of ['paymentSources','crmVerificationStatus','groupStatus','membershipTierReasonCode','honoraryDirectorReasonCode'])assert.equal(JSON.stringify(offer.payload).includes(field),false,field);
});

test('public profile edits remain pending instead of changing the published directory',async()=>{
  const before=await call('/api/my/public-profile');
  const response=await call('/api/my/public-profile-updates',{method:'POST',body:{public_display_name:'青岚演示更新',organization:'虚构研究协作组',title:'研究顾问',city:'示例城',industry_tracks:['数据工具'],interests:['知识共建'],investment_stages:['A轮'],expertise:['行业研究'],bio:'仅用于验证人工审核流程的虚构公开简介。',collaboration_preferences:['报告共创'],visibility:'visible'}});
  assert.equal(response.status,201);assert.equal(response.payload.status,'submitted');
  const after=await call('/api/my/public-profile');assert.deepEqual(after.payload.publishedProfile,before.payload.publishedProfile);
});
