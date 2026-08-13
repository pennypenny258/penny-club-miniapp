'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildOperatorTriage}=require('../src/agent-operator-triage');

test('operator triage recommends a reviewed distribution mode without granting automation',()=>{
  const triage=buildOperatorTriage({requestedDistributionMode:'redacted_public',humanReviewStatus:'pending',directionalEligibility:{matchedDimensions:2,eligible:false}});
  assert.equal(triage.recommendation,'redacted_public');assert.equal(triage.needsHumanReview,true);assert.equal(triage.automaticPublish,false);assert.equal(triage.automaticPush,false);assert.equal(triage.contactDisclosed,false);
});
test('private matching becomes ready for manual targeting only at three dimensions',()=>{
  const triage=buildOperatorTriage({requestedDistributionMode:'private_match',status:'private_match_approved',humanReviewStatus:'approved',directionalEligibility:{matchedDimensions:3,eligible:true}});
  assert.equal(triage.directionalEligible,true);assert.match(triage.nextAction,/人工筛选/);assert.equal(triage.operatorRelayRequired,true);
});
test('triage does not preserve unrecognised sensitive input',()=>{
  const triage=buildOperatorTriage({requestedDistributionMode:'full_public',phone:'13800000000',companyName:'敏感公司'});
  assert.equal(triage.fullPublicRequiresExplicitReview,true);assert.equal(JSON.stringify(triage).includes('13800000000'),false);assert.equal(JSON.stringify(triage).includes('敏感公司'),false);
});
