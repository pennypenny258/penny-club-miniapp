'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {AGENT_OPERATIONS}=require('../src/persistence/agent-mvp-repository');
const {REQUIRED_RPCS,verifyAgentRpcCapabilityManifest,resolveCloudBaseAgentRpcConfig,PreparedCloudBaseAgentRpcAdapter}=require('../src/persistence/cloudbase-agent-rpc-transport');

const config=resolveCloudBaseAgentRpcConfig({});
const manifest={version:'agent-mvp-rpc-v1',migrationBaseline:'008_admin_session_rbac',rpcs:[...REQUIRED_RPCS],proofs:{serviceRoleOnly:true,clientRolesDenied:true,rlsForced:true,idempotentMutations:true,humanReviewStateMachine:true,publicProjectionAllowlist:true,directionalThreeOfFour:true,directionalDeduplicationDays:14,operatorRelayOnly:true,noContactOrCrmProjection:true}};

test('Agent RPC stays disabled until an exact read-only capability manifest is verified',()=>{
  assert.equal(config.enabled,false);assert.equal(config.safeSummary.cloudWrites,false);assert.equal(config.safeSummary.requiredRpcCount,8);
  assert.equal(verifyAgentRpcCapabilityManifest(manifest),true);
  assert.equal(verifyAgentRpcCapabilityManifest({...manifest,rpcs:manifest.rpcs.slice(1)}),false);
  assert.equal(verifyAgentRpcCapabilityManifest({...manifest,proofs:{...manifest.proofs,directionalDeduplicationDays:13}}),false);
  assert.throws(()=>resolveCloudBaseAgentRpcConfig({CLOUDBASE_AGENT_RPC_ENABLED:'true'}),/禁止启用/);
});

test('prepared adapter calls only fixed RPCs with allowlisted contact-free payloads',async()=>{
  const calls=[],adapter=new PreparedCloudBaseAgentRpcAdapter({config,invoker:{invoke:async(name,payload)=>{calls.push({name,payload});return {id:'fixture_result_1'}}}});
  await adapter.execute(AGENT_OPERATIONS.STAGE_APPLICATION,{memberId:'member_123',demandId:'demand_123',application:{statement:{who:'我是匿名产业研究会员',why:'具备相关行业经验并希望参与具体协作',topic:'希望讨论验证方法、合作路径与后续分工'},status:'submitted',contactDisclosed:false}});
  assert.equal(calls[0].name,'venture_agent_stage_application_review');
  assert.deepEqual(Object.keys(calls[0].payload.p_request.statement).sort(),['topic','who','why']);
  assert.equal(JSON.stringify(calls[0]).includes('phone'),false);
  const candidate={demandId:'demand_123',targetMemberId:'member_123',matchedDimensions:['person','organization','role'],deduplicationKey:'a'.repeat(64),suppressedBy14DayWindow:false,status:'awaiting_operator_send'};
  await adapter.execute(AGENT_OPERATIONS.UPSERT_DIRECTIONAL_CANDIDATE,{adminId:'admin_123',authorizationId:'authorization_123',candidate});
  assert.equal(calls[1].payload.p_request.automatic_send,false);assert.equal(calls[1].payload.p_request.contact_disclosed,false);
});

test('private fields, arbitrary operations and upstream details fail closed',async()=>{
  const adapter=new PreparedCloudBaseAgentRpcAdapter({config,invoker:{invoke:async()=>{throw new Error('raw credential phone row')}}});
  await assert.rejects(()=>adapter.execute(AGENT_OPERATIONS.STAGE_APPLICATION,{memberId:'member_123',demandId:'demand_123',phone:'13800000000',application:{}}),error=>error.code==='AGENT_RPC_UNAVAILABLE'&&!error.message.includes('phone'));
  await assert.rejects(()=>adapter.execute('arbitrary.sql',{sql:'select *'}),error=>error.code==='AGENT_RPC_UNAVAILABLE');
  await assert.rejects(()=>adapter.execute(AGENT_OPERATIONS.LIST_PUBLISHED,{memberId:'member_123',limit:10}),error=>error.code==='AGENT_RPC_UNAVAILABLE'&&!error.message.includes('credential'));
});
