'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateDemandSubmission,publicDemandProjection,safeAdminDemandSubmission}=require('../src/demand-submission-policy');

test('three concise elements are required without forcing a long questionnaire',()=>{
  const valid=validateDemandSubmission({who:'产业研究员',why:'希望验证行业判断',target:'寻找先进制造投资人',distributionMode:'private_match'});
  assert.equal(valid.valid,true);assert.equal(valid.data.distributionMode,'private_match');
  assert.equal(validateDemandSubmission({who:'我',why:'聊聊',target:'找人',distributionMode:'redacted_public'}).valid,false);
});

test('redacted and full public projections are allowlisted while private match is absent',()=>{
  const base={id:'d1',type:'fundraising',anonymousTitle:'匿名融资需求',anonymousSummary:'安全脱敏摘要',publicTags:['融资'],status:'published',humanReviewStatus:'approved',expiresAt:'2026-12-01',companyName:'禁止返回',phone:'13800138000'};
  const redacted=publicDemandProjection({...base,distributionMode:'redacted_public',fullPublicDetails:{organization:'不应返回'}});
  assert.equal('publicDetails' in redacted,false);assert.equal(JSON.stringify(redacted).includes('13800138000'),false);
  const full=publicDemandProjection({...base,distributionMode:'full_public',fullPublicDetails:{organization:'虚构公开机构',role:'产业负责人',opportunity:'公开合作方向',contact:'禁止'}});
  assert.equal(full.publicDetails.organization,'虚构公开机构');assert.equal('contact' in full.publicDetails,false);assert.equal(full.contactDisclosed,false);
  assert.equal(publicDemandProjection({...base,distributionMode:'private_match'}),null);
});

test('admin review projection redacts contact-like input and never authorizes automation',()=>{
  const result=safeAdminDemandSubmission({requestedDistributionMode:'private_match',reviewElements:{who:'微信: secret_id',why:'联系 13800138000',target:'寻找产业投资人'}});
  assert.equal(JSON.stringify(result).includes('secret_id'),false);assert.equal(JSON.stringify(result).includes('13800138000'),false);
  assert.equal(result.humanReviewRequired,true);assert.equal(result.automaticPublish,false);assert.equal(result.automaticPush,false);assert.equal(result.contactDisclosed,false);
});
