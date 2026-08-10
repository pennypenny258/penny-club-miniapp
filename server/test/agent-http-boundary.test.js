'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const {resolveFormalAgentHttpConfig}=require('../src/agent-http-config');
const {createFormalAgentHttpHandler,MAX_BODY_BYTES}=require('../src/agent-http-handler');
const {AgentMvpService}=require('../src/agent-mvp-service');
const {AGENT_OPERATIONS,StagedAgentGatewayRepository}=require('../src/persistence/agent-mvp-repository');

const production={FORMAL_AGENT_ROUTES_ENABLED:'true',NODE_ENV:'production',DATA_REPOSITORY:'cloudbase_gateway',CLOUDBASE_PG_MIGRATIONS_APPLIED:'008_admin_session_rbac',FORMAL_ADMIN_AUTH_ENABLED:'true',WECHAT_LOGIN_ENABLED:'true',MEMBER_BINDING_MODE:'operator_confirmed_crm'};
function invoke(handler,path,{method='GET',headers={},payload,raw}={}){return new Promise((resolve,reject)=>{const req=new PassThrough();req.method=method;req.url=path;req.headers={host:'localhost',...headers};const res={statusCode:200,headers:{},writeHead(status,responseHeaders){this.statusCode=status;this.headers=responseHeaders},end(chunk=''){const text=String(chunk||'');resolve({handled:true,status:this.statusCode,headers:this.headers,body:text?JSON.parse(text):{}})}};req.on('error',reject);const pending=handler(req,res).then(value=>{if(value===false)resolve({handled:false})}).catch(reject);if(raw!==undefined)req.end(raw);else if(payload!==undefined)req.end(JSON.stringify(payload));else req.end();void pending})}

test('formal Agent HTTP config is explicit production-only and pinned to 004/008',()=>{
  assert.equal(resolveFormalAgentHttpConfig({}).enabled,false);
  for(const env of [
    {...production,NODE_ENV:'test'},
    {...production,DATA_REPOSITORY:'memory_demo'},
    {...production,DEMO_DATA_ONLY:'true'},
    {...production,CLOUDBASE_PG_MIGRATIONS_APPLIED:'009_admin_governance'},
    {...production,FORMAL_ADMIN_AUTH_ENABLED:'false'},
    {...production,WECHAT_LOGIN_ENABLED:'false'}
    ,{...production,MEMBER_BINDING_MODE:'automatic_wechat_profile'}
  ])assert.throws(()=>resolveFormalAgentHttpConfig(env));
  const config=resolveFormalAgentHttpConfig(production);assert.equal(config.memberGate,'004_wechat_identity_entitlement');assert.equal(config.adminBoundary,'008_admin_session_rbac');assert.equal(config.safeSummary.memoryFallback,false);assert.equal(config.safeSummary.crmWrites,false);
});

test('disabled formal namespace returns 503 and never falls through to demo routes',async()=>{
  const handler=createFormalAgentHttpHandler({config:resolveFormalAgentHttpConfig({})});
  const formal=await invoke(handler,'/api/formal-agent/opportunities');assert.equal(formal.status,503);assert.equal(formal.body.code,'FORMAL_AGENT_ROUTES_DISABLED');assert.equal(formal.body.memoryFallback,false);
  assert.equal((await invoke(handler,'/api/opportunities')).handled,false);
});

function realServiceHarness(){
  const calls=[];
  const repository=new StagedAgentGatewayRepository({adapter:{execute:async(operation,payload)=>{calls.push(['repository',operation,payload]);if(operation===AGENT_OPERATIONS.LIST_PUBLISHED)return [{id:'demand_public_1',type:'investment',anonymous_title:'匿名投资机会',anonymous_summary:'已人工审核的安全摘要',public_tags:['投资'],distribution_mode:'redacted_public',human_review_status:'approved',status:'published'}];return {id:operation===AGENT_OPERATIONS.STAGE_APPLICATION?'application_new_1':'demand_new_1'}}}});
  const memberIdentityService={resolveAuthorizationRequest:async request=>{calls.push(['member',request.headers.authorization]);return {id:'member_verified_1'}}};
  const adminSessionService={authorizeAction:async input=>{calls.push(['admin',input.permission,input.idempotencyKey]);return {userId:'admin_verified_1',authorizationId:'authorization_verified_1'}}};
  return {calls,service:new AgentMvpService({memberIdentityService,adminSessionService,repository})};
}

test('five formal routes map to the allowlisted Agent contract with member/admin gates first',async()=>{
  const {calls,service}=realServiceHarness(),handler=createFormalAgentHttpHandler({config:resolveFormalAgentHttpConfig(production),service}),memberHeaders={authorization:'Bearer member-fixture'};
  let response=await invoke(handler,'/api/formal-agent/opportunities?limit=20',{headers:memberHeaders});assert.equal(response.status,200);assert.equal(response.body.items[0].contactDisclosed,false);assert.deepEqual(calls.slice(0,2).map(call=>call[0]),['member','repository']);
  calls.length=0;response=await invoke(handler,'/api/formal-agent/demands',{method:'POST',headers:memberHeaders,payload:{type:'fundraising',who:'我是产业研究方向的匿名会员',why:'希望为产业项目寻找融资协同机会',target:'寻找熟悉先进制造的投资机构伙伴',distributionMode:'private_match'}});assert.equal(response.status,201);assert.equal(response.body.status,'pending_review');assert.deepEqual(calls.slice(0,2).map(call=>call[0]),['member','repository']);
  calls.length=0;response=await invoke(handler,'/api/formal-agent/demands/demand_public_1/applications',{method:'POST',headers:memberHeaders,payload:{who:'我是产业研究方向的一名匿名会员',why:'我的项目经验与该产业场景高度相关',topic:'希望讨论行业验证方法与具体合作路径'}});assert.equal(response.status,201);assert.equal(response.body.contactDisclosed,false);assert.deepEqual(calls.slice(0,2).map(call=>call[0]),['member','repository']);
  calls.length=0;response=await invoke(handler,'/api/formal-agent/admin/demands/demand_public_1/review',{method:'PATCH',headers:{authorization:'Bearer admin-fixture','idempotency-key':'review-http-1'},payload:{decision:'approved',distributionMode:'redacted_public',anonymousTitle:'匿名融资机会',anonymousSummary:'已人工脱敏的公开摘要'}});assert.equal(response.status,200);assert.deepEqual(calls.slice(0,2).map(call=>call[0]),['admin','repository']);
  calls.length=0;response=await invoke(handler,'/api/formal-agent/admin/applications/application_new_1/dispatch',{method:'PATCH',headers:{authorization:'Bearer admin-fixture','idempotency-key':'dispatch-http-1'},payload:{decision:'shortlisted',safeReasonCode:'three_dimensions_match'}});assert.equal(response.status,200);assert.equal(response.body.contactDisclosed,false);assert.deepEqual(calls.slice(0,2).map(call=>call[0]),['admin','repository']);
});

test('formal HTTP boundary rejects invalid methods, JSON, idempotency and oversized bodies safely',async()=>{
  const {service}=realServiceHarness(),handler=createFormalAgentHttpHandler({config:resolveFormalAgentHttpConfig(production),service});
  let response=await invoke(handler,'/api/formal-agent/crm/write',{method:'POST',payload:{}});assert.equal(response.status,404);assert.equal(response.body.code,'FORMAL_AGENT_ROUTE_NOT_FOUND');
  response=await invoke(handler,'/api/formal-agent/demands',{method:'POST',raw:'{bad'});assert.equal(response.status,400);assert.equal(response.body.code,'AGENT_JSON_INVALID');
  response=await invoke(handler,'/api/formal-agent/admin/demands/demand_public_1/review',{method:'PATCH',payload:{decision:'approved'}});assert.equal(response.status,400);assert.equal(response.body.code,'ADMIN_IDEMPOTENCY_REQUIRED');
  response=await invoke(handler,'/api/formal-agent/demands',{method:'POST',raw:'x'.repeat(MAX_BODY_BYTES+1)});assert.equal(response.status,413);assert.equal(response.body.code,'AGENT_REQUEST_TOO_LARGE');
});

test('unexpected dependency failures are normalized without leaking upstream details',async()=>{
  const service={listOpportunities:async()=>{throw new Error('raw database credential and row')},submitDemand:async()=>{},applyToDemand:async()=>{},reviewDemand:async()=>{},dispatchApplication:async()=>{}};
  const response=await invoke(createFormalAgentHttpHandler({config:resolveFormalAgentHttpConfig(production),service}),'/api/formal-agent/opportunities');
  assert.equal(response.status,503);assert.equal(response.body.code,'FORMAL_AGENT_UNAVAILABLE');assert.equal(JSON.stringify(response.body).includes('credential'),false);
});
