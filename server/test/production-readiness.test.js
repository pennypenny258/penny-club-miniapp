'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PassThrough}=require('node:stream');
const server=require('../src/server');
const {CANARY_CHECKS,buildUnifiedProductionReadiness}=require('../src/production-readiness');

const key=value=>Buffer.alloc(32,value).toString('base64');
const completeEnvironment={NODE_ENV:'production',DEPLOYMENT_PROFILE:'cloudbase_production',DEMO_DATA_ONLY:'false',DATA_REPOSITORY:'cloudbase_gateway',CLOUDBASE_PG_MIGRATIONS_APPLIED:'008_admin_session_rbac',CLOUDBASE_MEMBER_BINDING_RPC_MIGRATION_APPLIED:'012_member_binding_rpc_008_baseline',WECHAT_LOGIN_ENABLED:'true',MEMBER_IDENTITY_PROVIDER:'external_verified_session',MEMBER_BINDING_MODE:'crm_exact_match_or_operator_review',MEMBER_SESSION_REVOCATION_STORE:'external_persistent',WECHAT_MINIPROGRAM_APP_ID:'wx1234567890abcdef',WECHAT_MINIPROGRAM_APP_SECRET:'fixture-app-secret-never-output',WECHAT_IDENTITY_SUBJECT_HMAC_KEY:key(1),MEMBER_SESSION_ENCRYPTION_KEY:key(2),MEMBER_SESSION_ISSUER:'fixture-issuer',MEMBER_SESSION_AUDIENCE:'fixture-audience',FORMAL_ADMIN_AUTH_ENABLED:'true',ADMIN_SESSION_HASH_KEY:key(3),ADMIN_SUBJECT_HMAC_KEY:key(4),ADMIN_SESSION_STORE:'external_persistent'};
const completeCanary=Object.fromEntries(CANARY_CHECKS.map(([name])=>[name,true]));

function requestReadiness(){return new Promise((resolve,reject)=>{const req=new PassThrough();req.method='GET';req.url='/api/admin/production-readiness';req.headers={host:'localhost','x-demo-role':'administrator'};const response={statusCode:200,writeHead(status){this.statusCode=status},end(chunk=''){try{resolve({status:this.statusCode,body:JSON.parse(String(chunk||'{}'))})}catch(error){reject(error)}}};req.on('error',reject);server.emit('request',req,response);req.end()})}

test('default readiness clearly blocks 012, RPC manifests, WeChat server identity and routes',()=>{
  const readiness=buildUnifiedProductionReadiness({environment:{}});
  assert.equal(readiness.status,'blocked_safe');assert.equal(readiness.activated,false);assert.equal(readiness.cloudWritesEnabled,false);assert.equal(readiness.formalRoutesEnabled,false);assert.equal(readiness.memoryFallback,false);assert.equal(readiness.demoFallback,false);
  for(const blocker of ['future_012_not_applied','binding_rpc_manifests_unverified','agent_rpc_manifest_unverified','wechat_server_secrets_missing_or_unverified','safe_canary_not_completed','formal_routes_disabled'])assert.equal(readiness.blockers.includes(blocker),true,blocker);
  assert.deepEqual(readiness.missingSecretCategories.wechatServer,['miniProgramAppSecret','subjectHmacKey','sessionEncryptionKey']);
  assert.equal(readiness.canaryChecklist.every(item=>item.status==='not_run'&&item.containsPersonalData===false),true);
});

test('stages cannot be skipped and secret values never appear in readiness',()=>{
  const premature=buildUnifiedProductionReadiness({environment:{},bindingManifestVerified:true,matchTokenManifestVerified:true,agentManifestVerified:true,formalBindingRoutesEnabled:true,formalAgentRoutesEnabled:true,canaryEvidence:completeCanary});
  assert.equal(premature.stages[0].passed,false);assert.equal(premature.stages.slice(1).every(item=>item.status==='blocked'),true);assert.equal(premature.status,'blocked_safe');
  const complete=buildUnifiedProductionReadiness({environment:completeEnvironment,bindingManifestVerified:true,matchTokenManifestVerified:true,agentManifestVerified:true,formalBindingRoutesEnabled:true,formalAgentRoutesEnabled:true,canaryEvidence:completeCanary});
  assert.equal(complete.status,'ready_for_guarded_activation');assert.equal(complete.stages.every(item=>item.passed),true);assert.equal(complete.activated,false);assert.equal(complete.cloudWritesEnabled,false);
  const serialized=JSON.stringify(complete);for(const secret of [completeEnvironment.WECHAT_MINIPROGRAM_APP_SECRET,completeEnvironment.WECHAT_IDENTITY_SUBJECT_HMAC_KEY,completeEnvironment.MEMBER_SESSION_ENCRYPTION_KEY,completeEnvironment.ADMIN_SESSION_HASH_KEY])assert.equal(serialized.includes(secret),false);
});

test('HTTP endpoint and admin UI expose only safe canary status with no credential input',async()=>{
  const response=await requestReadiness();assert.equal(response.status,200);assert.equal(response.body.status,'blocked_safe');assert.equal(response.body.blockers.includes('future_012_not_applied'),true);assert.equal(response.body.failureBehavior.databaseUnavailable,'503_no_fallback');
  const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');for(const text of ['/api/admin/production-readiness','CRM 身份绑定 + Agent 分阶段启用','匿名安全 Canary 清单','本页只显示布尔状态'])assert.equal(source.includes(text),true,text);
  assert.equal(/type=["']password["']/.test(source.slice(source.indexOf('async function renderReleaseChecks'),source.indexOf('async function loadView'))),false);
});
