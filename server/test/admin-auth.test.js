'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ROLE_DEFINITIONS,hasPermission,permissionForRequest,authorizeAdmin,requireHighRiskConfirmation}=require('../src/admin-auth');

const req=(role='administrator',extra={})=>({headers:{'x-demo-role':role,...extra}});
test('four admin roles enforce least privilege boundaries',()=>{
  assert.deepEqual(Object.keys(ROLE_DEFINITIONS),['administrator','operator','reviewer','auditor']);
  assert.equal(hasPermission('reviewer','directory.review'),true);
  assert.equal(hasPermission('reviewer','crm.read'),false);
  assert.equal(hasPermission('auditor','audit.read'),true);
  assert.equal(hasPermission('auditor','payment.read'),false);
  assert.throws(()=>authorizeAdmin(req('reviewer'),'crm.read'),error=>error.code==='ADMIN_PERMISSION_DENIED');
});
test('route permission map separates CRM, payment, artifacts and audits',()=>{
  assert.equal(permissionForRequest('GET','/api/admin/crm-verifications'),'crm.read');
  assert.equal(permissionForRequest('GET','/api/admin/payment-evidence'),'payment.read');
  assert.equal(permissionForRequest('PATCH','/api/admin/employment-verifications/demo/review'),'artifact.review');
  assert.equal(permissionForRequest('GET','/api/admin/audit-logs'),'audit.read');
});
test('high risk actions need exact confirmation and idempotency key',()=>{
  assert.throws(()=>requireHighRiskConfirmation(req('administrator'),'resource.publish'),error=>error.code==='HIGH_RISK_CONFIRMATION_REQUIRED');
  assert.throws(()=>requireHighRiskConfirmation(req('administrator',{'x-admin-confirmation':'resource.publish'}),'resource.publish'),error=>error.code==='IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(requireHighRiskConfirmation(req('administrator',{'x-admin-confirmation':'resource.publish','idempotency-key':'demo-key'}),'resource.publish'),true);
});
