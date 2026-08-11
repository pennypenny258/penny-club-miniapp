'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),dir='server/db/future/member-binding-rpc',manifest=JSON.parse(fs.readFileSync(path.join(root,dir,'manifest.json'),'utf8')),issues=[];
const read=file=>fs.readFileSync(path.join(root,file),'utf8'),hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const stripComments=text=>text.replace(/--.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');
const stripStrings=text=>stripComments(text).replace(/'(?:''|[^'])*'/g,"''");
for(const [file,expected] of Object.entries(manifest.checksums)){if(hash(read(file))!==expected)issues.push(`${file} 校验和不匹配`)}
if(manifest.status!=='future_not_applied'||manifest.runtimeEnablementAllowed!==false)issues.push('未来包必须明确不可运行时启用');
const sql=stripComments(read(`${dir}/012_member_binding_rpc_008_baseline.sql`));
const rpcs=Object.values(manifest.rpc);
if(rpcs.length!==5||new Set(rpcs).size!==5)issues.push('必须只有五个隔离的 RPC');
for(const rpc of rpcs){
  const signature=`FUNCTION public.${rpc}(p_request jsonb)`,start=sql.indexOf(signature),next=sql.indexOf('CREATE OR REPLACE FUNCTION',start+1),body=sql.slice(start,next<0?sql.length:next);
  if(start<0)issues.push(`缺少 ${rpc}(jsonb)`);
  if(!/SECURITY DEFINER/.test(body)||!/SET search_path=venture_private,pg_catalog/.test(body))issues.push(`${rpc} 缺少 SECURITY DEFINER 或固定 search_path`);
  if(!/PERFORM venture_private\.assert_member_binding_service_role\(\)/.test(body))issues.push(`${rpc} 缺少函数内 service_role 自检`);
  if(!new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}\\(jsonb\\) FROM PUBLIC, anon, authenticated`).test(sql))issues.push(`${rpc} 未拒绝客户端角色`);
  if(!new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}\\(jsonb\\) TO service_role`).test(sql))issues.push(`${rpc} 未限定 service_role`);
}
for(const table of ['member_binding_match_tokens','member_binding_match_options','member_binding_candidates','member_binding_idempotency','member_binding_token_idempotency']){
  if(!sql.includes(`CREATE TABLE venture_private.${table}`)||!sql.includes(`ALTER TABLE venture_private.${table} FORCE ROW LEVEL SECURITY`)||!sql.includes(`REVOKE ALL ON venture_private.${table} FROM PUBLIC, anon, authenticated`))issues.push(`${table} 缺少私有表/RLS/客户端禁权`);
}
const tokenRpc='venture_member_binding_replace_confirmed_phone_tokens',tokenStart=sql.indexOf(`FUNCTION public.${tokenRpc}(p_request jsonb)`),tokenBody=sql.slice(tokenStart,sql.indexOf('REVOKE ALL ON FUNCTION',tokenStart));
if(tokenStart<0||!tokenBody.includes('assert_member_binding_service_role')||!tokenBody.includes("permission_code='member_import.materialize.execute'")||!tokenBody.includes("permission_code='member_import.review'")||!tokenBody.includes('actor_value=reviewer_value')||!tokenBody.includes("writeScope'<>'member_binding_match_tokens_only"))issues.push('受控 token RPC 缺少 service_role、双人授权或固定写入范围');
if(!sql.includes(`REVOKE ALL ON FUNCTION public.${tokenRpc}(jsonb) FROM PUBLIC, anon, authenticated`)||!sql.includes(`GRANT EXECUTE ON FUNCTION public.${tokenRpc}(jsonb) TO service_role`))issues.push('受控 token RPC 缺少客户端禁权或 service_role 授权');
if(!/FUNCTION venture_private\.assert_member_binding_service_role\(\)[\s\S]{0,500}current_setting\('request\.jwt\.claims',true\)/.test(sql)||!/claims->>'role'<>'service_role'/.test(sql)||!/REVOKE ALL ON FUNCTION venture_private\.assert_member_binding_service_role\(\) FROM PUBLIC, anon, authenticated/.test(sql))issues.push('包内 service_role guard 缺少 JWT claims 核对或客户端禁权');
for(const required of ['app_scope_hash','subject_hash','key_version','token_fingerprint','idempotency_key_hash','external_identity_bindings','admin_action_authorizations','entitlementRecheckRequired'])if(!sql.includes(required))issues.push(`012 缺少 ${required}`);
for(const forbidden of ['phone_number','raw_openid','raw_phone','payment_amount','protected_payload_ciphertext','contact_value'])if(new RegExp(forbidden,'i').test(sql))issues.push(`012 含禁止的原始/敏感字段 ${forbidden}`);
if(!/FROM venture_private\.member_binding_match_tokens WHERE token_kind='phone' AND token_hash=phone_value AND status='active'/.test(sql)||/FROM venture_private\.member_binding_match_tokens WHERE token_kind='(?:wechat_id|group_nickname)'/.test(sql))issues.push('自动精确匹配必须以用户授权手机 token 为唯一主匹配');
if(!/candidate_row\.status<>'auto_eligible'/.test(sql)||!/group_active/.test(sql)||!/final_decision_active/.test(sql))issues.push('自动绑定缺少会籍/大群/决策门禁');
if(/\b(UPDATE|INSERT|DELETE)\s+venture_private\.(crm_verifications|payment_evidence|membership_decisions|public_directory_profiles)/i.test(sql))issues.push('RPC 不得改写 CRM/付款/会籍/公开名册事实');
const recorder=stripComments(read(`${dir}/820_record_member_binding_rpc_version.sql`));
if(!recorder.includes("version='004_wechat_identity_entitlement' AND checksum='89651f")||!recorder.includes("version='008_admin_session_rbac' AND checksum='1d29f")||!/INSERT INTO venture_private\.schema_migrations/.test(recorder)||/INSERT INTO venture_private\.(member_binding|external_identity)/.test(recorder))issues.push('820 必须核对 004/008 且只记录迁移元数据');
const verify=stripStrings(read(`${dir}/890_verify_member_binding_rpc_readonly.sql`));
if(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|DO|CALL|EXECUTE)\b/i.test(verify))issues.push('890 必须保持只读');
for(const rpc of rpcs)if(!read(`${dir}/890_verify_member_binding_rpc_readonly.sql`).includes(`${rpc}(jsonb)`))issues.push(`890 未验证 ${rpc}`);
if(!read(`${dir}/890_verify_member_binding_rpc_readonly.sql`).includes(`${tokenRpc}(jsonb)`))issues.push(`890 未验证 ${tokenRpc}`);
if(issues.length){console.error('CloudBase 会员绑定 RPC 未来包离线检查失败：\n- '+issues.join('\n- '));process.exitCode=1}else console.log('CloudBase 会员绑定 RPC 未来包离线检查通过；未连接数据库、未执行 SQL、未启用生产路由。');
