'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'server/db/cloudbase-pg-console/manifest.json'),'utf8'));
const issues=[];
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const checksum=text=>crypto.createHash('sha256').update(text).digest('hex');

for(const [file,expected] of Object.entries({...manifest.immutableCanonicalChecksums,...manifest.cloudbaseExecutionChecksums})){
  const actual=checksum(read(file));if(actual!==expected)issues.push(`${file} 校验和不匹配`);
}
const expectedOrder=[
  'server/db/cloudbase-pg-console/000_preflight_readonly.sql',
  'server/db/migrations/001_core_domains.sql',
  'server/db/cloudbase-pg-console/002_security_cloudbase_gateway.sql',
  'server/db/migrations/003_cloudbase_gateway_read_views.sql',
  'server/db/cloudbase-pg-console/040_record_versions.sql',
  'server/db/cloudbase-pg-console/090_verify_readonly.sql'
];
if(JSON.stringify(manifest.executionOrder)!==JSON.stringify(expectedOrder))issues.push('CloudBase 空库执行顺序发生变化');
const stripComments=text=>text.replace(/--.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');
for(const file of [expectedOrder[0],expectedOrder[5]]){
  const sql=stripComments(read(file));if(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|DO|CALL|EXECUTE)\b/i.test(sql))issues.push(`${file} 不再是只读 SQL`);
}
const security=stripComments(read(expectedOrder[2]));
for(const pattern of [/REVOKE ALL ON SCHEMA venture_private FROM PUBLIC/i,/ENABLE ROW LEVEL SECURITY/i,/audit_logs_append_only/i,/REVOKE ALL ON SCHEMA venture_private FROM anon/i,/REVOKE ALL ON SCHEMA venture_private FROM authenticated/i])if(!pattern.test(security))issues.push(`CloudBase 002 安全变体缺少保护：${pattern}`);
if(/CREATE\s+ROLE/i.test(security))issues.push('CloudBase 002 安全变体不得创建数据库登录角色');
if(/GRANT[\s\S]{0,120}\b(anon|authenticated)\b/i.test(security))issues.push('CloudBase 002 安全变体不得向客户端角色授权');
const views=stripComments(read(expectedOrder[3]));
for(const forbidden of ['private_object_key_ciphertext','source_reference_ciphertext','meeting_link_ciphertext','payment_evidence','crm_verifications'])if(views.includes(forbidden))issues.push(`003 只读视图包含禁止字段或事实域：${forbidden}`);
if(issues.length){console.error('CloudBase PG 空库迁移包检查失败：\n- '+issues.join('\n- '));process.exitCode=1}else console.log('CloudBase PG 空库迁移包离线检查通过；未连接或写入任何数据库。');
