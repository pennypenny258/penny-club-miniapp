'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveWechatIdentityConfig,hashWechatSubject}=require('../src/auth/wechat-config');
const {WechatCodeExchangeClient,OpaqueMemberSessionManager,VerifiedMemberIdentityService}=require('../src/auth/wechat-identity');

const key=value=>Buffer.alloc(32,value).toString('base64');
const production={NODE_ENV:'production',DATA_REPOSITORY:'cloudbase_gateway',WECHAT_LOGIN_ENABLED:'true',MEMBER_IDENTITY_PROVIDER:'external_verified_session',MEMBER_SESSION_REVOCATION_STORE:'external_persistent',WECHAT_MINIPROGRAM_APP_ID:'wx1234567890abcdef',WECHAT_MINIPROGRAM_APP_SECRET:'fixture-server-app-secret',WECHAT_IDENTITY_SUBJECT_HMAC_KEY:key(7),MEMBER_SESSION_ENCRYPTION_KEY:key(9),MEMBER_SESSION_ISSUER:'venture-club-node',MEMBER_SESSION_AUDIENCE:'venture-club-miniapp',MEMBER_SESSION_TTL_SECONDS:'900'};
const config=()=>resolveWechatIdentityConfig(production);
const activeRow={subject_hash:'a'.repeat(64),member_id:'member-fixture',account_active:true,membership_start:'2025-01-01T00:00:00.000Z',membership_end:'2099-01-01T00:00:00.000Z',crm_verified:true,payment_verified:true,payment_reviewed_at:'2026-01-01T00:00:00.000Z',group_active:true,decision_active:true,entitlement_version:'fixture-v1'};
const sessions=(identityConfig=config(),extra={})=>new OpaqueMemberSessionManager({config:identityConfig,revocationStore:{isRevoked:async()=>false},...extra});

test('real WeChat identity configuration is explicit, server-only and fail closed',()=>{
  assert.equal(resolveWechatIdentityConfig({}).enabled,false);
  assert.throws(()=>resolveWechatIdentityConfig({WECHAT_MINIPROGRAM_APP_SECRET:'accidental'}),/拒绝静默保留/);
  for(const field of ['WECHAT_MINIPROGRAM_APP_SECRET','WECHAT_IDENTITY_SUBJECT_HMAC_KEY','MEMBER_SESSION_ENCRYPTION_KEY','MEMBER_SESSION_REVOCATION_STORE']){const env={...production};delete env[field];assert.throws(()=>resolveWechatIdentityConfig(env),new RegExp(field));}
  assert.throws(()=>resolveWechatIdentityConfig({...production,DEMO_DATA_ONLY:'true'}),/匿名 staging/);
  assert.throws(()=>resolveWechatIdentityConfig({...production,MEMBER_SESSION_REVOCATION_STORE:'memory'}),/external_persistent/);
  const resolved=config();assert.equal(resolved.safeSummary.credentialsExposed,false);assert.equal(JSON.stringify(resolved.safeSummary).includes('fixture-server-app-secret'),false);
});

test('code exchange validates input, uses the official endpoint and never returns session_key',async()=>{
  const calls=[];const client=new WechatCodeExchangeClient({config:config(),fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,text:async()=>JSON.stringify({openid:'fixture-open-subject',session_key:'must-not-propagate'})}}});
  await assert.rejects(()=>client.exchange('bad code'),error=>error.code==='WECHAT_CODE_INVALID');assert.equal(calls.length,0);
  const result=await client.exchange('fixture_code_123');assert.deepEqual(result,{subjectType:'openid',subject:'fixture-open-subject'});assert.equal(calls[0].url.origin,'https://api.weixin.qq.com');assert.equal(calls[0].url.pathname,'/sns/jscode2session');assert.equal(calls[0].options.redirect,'error');assert.equal(JSON.stringify(result).includes('session_key'),false);
  const rejected=new WechatCodeExchangeClient({config:config(),fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({errcode:40029,errmsg:'private upstream detail'})})});const error=await rejected.exchange('fixture_code_456').catch(value=>value);assert.equal(error.code,'WECHAT_CODE_REJECTED');assert.doesNotMatch(JSON.stringify(error),/private upstream detail|fixture-server-app-secret/);
});
test('code exchange keeps app-scoped openid stable even when unionid is conditionally present',async()=>{const client=new WechatCodeExchangeClient({config:config(),fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({openid:'stable-openid',unionid:'conditional-unionid',session_key:'discarded'})})});assert.deepEqual(await client.exchange('fixture_code_789'),{subjectType:'openid',subject:'stable-openid'})});

test('subject mapping is keyed, app-scoped and never stores the raw identifier',()=>{const first=hashWechatSubject({config:config(),subjectType:'openid',subject:'raw-fixture-subject'});const second=hashWechatSubject({config:config(),subjectType:'unionid',subject:'raw-fixture-subject'});assert.match(first.subjectHash,/^[0-9a-f]{64}$/);assert.notEqual(first.subjectHash,second.subjectHash);assert.equal(JSON.stringify(first).includes('raw-fixture-subject'),false)});

test('opaque sessions enforce authenticated encryption, expiry and revocation',async()=>{
  let now=1_800_000_000_000,revoked=false;const manager=sessions(config(),{clock:()=>now,randomBytes:size=>Buffer.alloc(size,3),revocationStore:{isRevoked:async()=>revoked}});const token=manager.issue({memberId:'member-fixture',subjectHash:'a'.repeat(64),entitlementVersion:'v1'});assert.equal(token.includes('member-fixture'),false);assert.equal((await manager.verify(token)).sub,'member-fixture');const parts=token.split('.'),cipher=parts[2];parts[2]=`${cipher[0]==='A'?'B':'A'}${cipher.slice(1)}`;await assert.rejects(()=>manager.verify(parts.join('.')),error=>error.code==='VERIFIED_SESSION_REQUIRED');revoked=true;await assert.rejects(()=>manager.verify(token),error=>error.code==='VERIFIED_SESSION_REQUIRED');revoked=false;now+=901000;await assert.rejects(()=>manager.verify(token),error=>error.code==='VERIFIED_SESSION_REQUIRED');
});

test('unknown subject and gateway failures cannot issue a session or fall back to demo',async()=>{
  const identityConfig=config();const exchanged={exchange:async()=>({subjectType:'openid',subject:'unbound-subject'})};
  const missing=new VerifiedMemberIdentityService({config:identityConfig,exchangeClient:exchanged,repository:{kind:'cloudbase_gateway',resolveMemberEntitlement:async()=>null},sessionManager:sessions(identityConfig)});await assert.rejects(()=>missing.loginWithCode('fixture_code_123'),error=>error.code==='IDENTITY_NOT_BOUND');
  const failed=new VerifiedMemberIdentityService({config:identityConfig,exchangeClient:exchanged,repository:{kind:'cloudbase_gateway',resolveMemberEntitlement:async()=>{throw new Error('private db response')}},sessionManager:sessions(identityConfig)});const error=await failed.loginWithCode('fixture_code_123').catch(value=>value);assert.equal(error.statusCode,503);assert.doesNotMatch(JSON.stringify(error),/private db response/);
});
test('a bound active member receives only a short-lived opaque bearer session',async()=>{const identityConfig=config(),exchangeClient={exchange:async()=>({subjectType:'openid',subject:'bound-subject'})},expected=hashWechatSubject({config:identityConfig,subjectType:'openid',subject:'bound-subject'}).subjectHash;const service=new VerifiedMemberIdentityService({config:identityConfig,exchangeClient,repository:{kind:'cloudbase_gateway',resolveMemberEntitlement:async({subjectHash})=>({...activeRow,subject_hash:subjectHash})},sessionManager:sessions(identityConfig)});const result=await service.loginWithCode('fixture_code_123');assert.equal(result.tokenType,'Bearer');assert.equal(result.expiresIn,900);assert.equal(result.accessToken.includes(expected),false);assert.equal(JSON.stringify(result).includes('bound-subject'),false)});

test('verified session runs before a fresh entitlement query and membership is recomputed every request',async()=>{
  const identityConfig=config(),events=[];let row={...activeRow};const sessionManager=sessions(identityConfig);const repository={kind:'cloudbase_gateway',resolveMemberEntitlement:async()=>{events.push('entitlement');return row}};const service=new VerifiedMemberIdentityService({config:identityConfig,exchangeClient:{exchange:async()=>({subjectType:'openid',subject:'fixture'})},repository,sessionManager});
  const subjectHash='a'.repeat(64),token=sessionManager.issue({memberId:activeRow.member_id,subjectHash,entitlementVersion:'v1'});const originalVerify=sessionManager.verify.bind(sessionManager);sessionManager.verify=async value=>{events.push('session');return originalVerify(value)};
  const member=await service.resolveAuthorizationRequest({headers:{authorization:`Bearer ${token}`}});assert.equal(member.id,'member-fixture');assert.deepEqual(events,['session','entitlement']);
  events.length=0;row={...row,group_active:false};await assert.rejects(()=>service.resolveAuthorizationRequest({headers:{authorization:`Bearer ${token}`}}),error=>error.code==='MEMBERSHIP_REQUIRED');assert.deepEqual(events,['session','entitlement']);
  await assert.rejects(()=>service.resolveAuthorizationRequest({headers:{authorization:`Bearer ${token}`,'x-demo-user':'member-fixture'}}),error=>error.code==='VERIFIED_SESSION_REQUIRED');await assert.rejects(()=>service.resolveAuthorizationRequest({headers:{authorization:`Bearer ${token}`,cookie:'demo=1'}}),error=>error.code==='VERIFIED_SESSION_REQUIRED');
});
test('an entitlement response for a different subject fails as unavailable',async()=>{const identityConfig=config(),subjectHash='a'.repeat(64),sessionManager=sessions(identityConfig),token=sessionManager.issue({memberId:'member-fixture',subjectHash,entitlementVersion:'v1'});const service=new VerifiedMemberIdentityService({config:identityConfig,exchangeClient:{exchange:async()=>({subjectType:'openid',subject:'fixture'})},repository:{kind:'cloudbase_gateway',resolveMemberEntitlement:async()=>({...activeRow,subject_hash:'b'.repeat(64)})},sessionManager});await assert.rejects(()=>service.resolveAuthorizationRequest({headers:{authorization:`Bearer ${token}`}}),error=>error.code==='MEMBER_IDENTITY_UNAVAILABLE'&&error.statusCode===503)});
