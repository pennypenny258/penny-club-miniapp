'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPreflight,normalizeFeishuWikiLink,routeSource,summarize,safeTask,retryFailedItems,disconnectSource,OfficialReadonlyAdapter,ExportPackageAdapter}=require('../src/feishu-migration');
const {sanitizers}=require('../src/server');

test('one-time preflight defaults to review and never retains root link or credentials',()=>{
  const task=createPreflight({rootUrl:'https://workspace.feishu.cn/wiki/demo-root',sourceMode:'official_readonly',scope:'all_descendants',classificationStrategy:'directory_first'},'fm-test','2026-08-04T00:00:00Z');
  assert.equal(task.defaultPublishPolicy,'pending_review');assert.equal(task.continuousSync,false);assert.equal(task.status,'awaiting_readonly_authorization');
  const safe=safeTask(task,[]);assert.equal('rootUrl' in safe,false);assert.equal(safe.rootLinkStored,false);assert.equal(safe.credentialStored,false);
  assert.throws(()=>createPreflight({sourceMode:'official_readonly',scope:'all_descendants',classificationStrategy:'directory_first',token:'forbidden'},'x','2026-08-04T00:00:00Z'),/不得携带/);
});

test('Feishu Wiki links accept query and hash then normalize to origin and node token',()=>{
  const input=['https://workspace.feishu.cn/wiki/','DemoNodeToken','?fromScene=spaceOverview#section'].join('');
  const result=normalizeFeishuWikiLink(input);
  assert.deepEqual(result,{ok:true,code:'VALID',normalizedUrl:'https://workspace.feishu.cn/wiki/DemoNodeToken',nodeToken:'DemoNodeToken'});
  const task=createPreflight({rootUrl:input,sourceMode:'official_readonly',scope:'all_descendants',classificationStrategy:'directory_first'},'fm-query','2026-08-05T00:00:00Z');
  assert.equal(task.rootLinkValidated,true);assert.equal('rootUrl' in task,false);assert.equal(JSON.stringify(task).includes('fromScene'),false);
});

test('Feishu Wiki validation reports protocol, domain, path and token failures',()=>{
  assert.deepEqual(normalizeFeishuWikiLink('http://workspace.feishu.cn/wiki/DemoNode').code,'HTTPS_REQUIRED');
  assert.deepEqual(normalizeFeishuWikiLink('https://feishu.example/wiki/DemoNode').code,'UNTRUSTED_DOMAIN');
  assert.deepEqual(normalizeFeishuWikiLink('https://workspace.feishu.cn/docs/DemoNode').code,'NOT_WIKI_LINK');
  assert.deepEqual(normalizeFeishuWikiLink('https://workspace.feishu.cn/wiki/').code,'NODE_TOKEN_MISSING');
  assert.deepEqual(normalizeFeishuWikiLink('https://workspace.feishu.cn/wiki/DemoNode/extra').code,'INVALID_WIKI_PATH');
  assert.match(normalizeFeishuWikiLink('http://workspace.feishu.cn/wiki/DemoNode').message,/HTTPS/);
  assert.match(normalizeFeishuWikiLink('https://workspace.feishu.cn/wiki/').message,/缺少节点标识/);
});

test('source adapters require server authorization or private export upload',async()=>{
  assert.deepEqual(await new OfficialReadonlyAdapter().preflight(),{ready:false,status:'awaiting_readonly_authorization',credentialEchoed:false});
  const exported=await new ExportPackageAdapter().preflight();assert.equal(exported.ready,false);assert.equal(exported.privateUploadRequired,true);
});

test('directory and content routing isolate unknown sources',()=>{
  assert.equal(routeSource('member_directory').destination,'directory_review');
  assert.equal(routeSource('recruitment').destination,'recruitment_review');
  assert.equal(routeSource('fundraising_connections').destination,'fundraising_review');
  assert.equal(routeSource('activity_notices').destination,'activity_review');
  assert.equal(routeSource('meeting_replays').destination,'replay_review');
  assert.equal(routeSource('unmapped','unknown').destination,'quarantine');
});

test('failed items can retry and source can be permanently disconnected',()=>{
  const task={sourceMode:'export_package',sourceReady:false,sourceDisconnected:false,status:'reviewing'};
  const items=[{status:'failed',failureCode:'read_failed',retryCount:0,sourceHandlePresent:true,sourceUrl:'protected'},{status:'migrated',sourceHandlePresent:true,sourceExternalId:'protected'}];
  assert.equal(retryFailedItems(task,items,'2026-08-04T00:00:00Z'),1);assert.equal(items[0].status,'queued_for_retry');assert.equal(task.status,'awaiting_export_package');
  disconnectSource(task,items,'2026-08-05T00:00:00Z');assert.equal(task.status,'source_disconnected');assert.equal(items.every(x=>x.sourceHandlePresent===false),true);assert.equal(items.some(x=>x.sourceUrl||x.sourceExternalId),false);
  assert.throws(()=>retryFailedItems(task,items),/来源已断开/);
});

test('migration reports cover every terminal and review bucket',()=>{
  const report=summarize(['pending_review','migrated','skipped','failed','needs_classification','attachment_pending'].map(status=>({status})));
  assert.deepEqual(report,{total:6,pendingReview:1,migrated:1,skipped:1,failed:1,needsClassification:1,attachmentPending:1});
});

test('member resource serializer strips all external and private references',()=>{
  const safe=sanitizers.safeResource({id:'r',title:'演示',status:'published',sourceUrl:'protected',attachmentRef:'protected',storageKey:'protected',sourceCollection:'protected',sourceStatus:'protected',migrationStatus:'protected',privateAttachments:[{storageRef:'protected'}]});
  for(const key of ['sourceUrl','attachmentRef','storageKey','sourceCollection','sourceStatus','migrationStatus','privateAttachments'])assert.equal(key in safe,false);
});
