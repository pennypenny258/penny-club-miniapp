'use strict';

const crypto=require('node:crypto');
const {previewCrmVerificationCsv,previewShopOrdersCsv,previewVoluntaryDirectoryCsv}=require('../imports');

const MAX_CSV_BYTES=2*1024*1024,MAX_ROWS=500;
const PREVIEWERS=Object.freeze({crm:previewCrmVerificationCsv,payment:previewShopOrdersCsv,directory:previewVoluntaryDirectoryCsv});
const SAFE_CODE=/^[a-z][a-z0-9_]{1,47}$/;

class GovernedImportProtector{
  constructor({encryptionKey,matchHmacKey}){this.encryptionKey=key(encryptionKey,'GOVERNED_IMPORT_ENCRYPTION_KEY');this.matchHmacKey=key(matchHmacKey,'MEMBER_MATCH_HMAC_KEY')}
  protect(value,context){if(!context)throw new Error('敏感导入密文必须绑定行上下文');const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.encryptionKey,iv);cipher.setAAD(Buffer.from(String(context),'utf8'));const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]),tag=cipher.getAuthTag();return Buffer.concat([Buffer.from([1]),iv,tag,body]).toString('base64url')}
  unprotect(value,context){const packed=Buffer.from(String(value||''),'base64url');if(!context||packed.length<30||packed[0]!==1)throw new Error('敏感导入密文格式无效');const decipher=crypto.createDecipheriv('aes-256-gcm',this.encryptionKey,packed.subarray(1,13));decipher.setAAD(Buffer.from(String(context),'utf8'));decipher.setAuthTag(packed.subarray(13,29));return JSON.parse(Buffer.concat([decipher.update(packed.subarray(29)),decipher.final()]).toString('utf8'))}
  matchHash(value){const normalized=String(value||'').normalize('NFKC').trim().toLowerCase();if(!normalized)return null;return crypto.createHmac('sha256',this.matchHmacKey).update(normalized).digest('hex')}
}
function key(value,name){if(Buffer.isBuffer(value)){if(value.length!==32)throw new Error(`${name} 必须是 32 字节服务端密钥`);return value}const text=String(value||''),buffer=Buffer.from(text,'base64');if(buffer.length!==32||buffer.toString('base64').replace(/=+$/,'')!==text.replace(/=+$/,''))throw new Error(`${name} 必须是 32 字节服务端密钥`);return buffer}
function requireAdmin(admin,permission){if(!admin?.verified||!admin?.userId||!Array.isArray(admin.permissions)||!admin.permissions.includes(permission))throw Object.assign(new Error('真实后台身份或权限尚未验证'),{statusCode:403,code:'VERIFIED_ADMIN_REQUIRED'})}
function safeCodes(messages,prefix){return [...new Set((messages||[]).map(message=>`${prefix}_${crypto.createHash('sha256').update(String(message)).digest('hex').slice(0,12)}`))]}
function cleanReasonCodes(codes){if(!Array.isArray(codes)||codes.length>12||codes.some(code=>!SAFE_CODE.test(String(code))))throw new Error('原因代码格式无效');return [...new Set(codes.map(String))]}

class GovernedImportService{
  constructor({repository,protector,adminResolver,uuid=crypto.randomUUID}){if(repository?.kind!=='cloudbase_gateway'||typeof repository.beginBatch!=='function')throw new Error('持久化导入必须使用 CloudBase 后端网关仓库');if(!(protector instanceof GovernedImportProtector))throw new Error('持久化导入需要服务端敏感字段保护器');if(typeof adminResolver!=='function')throw new Error('持久化导入需要真实后台身份解析器');this.repository=repository;this.protector=protector;this.adminResolver=adminResolver;this.uuid=uuid}
  async stageCsv({adminSession,domain,csv,mapping={},options={},idempotencyKey}){
    const admin=await this.adminResolver(adminSession);requireAdmin(admin,'member_import.stage');const previewer=PREVIEWERS[domain];if(!previewer)throw new Error('导入域不在白名单');
    const text=String(csv||''),bytes=Buffer.byteLength(text,'utf8');if(!bytes||bytes>MAX_CSV_BYTES)throw new Error('CSV 大小必须在 1 字节到 2MB 之间');if(!/^[A-Za-z0-9._:-]{8,128}$/.test(String(idempotencyKey||'')))throw new Error('导入幂等键格式无效');
    const preview=previewer(text,mapping,options);if(preview.headerErrors.length)throw Object.assign(new Error('CSV 表头未通过安全校验'),{code:'CSV_HEADER_REJECTED',safeErrors:safeCodes(preview.headerErrors,'header')});if(!preview.results.length)throw new Error('CSV 至少需要一行数据');if(preview.results.length>MAX_ROWS)throw new Error('单批最多 500 行');
    const proposedBatchId=`gib-${this.uuid()}`,csvSha256=crypto.createHash('sha256').update(text).digest('hex'),idempotencyKeyHash=this.protector.matchHash(`${admin.userId}:${idempotencyKey}`);
    const begun=await this.repository.beginBatch({batchId:proposedBatchId,domain,actorId:admin.userId,idempotencyKeyHash,csvSha256,totalRows:preview.results.length,headerCodes:[]}),batchId=begun?.batch_id||proposedBatchId;
    const rows=preview.results.map((result,index)=>{const rowId=`gir-${this.uuid()}`;return {row_id:rowId,row_number:index+2,row_fingerprint:crypto.createHash('sha256').update(`${csvSha256}:${index+2}`).digest('hex'),match_key_kind:domain==='directory'?'member_reference':'contact',match_key_hash:this.matchKeyHash(domain,result.protected),safe_projection:result.normalized,protected_payload_ciphertext:this.protector.protect(result.protected||{},`${batchId}:${rowId}:${domain}`),row_status:result.errors.length?'error':(result.disposition||'needs_human_review'),validation_codes:safeCodes(result.errors,'validation'),warning_codes:safeCodes(result.warnings,'warning')}});
    await this.repository.stageRows({batchId,rows});return {batchId,domain,status:'private_review_pending',totalRows:rows.length,errorRows:rows.filter(row=>row.row_status==='error').length,persistent:true,sensitiveValuesReturned:false};
  }
  matchKeyHash(domain,protectedPayload={}){const candidate=domain==='crm'?protectedPayload.contact_match_token:domain==='payment'?protectedPayload.recipient_phone:protectedPayload.member_reference;return this.protector.matchHash(candidate)}
  async reviewRow({adminSession,rowId,decision,matchedUserId,reasonCodes=[]}){const admin=await this.adminResolver(adminSession);requireAdmin(admin,'member_import.review');if(!['approve_match','reject','skip','rollback'].includes(decision))throw new Error('复核决定无效');if(decision==='approve_match'&&!matchedUserId)throw new Error('批准匹配必须选择内部会员');return this.repository.reviewRow({rowId,reviewerId:admin.userId,decision,matchedUserId,reasonCodes:cleanReasonCodes(reasonCodes)})}
  async rollbackBatch({adminSession,batchId,reasonCodes=[]}){const admin=await this.adminResolver(adminSession);requireAdmin(admin,'member_import.rollback');return this.repository.rollbackBatch({batchId,actorId:admin.userId,reasonCodes:cleanReasonCodes(reasonCodes)})}
  async recomputeMembership({adminSession,userId,decisionId,manualApproved}){const admin=await this.adminResolver(adminSession);requireAdmin(admin,'membership.recompute');const projection=await this.repository.getRecomputeInputs(userId);if(!projection)return {status:'needs_review',reasonCodes:['missing_inputs'],persisted:false};const outcome=decideMembershipProjection(projection,{manualApproved});await this.repository.recordDecision({decisionId,userId,actorId:admin.userId,manualApproved,finalStatus:outcome.finalStatus,reasonCodes:outcome.reasonCodes,inputVersion:projection.input_version});return {...outcome,persisted:true}}
}

function decideMembershipProjection(input,{manualApproved=false}={}){const reasons=[];if(!input.account_active)reasons.push('account_inactive');if(!input.window_current)reasons.push('membership_window_not_current');if(!input.crm_verified)reasons.push('crm_not_verified');if(input.group_status!=='in_group')reasons.push(input.group_status==='unknown'?'group_unknown':'not_in_group');if(!input.payment_verified||!input.payment_reviewed_at)reasons.push('payment_not_reviewed');if(input.refund_status!=='none')reasons.push('refund_requires_review');if(input.conflict_present)reasons.push('input_conflict');if(!manualApproved)reasons.push('manual_approval_required');return {finalStatus:reasons.length?'needs_review':'active',reasonCodes:[...new Set(reasons)]}}

module.exports={MAX_CSV_BYTES,MAX_ROWS,GovernedImportProtector,GovernedImportService,decideMembershipProjection};
