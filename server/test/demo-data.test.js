'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/store');
const { isMembershipActive } = require('../src/domain');
const { sanitizers } = require('../src/server');
const fs = require('node:fs');
const path = require('node:path');

test('synthetic fixtures cover operational states without protected values', () => {
  const userStates = new Set(Object.values(store.users).map(x => x.status));
  for (const state of ['active','expired','pending_verification','suspended']) assert.ok(userStates.has(state));
  for (const status of ['submitted','pending_review','returned_for_revision','published']) assert.ok(store.publicProfileUpdates.some(x => x.status === status));
  for (const status of ['registration_open','waitlist_open','in_progress','ended','cancelled']) assert.ok(store.activities.some(x => x.status === status));
  for (const type of ['recruitment','fundraising','ma']) assert.ok(store.demands.some(x => x.type === type));
  assert.equal(store.resources.length >= 10, true);
  assert.equal(store.importBatches.length >= 4, true);
  assert.equal(store.audits.length >= 5, true);
  const serialized = JSON.stringify(store);
  assert.doesNotMatch(serialized, /1[3-9]\d{9}/);
  assert.equal(store.activities.every(x => !x.meetingLink), true);
  assert.equal(store.employmentVerifications.every(x => x.artifactStored === false && !x.storageKey && !x.fileName), true);
});

test('member response serializers keep CRM, payment, artifact and demand-sensitive data private', () => {
  const members = store.directoryProfiles.filter(x=>x.consentStatus==='granted'&&x.reviewStatus==='approved'&&x.visibility!=='hidden').map(sanitizers.safeDirectoryProfile);
  const demands = store.demands.filter(x=>x.status==='published').map(sanitizers.safeDemand);
  const employment = store.employmentVerifications.filter(x=>x.userId==='u-active').map(sanitizers.safeEmploymentSummary);
  const publicPayload = JSON.stringify({members,demands,employment});
  for (const forbidden of ['companyName','transactionDetails','crmVerificationStatus','latestPaymentEvidenceStatus','storageKey','fileName','mimeType','sizeBytes']) assert.equal(publicPayload.includes(`"${forbidden}"`), false, forbidden);
  assert.equal(members.every(x => x.contactMode === 'request_only'), true);
  assert.equal(employment.every(x => x.artifactStored === false), true);
});

test('admin list serializers expose workflow state but not protected source or deal fields',()=>{
  const resources=store.resources.map(sanitizers.safeAdminResource),demands=store.demands.map(sanitizers.safeAdminDemand),ai=store.aiReviews.map(sanitizers.safeAiReview);
  const payload=JSON.stringify({resources,demands,ai});
  for(const forbidden of ['sourceCollection','sourceUrl','attachmentRef','storageKey','privateAttachments','companyName','transactionDetails','sensitiveMaterialKey','rawResult','rawContent','prompt'])assert.equal(payload.includes(`"${forbidden}"`),false,forbidden);
  assert.equal(resources.some(x=>'sourceStatus' in x),true);
  assert.equal(demands.some(x=>'humanReviewStatus' in x),true);
});

test('inactive identities remain ineligible for controlled member data', () => {
  for (const identity of ['expired','guest','frozen']) assert.equal(isMembershipActive(store.users[identity]), false, identity);
});

test('admin navigation is grouped into six business modules and keeps queue entries', () => {
  const source = fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  for (const key of ['workbench','members','materials','activities','matching','settings']) assert.match(source,new RegExp(`key:'${key}'`));
  for (const queue of ['public-profile-updates','employment-verifications','import-items','notification-jobs','applications','audit-logs']) assert.match(source,new RegExp(queue));
  const navigation=source.slice(0,source.indexOf('const nav='));
  assert.equal((navigation.match(/\{key:'/g)||[]).length,6);
});
