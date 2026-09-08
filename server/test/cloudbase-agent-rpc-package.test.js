'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),childProcess=require('node:child_process');
const {REQUIRED_RPCS,verifyAgentRpcCapabilityManifest}=require('../src/persistence/cloudbase-agent-rpc-transport');
const root=path.join(__dirname,'../..'),dir=path.join(root,'server/db/future/agent-rpc');
const read=file=>fs.readFileSync(path.join(dir,file),'utf8'),sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const manifest=JSON.parse(read('manifest.json'));

test('Agent future package is isolated, unapplied and pins canonical 004/008',()=>{
  assert.equal(manifest.status,'future_not_applied');assert.equal(manifest.runtimeEnablementAllowed,false);assert.equal(verifyAgentRpcCapabilityManifest(manifest),true);assert.deepEqual(manifest.rpcs,REQUIRED_RPCS);
  assert.equal(sha('server/db/migrations/004_wechat_identity_entitlement.sql'),'89651f91578a44d1f5fd78e8039c7ded587bbfae3a18764ee4bb3b2090d5a621');
  assert.equal(sha('server/db/migrations/008_admin_session_rbac.sql'),'1d29f1997e3d63322ae56a0fef78b559d41028e2d278527ffdc0d51e1652bd3d');
  for(const [file,expected] of Object.entries(manifest.checksums))assert.equal(sha(file),expected);
});

test('eight fixed RPCs are service-role only with allowlisted JSON inputs',()=>{
  const sql=read('013_agent_rpc_008_baseline.sql');assert.equal(manifest.rpcs.length,8);assert.match(sql,/current_setting\('request\.jwt\.claims',true\)/);assert.match(sql,/claims->>'role'<>'service_role'/);
  for(const rpc of manifest.rpcs){const start=sql.indexOf(`FUNCTION public.${rpc}(p_request jsonb)`),end=sql.indexOf('CREATE OR REPLACE FUNCTION public.',start+1),body=sql.slice(start,end<0?sql.length:end);assert.notEqual(start,-1);assert.match(body,/SECURITY DEFINER/);assert.match(body,/SET search_path=venture_private,pg_catalog/);assert.match(body,/assert_agent_service_role/);assert.match(body,/assert_agent_keys/);}
  assert.match(sql,/FROM PUBLIC, anon, authenticated/);assert.match(sql,/TO service_role/);
});

test('database enforces idempotency, human review, 3-of-4, 14 days and relay-only disclosure',()=>{
  const sql=read('013_agent_rpc_008_baseline.sql');assert.match(sql,/idempotency_key_hash char\(64\) PRIMARY KEY/);assert.match(sql,/RETURN existing\.safe_result\|\|jsonb_build_object\('idempotent',true\)/);assert.match(sql,/permission_code='demand\.review'/);assert.match(sql,/SET status='consumed'/);assert.match(sql,/jsonb_array_length\(dimensions\) NOT BETWEEN 3 AND 4/);assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/demand_id=demand_value AND target_member_id=target_value/);assert.match(sql,/interval '14 days'/);assert.match(sql,/duplicate_suppressed/);assert.match(sql,/delivery_mode='operator_relay_only'/);assert.match(sql,/contact_disclosed=false/);assert.doesNotMatch(sql,/last_sent_at/);
  for(const forbidden of ['phone_number','raw_phone','raw_openid','wechat_id','email_address','crm_verifications','payment_evidence'])assert.doesNotMatch(sql,new RegExp(forbidden,'i'));
});

test('Agent package offline checker passes without database or network access',()=>{
  const output=childProcess.execFileSync(process.execPath,['scripts/cloudbase-agent-rpc-check.js'],{cwd:root,encoding:'utf8'});assert.match(output,/离线检查通过/);assert.match(output,/未执行 SQL/);
});
