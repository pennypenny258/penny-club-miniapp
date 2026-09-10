'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'server/db/cloudbase-pg-console/production-intake-manifest.json'),'utf8')),issues=[];
const read=file=>fs.readFileSync(path.join(root,file),'utf8'),hash=text=>crypto.createHash('sha256').update(text).digest('hex'),strip=text=>text.replace(/--.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');
for(const [file,expected] of Object.entries(manifest.checksums))if(hash(read(file))!==expected)issues.push(`${file} 校验和不匹配`);
const [migrationFile,recorderFile,verifyFile]=manifest.executionOrder,migration=strip(read(migrationFile)),recorder=strip(read(recorderFile)),verify=strip(read(verifyFile));
for(const required of ['member_crm_master_profiles','venture_stage_governed_import_chunk','venture_finalize_governed_import_batch','venture_upsert_activity','BETWEEN 0 AND 10000','identity_profile_ciphertext','renewal_terms_ciphertext','replay_link_ciphertext'])if(!migration.includes(required))issues.push(`014 缺少 ${required}`);
for(const rpc of ['venture_stage_governed_import_chunk','venture_finalize_governed_import_batch','venture_upsert_activity']){const start=migration.indexOf(`FUNCTION public.${rpc}`),next=migration.indexOf('CREATE OR REPLACE FUNCTION',start+1),body=migration.slice(start,next<0?undefined:next);if(start<0||!body.includes('assert_cloudbase_service_role'))issues.push(`${rpc} 缺少函数内 service_role 自检`)}
if(/GRANT (?:SELECT|INSERT|UPDATE|DELETE|EXECUTE)[\s\S]{0,220} TO (anon|authenticated)/i.test(migration))issues.push('014 不得向客户端角色授权 CRM、活动私有字段或写入 RPC');
if(/\b(phone|wechat_id|real_name|payment_name|operator_note)\s+(text|varchar|jsonb)/i.test(migration))issues.push('014 不得保存明文联系方式、姓名、付款姓名或备注');
if(!/008_admin_session_rbac/.test(recorder)||!/009_admin_governance/.test(recorder)||!/INSERT INTO venture_private\.schema_migrations/.test(recorder))issues.push('840 必须锁定 008 基线、拒绝 009–013 并只登记 014');
if(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|DO|CALL)\b/i.test(verify))issues.push('890 必须保持只读');
if(!/public_view_has_no_private_locators/.test(verify)||!/service_role_can_upsert_activity/.test(verify))issues.push('890 缺少权限或公开视图验证');
if(issues.length){console.error('CloudBase 生产资料录入包检查失败：\n- '+issues.join('\n- '));process.exitCode=1}else console.log('CloudBase 生产资料录入包离线检查通过；未连接数据库、未读取真实表格、未写入云端。');
