'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {REQUIRED_RPCS,verifyAgentRpcCapabilityManifest}=require('../server/src/persistence/cloudbase-agent-rpc-transport');
const root=path.join(__dirname,'..'),dir='server/db/future/agent-rpc',manifest=JSON.parse(fs.readFileSync(path.join(root,dir,'manifest.json'),'utf8')),issues=[];
const read=file=>fs.readFileSync(path.join(root,file),'utf8'),hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const stripComments=text=>text.replace(/--.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');
const stripStrings=text=>stripComments(text).replace(/'(?:''|[^'])*'/g,"''");
for(const [file,expected] of Object.entries(manifest.checksums))if(hash(read(file))!==expected)issues.push(`${file} 校验和不匹配`);
if(manifest.status!=='future_not_applied'||manifest.runtimeEnablementAllowed!==false)issues.push('未来包必须明确不可运行时启用');
if(!verifyAgentRpcCapabilityManifest(manifest))issues.push('能力清单与运行时 Agent RPC 合约不一致');
if(JSON.stringify(manifest.rpcs)!==JSON.stringify(REQUIRED_RPCS))issues.push('八个 RPC 的名称或顺序与运行时不一致');

const sql=stripComments(read(`${dir}/013_agent_rpc_008_baseline.sql`));
for(const rpc of manifest.rpcs){
  const signature=`FUNCTION public.${rpc}(p_request jsonb)`,start=sql.indexOf(signature),next=sql.indexOf('CREATE OR REPLACE FUNCTION public.',start+1),body=sql.slice(start,next<0?sql.length:next);
  if(start<0)issues.push(`缺少 ${rpc}(jsonb)`);
  if(!/SECURITY DEFINER/.test(body)||!/SET search_path=venture_private,pg_catalog/.test(body))issues.push(`${rpc} 缺少 SECURITY DEFINER 或固定 search_path`);
  if(!/PERFORM venture_private\.assert_agent_service_role\(\)/.test(body)||!/PERFORM venture_private\.assert_agent_keys\(/.test(body))issues.push(`${rpc} 缺少 service_role 或字段白名单自检`);
  if(!new RegExp(`public\\.${rpc}\\(jsonb\\)`).test(sql))issues.push(`${rpc} 权限声明缺失`);
}
if(!/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/.test(sql)||!/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/.test(sql))issues.push('RPC 未统一拒绝客户端角色或限定 service_role');
if(!/current_setting\('request\.jwt\.claims',true\)/.test(sql)||!/claims->>'role'<>'service_role'/.test(sql))issues.push('service_role guard 未核对 JWT claims');

for(const table of ['demands','demand_applications','agent_dispatches','agent_demand_intakes','agent_application_statements','agent_directional_candidates','agent_mutation_idempotency']){
  if(!sql.includes(`ALTER TABLE venture_private.${table} FORCE ROW LEVEL SECURITY`))issues.push(`${table} 未强制 RLS`);
}
for(const operation of ['stage_demand','stage_application','review_demand','upsert_directional_candidate','dispatch_application','record_owner_decision','record_operator_relay']){
  if(!sql.includes(`'${operation}'`))issues.push(`缺少 ${operation} 幂等操作`);
}
if(!/idempotency_key_hash char\(64\) PRIMARY KEY/.test(sql)||!sql.includes('request_fingerprint')||!sql.includes("RETURN existing.safe_result||jsonb_build_object('idempotent',true)"))issues.push('写操作幂等存储或复用证明不完整');
if(!sql.includes("permission_code='demand.review'")||!sql.includes("status='reserved'")||!sql.includes("SET status='consumed'"))issues.push('008 人工审核授权消费不完整');
if(!sql.includes("jsonb_array_length(dimensions) NOT BETWEEN 3 AND 4")||!sql.includes("value NOT IN ('person','organization','role','matter')"))issues.push('定向候选缺少数据库端 3-of-4 校验');
if(!sql.includes("interval '14 days'")||!sql.includes('pg_advisory_xact_lock')||!sql.includes("demand_id=demand_value AND target_member_id=target_value")||!sql.includes("'duplicate_suppressed'"))issues.push('14 天去重缺少数据库端主体核对、串行化或抑制结果');
if(/suppressed_by_14_day_window','status/.test(sql)||/last_sent_at/.test(sql))issues.push('数据库不得相信客户端提交的去重状态或时间');
for(const marker of ["mode_value='private_match'","projection IS NOT NULL","ARRAY['anonymous_title','anonymous_summary','public_tags','distribution_mode','public_details']","delivery_mode='operator_relay_only'","contact_disclosed boolean NOT NULL DEFAULT false CHECK (contact_disclosed=false)"])if(!sql.includes(marker))issues.push(`缺少安全边界：${marker}`);
for(const forbidden of ['phone_number','raw_phone','raw_openid','wechat_id','email_address','crm_verifications','payment_evidence','membership_decisions'])if(new RegExp(forbidden,'i').test(sql))issues.push(`Agent 包含禁止的联系人/CRM 字段或数据源 ${forbidden}`);

const recorder=stripComments(read(`${dir}/830_record_agent_rpc_version.sql`));
if(!recorder.includes("version='004_wechat_identity_entitlement' AND checksum='89651f")||!recorder.includes("version='008_admin_session_rbac' AND checksum='1d29f")||!/INSERT INTO venture_private\.schema_migrations/.test(recorder)||/INSERT INTO venture_private\.(demands|demand_applications|agent_)/.test(recorder))issues.push('830 必须核对 004/008 且只记录迁移元数据');
const verifyRaw=read(`${dir}/893_verify_agent_rpc_readonly.sql`),verify=stripStrings(verifyRaw);
if(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|DO|CALL|EXECUTE)\b/i.test(verify))issues.push('893 必须保持只读');
for(const rpc of manifest.rpcs)if(!verifyRaw.includes(`${rpc}(jsonb)`))issues.push(`893 未验证 ${rpc}`);
if(issues.length){console.error('CloudBase Agent RPC 未来包离线检查失败：\n- '+issues.join('\n- '));process.exitCode=1}else console.log('CloudBase Agent RPC 未来包离线检查通过；未连接数据库、未执行 SQL、未启用正式路由。');
