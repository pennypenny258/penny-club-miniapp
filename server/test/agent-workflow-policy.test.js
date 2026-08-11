'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {reviewDemandTransition,applicationDraft,applicationTransition,directionalCandidate,DEDUPLICATION_DAYS}=require('../src/agent-workflow-policy');

test('human review is the only path to three distribution modes and private match has no public projection',()=>{
  const redacted=reviewDemandTransition({decision:'approved',distributionMode:'redacted_public',publicInput:{anonymousTitle:'匿名融资机会',anonymousSummary:'已人工删除公司、姓名和联系信息的安全摘要',publicTags:['融资','产业']}});
  assert.equal(redacted.nextStatus,'published');assert.equal(redacted.automaticPublish,false);assert.equal(redacted.automaticPush,false);assert.equal(redacted.contactDisclosed,false);
  assert.deepEqual(Object.keys(redacted.publicProjection).sort(),['anonymousSummary','anonymousTitle','contactDisclosed','distributionMode','publicTags','status'].sort());
  const privateOnly=reviewDemandTransition({decision:'approved',distributionMode:'private_match'});
  assert.equal(privateOnly.nextStatus,'private_match_approved');assert.equal(privateOnly.publicProjection,null);
  const full=reviewDemandTransition({decision:'approved',distributionMode:'full_public',publicInput:{anonymousTitle:'公开合作机会',anonymousSummary:'仅包含运营确认可以公开的业务说明',publicDetails:{organization:'匿名机构',role:'产业负责人',opportunity:'合作交流'},phone:'13800000000'}});
  assert.equal(full.publicProjection.contactDisclosed,false);assert.equal(JSON.stringify(full).includes('13800000000'),false);
  assert.throws(()=>reviewDemandTransition({currentStatus:'rejected',decision:'approved',distributionMode:'full_public'}),/状态转换/);
});

test('directional candidates require 3-of-4 and suppress repeat reminders for 14 days',()=>{
  const now=new Date('2026-08-11T00:00:00.000Z');
  assert.throws(()=>directionalCandidate({demandId:'demand_123',targetMemberId:'member_123',criteria:{person:'投资人',role:'负责人'},now}),/至少需要/);
  const eligible=directionalCandidate({demandId:'demand_123',targetMemberId:'member_123',criteria:{person:'投资人',organization:'产业基金',role:'负责人'},now});
  assert.equal(eligible.matchedDimensionCount,3);assert.equal(eligible.status,'awaiting_operator_send');assert.equal(eligible.automaticSend,false);assert.equal(eligible.contactDisclosed,false);assert.match(eligible.deduplicationKey,/^[a-f0-9]{64}$/);
  const duplicate=directionalCandidate({demandId:'demand_123',targetMemberId:'member_123',criteria:{person:'投资人',organization:'产业基金',role:'负责人',matter:'项目交流'},lastSentAt:'2026-08-01T00:00:00.000Z',now});
  assert.equal(DEDUPLICATION_DAYS,14);assert.equal(duplicate.suppressedBy14DayWindow,true);assert.equal(duplicate.status,'duplicate_suppressed');assert.equal(duplicate.nextEligibleAt,'2026-08-15T00:00:00.000Z');
});

test('three-part applications remain contact-free and approved introductions become operator relay work',()=>{
  const draft=applicationDraft({who:'我是长期关注产业投资的匿名会员',why:'我的项目经验与该需求的产业环节高度相关',topic:'希望讨论验证方法、合作路径与后续分工',phone:'13800000000'});
  assert.deepEqual(Object.keys(draft.statement).sort(),['topic','who','why']);assert.equal(JSON.stringify(draft).includes('13800000000'),false);assert.equal(draft.deliveryMode,'operator_relay_only');
  const approved=applicationTransition({currentStatus:'shortlisted',decision:'approved_intro'});
  assert.equal(approved.nextStatus,'operator_relay_pending');assert.equal(approved.operatorRelayRequired,true);assert.equal(approved.automaticContactRelease,false);
  const relayed=applicationTransition({currentStatus:'operator_relay_pending',decision:'relayed'});
  assert.equal(relayed.nextStatus,'relayed');assert.equal(relayed.contactDisclosed,false);
  assert.throws(()=>applicationTransition({currentStatus:'submitted',decision:'approved_intro'}),/状态转换/);
});
