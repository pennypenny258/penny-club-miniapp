'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {resolvePersistenceConfig,assertRuntimeRepositoryReady,CLOUDBASE_GATEWAY_REQUIRED_MIGRATION}=require('../src/persistence/config');
const {AGENT_OPERATIONS,StagedAgentGatewayRepository}=require('../src/persistence/agent-mvp-repository');
const {AgentMvpService}=require('../src/agent-mvp-service');

const gatewayEnvironment={NODE_ENV:'production',DATA_REPOSITORY:'cloudbase_gateway',CLOUDBASE_PG_ENV_ID:'fixture-env',CLOUDBASE_PG_SERVER_API_KEY:'fixture-server-only-key',CLOUDBASE_PG_REGION:'ap-shanghai',CLOUDBASE_PG_MIGRATIONS_APPLIED:'008_admin_session_rbac',CLOUDBASE_PG_CREDENTIAL_PURPOSE:'server_runtime'};
const published={id:'demand_fixture_1',type:'financing',anonymous_title:'匿名融资需求',anonymous_summary:'寻找产业协同与融资交流机会',public_tags:['融资','产业协同'],distribution_mode:'redacted_public',human_review_status:'approved',status:'published',owner_user_id:'must-not-leak',protected_details_ciphertext:'must-not-leak',contact:'must-not-leak'};

function harness({memberFailure=null,adminFailure=null,adapterFailure=null,rows=[published]}={}){
  const calls=[];
  const adapter={execute:async(operation,payload)=>{
    calls.push(['repository',operation,payload]);
    if(adapterFailure)throw adapterFailure;
    if(operation===AGENT_OPERATIONS.LIST_PUBLISHED)return rows;
    return {id:operation.includes('applications')?'application_fixture_1':'demand_fixture_2'};
  }};
  const repository=new StagedAgentGatewayRepository({adapter});
  const memberIdentityService={resolveAuthorizationRequest:async request=>{calls.push(['member',request]);if(memberFailure)throw memberFailure;return {id:'member_fixture_1'}}};
  const adminSessionService={authorizeAction:async input=>{calls.push(['admin',input]);if(adminFailure)throw adminFailure;return {userId:'admin_fixture_1',authorizationId:'authorization_fixture_1'}}};
  return {calls,repository,service:new AgentMvpService({memberIdentityService,adminSessionService,repository})};
}

test('CloudBase gateway baseline is exactly verified 008 while runtime activation stays blocked',()=>{
  assert.equal(CLOUDBASE_GATEWAY_REQUIRED_MIGRATION,'008_admin_session_rbac');
  const config=resolvePersistenceConfig(gatewayEnvironment);
  assert.equal(config.enabled,true);
  assert.throws(()=>resolvePersistenceConfig({...gatewayEnvironment,CLOUDBASE_PG_MIGRATIONS_APPLIED:'007_governed_materialization'}),/008_admin_session_rbac/);
  assert.throws(()=>resolvePersistenceConfig({...gatewayEnvironment,CLOUDBASE_PG_MIGRATIONS_APPLIED:'009_admin_governance'}),/008_admin_session_rbac/);
  assert.throws(()=>assertRuntimeRepositoryReady(config),error=>error.code==='CLOUDBASE_GATEWAY_RUNTIME_NOT_ACTIVATED');
});

test('004 member gate runs before any Agent read and response is a safe public projection',async()=>{
  const blocked=harness({memberFailure:Object.assign(new Error('inactive'),{statusCode:403})});
  await assert.rejects(()=>blocked.service.listOpportunities({request:{headers:{}},limit:10}),/inactive/);
  assert.equal(blocked.calls.some(call=>call[0]==='repository'),false);
  const {service,calls}=harness({rows:[published,{...published,id:'demand_fixture_3',distribution_mode:'private_match'}]});
  const response=await service.listOpportunities({request:{headers:{authorization:'Bearer fixture'}},limit:10});
  assert.deepEqual(calls.slice(0,2).map(call=>call[0]),['member','repository']);
  assert.equal(response.items.length,1);assert.equal(response.contactDisclosed,false);
  const serialized=JSON.stringify(response);
  for(const forbidden of ['owner_user_id','protected_details_ciphertext','must-not-leak','phone','payment'])assert.equal(serialized.includes(forbidden),false);
});

test('member demand and application writes only stage human review records',async()=>{
  const {service,calls}=harness();
  const demand=await service.submitDemand({request:{},input:{type:'investment',who:'我是产业投资方向会员',why:'希望寻找联合研究与项目协同机会',target:'寻找熟悉新能源供应链的产业伙伴',distributionMode:'private_match'}});
  assert.deepEqual(demand,{id:'demand_fixture_2',status:'pending_review',humanReviewRequired:true,automaticPublish:false,automaticPush:false,contactDisclosed:false});
  const staged=calls.find(call=>call[1]===AGENT_OPERATIONS.STAGE_DEMAND)[2].draft;
  assert.equal(staged.status,'pending_review');assert.equal(staged.modelStatus,'not_configured');assert.equal(staged.automaticPublish,false);
  const application=await service.applyToDemand({request:{},demandId:'demand_fixture_1',input:{who:'我是长期关注产业投资的匿名会员',why:'我的项目经验与需求描述中的产业环节高度相关',topic:'希望讨论供应链验证、合作路径和后续分工'}});
  assert.equal(application.contactDisclosed,false);assert.equal(application.deliveryMode,'operator_relay_only');
  assert.equal(calls.find(call=>call[1]===AGENT_OPERATIONS.STAGE_APPLICATION)[2].application.agentReviewStatus,'pending');
});

test('008 formal review authorization always precedes review and dispatch mutations',async()=>{
  const denied=harness({adminFailure:Object.assign(new Error('denied'),{statusCode:403})});
  await assert.rejects(()=>denied.service.reviewDemand({request:{},demandId:'demand_fixture_1',input:{decision:'approved',distributionMode:'redacted_public'},idempotencyKey:'review-fixture-1'}),/denied/);
  assert.equal(denied.calls.some(call=>call[0]==='repository'),false);
  const {service,calls}=harness();
  const review=await service.reviewDemand({request:{},demandId:'demand_fixture_1',input:{decision:'approved',distributionMode:'redacted_public',anonymousTitle:'脱敏标题',anonymousSummary:'不包含联系人或交易细节的安全摘要',publicTags:['融资']},idempotencyKey:'review-fixture-2'});
  assert.equal(review.automaticPush,false);assert.equal(review.contactDisclosed,false);
  assert.deepEqual(calls.slice(0,2).map(call=>call[0]),['admin','repository']);
  calls.length=0;
  const dispatch=await service.dispatchApplication({request:{},applicationId:'application_fixture_1',input:{decision:'shortlisted',safeReasonCode:'three_dimensions_match'},idempotencyKey:'dispatch-fixture-1'});
  assert.equal(dispatch.notificationSent,false);assert.equal(dispatch.contactDisclosed,false);assert.equal(dispatch.deliveryMode,'operator_relay_only');
  assert.deepEqual(calls.slice(0,2).map(call=>call[0]),['admin','repository']);
});

test('directional candidates enforce 3-of-4, 14-day suppression and never auto-send',async()=>{
  const {service,calls}=harness();
  await assert.rejects(()=>service.prepareDirectionalCandidate({request:{},demandId:'demand_fixture_1',targetMemberId:'member_fixture_2',criteria:{person:'投资人',role:'负责人'},idempotencyKey:'candidate-fixture-1'}),/至少需要/);
  assert.equal(calls.some(call=>call[0]==='repository'),false);
  calls.length=0;
  const result=await service.prepareDirectionalCandidate({request:{},demandId:'demand_fixture_1',targetMemberId:'member_fixture_2',criteria:{person:'投资人',organization:'产业基金',role:'负责人'},lastSentAt:new Date(Date.now()-3*86400000).toISOString(),idempotencyKey:'candidate-fixture-2'});
  assert.equal(result.suppressedBy14DayWindow,true);assert.equal(result.notificationSent,false);assert.equal(result.contactDisclosed,false);
  const staged=calls.find(call=>call[1]===AGENT_OPERATIONS.UPSERT_DIRECTIONAL_CANDIDATE)[2].candidate;
  assert.equal(staged.matchedDimensionCount,3);assert.equal(staged.automaticSend,false);
});

test('owner approval creates operator relay work and formal contract never returns contact',async()=>{
  const {service,calls}=harness();
  const owner=await service.recordOwnerDecision({request:{},applicationId:'application_fixture_1',decision:'approved_intro'});
  assert.equal(owner.status,'operator_relay_pending');assert.equal(owner.operatorRelayRequired,true);assert.equal(owner.contactDisclosed,false);
  assert.equal(calls.find(call=>call[1]===AGENT_OPERATIONS.RECORD_OWNER_DECISION)[2].decision,'approved_intro');
  calls.length=0;
  const relay=await service.recordOperatorRelay({request:{},applicationId:'application_fixture_1',decision:'relayed',idempotencyKey:'relay-fixture-1'});
  assert.equal(relay.status,'relayed');assert.equal(relay.contactDisclosed,false);assert.equal(relay.deliveryMode,'operator_relay_only');
  assert.deepEqual(calls.slice(0,2).map(call=>call[0]),['admin','repository']);
});

test('gateway failures are safe 503 and the Agent contract has no CRM write or memory fallback',async()=>{
  const {service,repository}=harness({adapterFailure:new Error('raw credential and row data')});
  await assert.rejects(()=>service.listOpportunities({request:{},limit:10}),error=>error.code==='AGENT_REPOSITORY_UNAVAILABLE'&&error.statusCode===503&&!error.message.includes('credential'));
  const readiness=repository.safeReadiness();
  assert.equal(readiness.memoryFallback,false);assert.equal(readiness.crmWrites,false);assert.equal(readiness.activated,false);
  assert.equal(readiness.automaticPublish,false);assert.equal(readiness.automaticPush,false);assert.equal(readiness.contactDisclosure,false);
  assert.equal(Object.keys(repository).some(key=>/crm/i.test(key)),false);
  await assert.rejects(()=>repository.execute('arbitrary.sql',{sql:'select *'}),/白名单/);
});
