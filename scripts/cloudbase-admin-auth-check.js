'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'server/db/cloudbase-pg-console/admin-auth-manifest.json'),'utf8')),issues=[];
const read=file=>fs.readFileSync(path.join(root,file),'utf8'),hash=text=>crypto.createHash('sha256').update(text).digest('hex'),strip=text=>text.replace(/--.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');
for(const [file,expected] of Object.entries(manifest.checksums))if(hash(read(file))!==expected)issues.push(`${file} 校验和不匹配`);
const migration=strip(read('server/db/migrations/008_admin_session_rbac.sql'));
for(const required of ['external_admin_identity_bindings','admin_sessions','admin_action_authorizations','venture_admin_session_access','system_admin','operations','reviewer','auditor','venture_begin_admin_session','venture_reserve_admin_action','venture_revoke_admin_session'])if(!migration.includes(required))issues.push(`008 缺少 ${required}`);
for(const rpc of ['venture_begin_admin_session','venture_reserve_admin_action','venture_revoke_admin_session']){const start=migration.indexOf(`FUNCTION public.${rpc}`),next=migration.indexOf('CREATE OR REPLACE FUNCTION',start+1),body=migration.slice(start,next<0?undefined:next);if(start<0||!body.includes('assert_cloudbase_service_role'))issues.push(`${rpc} 缺少函数内 service_role 自检`)}
if(/GRANT (?:SELECT|EXECUTE)[\s\S]{0,180} TO (anon|authenticated)/i.test(migration))issues.push('008 不得向客户端角色授权后台会话视图或 RPC');
if(!/p_actor_id=ANY\(coalesce\(p_excluded_actor_ids/.test(migration)||!migration.includes('step_up_verified_at'))issues.push('008 缺少职责分离或近期认证门禁');
if(/(raw_subject|phone|wechat|contact_value|payment_amount)/i.test(migration))issues.push('008 不得保存或暴露原始身份、联系方式或付款值');
const recorder=strip(read('server/db/cloudbase-pg-console/540_record_admin_auth_version.sql'));if(!/INSERT INTO venture_private\.schema_migrations/.test(recorder)||/INSERT INTO venture_private\.(admin_sessions|external_admin_identity_bindings)/.test(recorder))issues.push('540 必须只写迁移元数据');
const verify=strip(read('server/db/cloudbase-pg-console/590_verify_admin_auth_readonly.sql'));if(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|DO|CALL|EXECUTE)\b/i.test(verify))issues.push('590 不再是只读验证');
if(issues.length){console.error('CloudBase 正式后台认证包检查失败：\n- '+issues.join('\n- '));process.exitCode=1}else console.log('CloudBase 正式后台认证包离线检查通过；未连接数据库、未绑定身份、未签发真实会话。');
