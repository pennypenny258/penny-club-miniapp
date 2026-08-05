'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EnvFeishuSecretProvider,FeishuOpenApiClient,FeishuConnectionService,validateConnectionTestInput,buildMigrationReadiness,OfficialFeishuReadonlyAdapter,executeOfficialMigration}=require('../src/feishu-connection');
const {assertNoCredentials}=require('../src/feishu-migration');

const jsonResponse=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const configuredProvider={getCredentials:async()=>({configured:true,appId:'app-placeholder',appSecret:'secret-placeholder'})};

test('server connection reports not configured without reading frontend values',async()=>{
  const client=new FeishuOpenApiClient({secretProvider:new EnvFeishuSecretProvider({}),fetchImpl:async()=>{throw new Error('must not call network')}});
  const service=new FeishuConnectionService(client);const status=await service.getSafeStatus();
  assert.deepEqual(status,{status:'not_configured',configured:false,lastTestAt:null,errorCategory:null});
  assert.equal(validateConnectionTestInput({}),true);assert.throws(()=>validateConnectionTestInput({appId:'forbidden'}),/不接受/);
  assert.throws(()=>assertNoCredentials({app_id:'forbidden'}),/不得携带/);assert.throws(()=>assertNoCredentials({appSecret:'forbidden'}),/不得携带/);
});

test('test connection classifies invalid credentials without leaking response or secrets',async()=>{
  const client=new FeishuOpenApiClient({secretProvider:configuredProvider,fetchImpl:async()=>jsonResponse({code:10003,msg:'upstream detail'},400)});
  const result=await new FeishuConnectionService(client).testConnection();const serialized=JSON.stringify(result);
  assert.equal(result.status,'connection_failed');assert.equal(result.errorCategory,'invalid_credentials');
  for(const forbidden of ['app-placeholder','secret-placeholder','upstream detail','tenant_access_token'])assert.equal(serialized.includes(forbidden),false);
});

test('test connection returns safe success with an injected mock only',async()=>{
  const calls=[];const client=new FeishuOpenApiClient({secretProvider:configuredProvider,fetchImpl:async(url,options)=>{calls.push({url,method:options.method});return jsonResponse({code:0,tenant_access_token:'token-placeholder',expire:7200})}});
  const result=await new FeishuConnectionService(client).testConnection();
  assert.equal(result.status,'connection_success');assert.equal(result.configured,true);assert.equal(JSON.stringify(result).includes('token-placeholder'),false);
  assert.equal(calls.length,1);assert.match(calls[0].url,/tenant_access_token\/internal$/);
});

test('readonly adapter traverses Wiki, reads docx and stores media privately with mocks',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,method:options.method});
    if(url.endsWith('/tenant_access_token/internal'))return jsonResponse({code:0,tenant_access_token:'token-placeholder',expire:7200});
    if(url.includes('/wiki/v2/spaces/get_node'))return jsonResponse({code:0,data:{node:{space_id:'space-placeholder',node_token:'root-placeholder',obj_token:'doc-placeholder',obj_type:'docx',title:'演示文档',has_child:false}}});
    if(url.includes('/raw_content'))return jsonResponse({code:0,data:{content:'演示正文'}});
    if(url.includes('/blocks'))return jsonResponse({code:0,data:{items:[{image:{token:'media-placeholder'}}],has_more:false}});
    if(url.includes('/medias/'))return new Response(new Uint8Array([1,2,3]),{status:200,headers:{'content-type':'image/png','content-length':'3'}});
    throw new Error('unexpected mock route');
  };
  const stored=[];const privateStorage={configured:true,putPrivate:async file=>{stored.push({bytes:file.bytes.length,mimeType:file.mimeType});return {storageRef:'private:opaque-placeholder'}}};
  const client=new FeishuOpenApiClient({secretProvider:configuredProvider,fetchImpl});const adapter=new OfficialFeishuReadonlyAdapter({client,privateStorage});
  const execution=await executeOfficialMigration({task:{rootLinkValidated:true},rootNodeToken:'root-placeholder',adapter,routeNode:()=>({destination:'knowledge_review'})});
  assert.equal(execution.items.length,1);assert.equal(execution.items[0].status,'pending_review');assert.equal(execution.items[0].destination,'knowledge_review');
  assert.deepEqual(stored,[{bytes:3,mimeType:'image/png'}]);assert.equal(execution.items[0].privateAttachments[0].storageRef,'private:opaque-placeholder');
  assert.equal(calls.some(x=>x.url.includes('/raw_content')),true);assert.equal(calls.some(x=>x.url.includes('/medias/')),true);
});

test('migration execution refuses missing server credentials before any network call',async()=>{
  let called=false;const client=new FeishuOpenApiClient({secretProvider:new EnvFeishuSecretProvider({}),fetchImpl:async()=>{called=true;throw new Error('unexpected')}});const adapter=new OfficialFeishuReadonlyAdapter({client});
  await assert.rejects(()=>executeOfficialMigration({task:{rootLinkValidated:true},rootNodeToken:'root-placeholder',adapter,routeNode:()=>({destination:'knowledge_review'})}),error=>error.category==='not_configured');
  assert.equal(called,false);
});

test('migration readiness distinguishes configuration, identity test and Wiki authorization',()=>{
  const missing=buildMigrationReadiness({connection:{status:'not_configured',configured:false},privateStorageConfigured:false,environmentName:'development'});
  assert.equal(missing.nextAction,'CONFIGURE_SERVER_SECRETS');assert.equal(missing.canRunOfficialMigration,false);assert.equal(missing.browserAcceptsSecrets,false);
  const failed=buildMigrationReadiness({connection:{status:'connection_failed',configured:true,errorCategory:'invalid_credentials'},privateStorageConfigured:true});
  assert.equal(failed.nextAction,'FIX_CONNECTION');assert.equal(failed.connection.errorCategory,'invalid_credentials');
  const ready=buildMigrationReadiness({connection:{status:'connection_success',configured:true,lastTestAt:'2026-08-05T00:00:00Z'},privateStorageConfigured:true,environmentName:'production'});
  assert.equal(ready.canCreateOfficialTask,true);assert.equal(ready.canRunOfficialMigration,true);assert.equal(ready.nextAction,'GRANT_WIKI_AND_CREATE_TASK');
  assert.equal(ready.steps.find(x=>x.key==='wiki_authorization').status,'operator_action');
  const serialized=JSON.stringify(ready);for(const forbidden of ['appSecret','tenant_access_token','authorizationHeader','rootUrl'])assert.equal(serialized.includes(forbidden),false);
});
