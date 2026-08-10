'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ruleDraft,LowCostDemandMatchPlanner,safeDemandMatchingReadiness}=require('../src/demand-match-planner');

test('rules classify common demand types and never authorize automatic action',()=>{
  const result=ruleDraft({text:'寻找产业基金讨论 A 轮融资',tags:['融资'],criteria:{person:'投资人',organization:'产业基金',matter:'A轮融资'}});
  assert.equal(result.type,'fundraising');assert.equal(result.directionalCandidateEligible,true);
  assert.equal(result.humanReviewRequired,true);assert.equal(result.autoPublish,false);assert.equal(result.autoNotify,false);assert.equal(result.contactDisclosureAllowed,false);
});

test('model is reserved for low confidence, redacted, cached and limited',async()=>{
  let calls=0,seen='';const provider={structure:async input=>{calls++;seen=input.text;return {summary:'匿名结构化草稿'}}};
  const planner=new LowCostDemandMatchPlanner({provider,providerConfigured:true,dailyModelLimit:1,clock:()=>new Date('2026-08-10T00:00:00Z')});
  const input={text:'希望讨论新事项，手机 13800138000，微信: secret_id',tags:[]};
  const first=await planner.plan(input),second=await planner.plan(input),limited=await planner.plan({text:'另一个低置信度事项'});
  assert.equal(first.modelStatus,'low_confidence_structured');assert.equal(second.modelStatus,'cache_hit');assert.equal(limited.modelStatus,'daily_limit_reached');assert.equal(calls,1);
  assert.equal(seen.includes('13800138000'),false);assert.equal(seen.includes('secret_id'),false);assert.equal(JSON.stringify(first).includes('cacheKey'),false);
});

test('embedding batch only accepts bounded public-safe projections',()=>{
  const planner=new LowCostDemandMatchPlanner({maxBatchEmbeddings:2});
  assert.deepEqual(planner.prepareEmbeddingBatch([{id:'d1',publicSummary:'匿名融资机会',tags:['融资']}]),[{id:'d1',text:'匿名融资机会',tags:['融资']}]);
  assert.throws(()=>planner.prepareEmbeddingBatch([{id:'d1',publicSummary:'a'},{id:'d2',publicSummary:'b'},{id:'d3',publicSummary:'c'}]),error=>error.code==='EMBEDDING_BATCH_LIMIT');
  assert.throws(()=>planner.prepareEmbeddingBatch([{id:'d1',publicSummary:'a',phone:'13800138000'}]),error=>error.code==='PRIVATE_FIELD_NOT_ALLOWED');
  assert.equal(safeDemandMatchingReadiness().modelConfigured,false);
});
