'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const server=require('../src/server');
const call=(path,{role='administrator',method='GET',body,headers={}}={})=>new Promise((resolve,reject)=>{const req=new PassThrough();req.method=method;req.url=path;req.headers={host:'localhost','x-demo-role':role,...(body?{'content-type':'application/json'}:{}),...headers};const response={statusCode:200,headers:{},writeHead(status,responseHeaders){this.statusCode=status;this.headers=responseHeaders||{}},end(chunk=''){const text=String(chunk||'');resolve({status:this.statusCode,json:async()=>text?JSON.parse(text):{}})}};req.on('error',reject);server.emit('request',req,response);req.end(body?JSON.stringify(body):'')});

test('reviewer can access review queues but cannot read CRM or payment domains',async()=>{
  const directory=await call('/api/admin/public-profile-updates',{role:'reviewer'}),crm=await call('/api/admin/crm-verifications',{role:'reviewer'}),payment=await call('/api/admin/payment-evidence',{role:'reviewer'});
  assert.equal(directory.status,200);assert.equal(crm.status,403);assert.equal(payment.status,403);
});
test('admin list endpoints strip source, attachment, payment and deal-sensitive fields',async()=>{
  const resources=await (await call('/api/admin/resources')).json(),demands=await (await call('/api/admin/demands')).json();const payload=JSON.stringify({resources,demands});
  for(const key of ['sourceCollection','sourceUrl','attachmentRef','storageKey','privateAttachments','companyName','transactionDetails','sensitiveMaterialKey'])assert.equal(payload.includes(`"${key}"`),false,key);
});
test('high-risk routes reject missing confirmation and unknown roles fail closed',async()=>{
  const publish=await call('/api/admin/resources/r-demo-12/review',{method:'PATCH',body:{status:'published'}});assert.equal(publish.status,428);assert.equal((await publish.json()).code,'HIGH_RISK_CONFIRMATION_REQUIRED');
  const invalid=await call('/api/admin/dashboard',{role:'unknown-role'});assert.equal(invalid.status,403);
});
test('operator can queue a notification retry without external delivery',async()=>{
  const response=await call('/api/admin/notification-jobs/n-demo-4/retry',{role:'operator',method:'POST'});assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.status,'queued');assert.equal('providerMessageId' in payload,false);
});
test('Feishu readiness is safe and local execution stops before network without private storage',async()=>{
  const readinessResponse=await call('/api/admin/feishu-migration-readiness',{role:'operator'});assert.equal(readinessResponse.status,200);const readiness=await readinessResponse.json();
  assert.equal(readiness.browserAcceptsSecrets,false);assert.equal(readiness.privateStorageConfigured,false);assert.equal(readiness.nextAction,'CONFIGURE_SERVER_SECRETS');
  const serialized=JSON.stringify(readiness);for(const forbidden of ['appId','appSecret','token','rootUrl','storagePath'])assert.equal(serialized.includes(forbidden),false,forbidden);
  const preflight=await call('/api/admin/feishu-migrations/preflight',{role:'operator',method:'POST',body:{rootUrl:'https://workspace.feishu.cn/wiki/SyntheticNode',sourceMode:'official_readonly',scope:'all_descendants',classificationStrategy:'directory_first'}});assert.equal(preflight.status,201);const task=await preflight.json();
  const start=await call(`/api/admin/feishu-migrations/${task.id}/start`,{role:'operator',method:'POST'});assert.equal(start.status,409);assert.equal((await start.json()).code,'PRIVATE_STORAGE_NOT_CONFIGURED');
});
