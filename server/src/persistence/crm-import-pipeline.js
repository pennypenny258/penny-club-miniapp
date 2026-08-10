'use strict';
const crypto=require('node:crypto');
const {parseSpreadsheetUpload}=require('../spreadsheet-import');
const {previewCrmVerificationCsv,crmVerificationFields}=require('../imports');

const REQUIRED_CRM_MIGRATION='011_crm_master_import';
const MAX_CRM_ROWS=10000;
function present(value){return Boolean(String(value||'').trim())}
function safeIssueCode(message,prefix){return `${prefix}_${crypto.createHash('sha256').update(String(message)).digest('hex').slice(0,12)}`}

function resolveCrmPersistentImportConfig(environment=process.env){
  const requested=environment.CRM_PERSISTENT_IMPORTS_ENABLED==='true';
  const keys=['CRM_PERSISTENT_IMPORTS_ENABLED','CRM_PERSISTENCE_MIGRATION_APPLIED','GOVERNED_MEMBER_IMPORTS_ENABLED','GOVERNED_MATERIALIZATION_ENABLED','GOVERNED_IMPORT_ENCRYPTION_KEY','MEMBER_MATCH_HMAC_KEY','GOVERNED_IMPORT_ADMIN_PROVIDER','GOVERNED_IMPORT_AUDIT_STORE','GOVERNED_IMPORT_IDEMPOTENCY_STORE'];
  if(!requested){
    const disabledFlags=new Set(['GOVERNED_MEMBER_IMPORTS_ENABLED','GOVERNED_MATERIALIZATION_ENABLED']);
    const partial=keys.filter(key=>key!=='CRM_PERSISTENT_IMPORTS_ENABLED').some(key=>present(environment[key])&&!(disabledFlags.has(key)&&environment[key]==='false'));
    if(partial)throw new Error('CRM 持久化导入配置不完整：禁止在未显式启用时保留部分真实写入配置');
    return {enabled:false,safeSummary:{enabled:false,persistent:false,previewOnly:true,memoryFallback:false,reason:'server_configuration_not_enabled'}};
  }
  if(environment.NODE_ENV!=='production'||environment.DATA_REPOSITORY!=='cloudbase_gateway')throw new Error('CRM 持久化导入只允许生产 CloudBase HTTPS 后端网关模式');
  if(environment.DEPLOYMENT_PROFILE==='cloudbase_staging_demo'||environment.DEMO_DATA_ONLY==='true')throw new Error('匿名 staging 禁止启用 CRM 持久化导入');
  const required=['CLOUDBASE_PG_ENV_ID','CLOUDBASE_PG_SERVER_API_KEY','CLOUDBASE_PG_REGION','CRM_PERSISTENCE_MIGRATION_APPLIED','GOVERNED_IMPORT_ENCRYPTION_KEY','MEMBER_MATCH_HMAC_KEY','GOVERNED_IMPORT_ADMIN_PROVIDER','GOVERNED_IMPORT_AUDIT_STORE','GOVERNED_IMPORT_IDEMPOTENCY_STORE'];
  const missing=required.filter(key=>!present(environment[key]));if(missing.length)throw new Error(`CRM 持久化导入配置不完整：缺少 ${missing.join(', ')}`);
  if(environment.CRM_PERSISTENCE_MIGRATION_APPLIED!==REQUIRED_CRM_MIGRATION)throw new Error(`CRM 持久化导入要求迁移版本 ${REQUIRED_CRM_MIGRATION}`);
  if(environment.GOVERNED_MEMBER_IMPORTS_ENABLED!=='true'||environment.GOVERNED_MATERIALIZATION_ENABLED!=='true')throw new Error('CRM 持久化导入必须同时启用受控批次与分域物化');
  if(environment.GOVERNED_IMPORT_ADMIN_PROVIDER!=='external_verified_session')throw new Error('CRM 持久化导入必须使用真实服务端后台会话');
  if(environment.GOVERNED_IMPORT_AUDIT_STORE!=='cloudbase_pg'||environment.GOVERNED_IMPORT_IDEMPOTENCY_STORE!=='cloudbase_pg')throw new Error('CRM 持久化导入的审计与幂等必须写入 CloudBase PG');
  return {enabled:true,mode:'cloudbase_gateway',requiredMigration:REQUIRED_CRM_MIGRATION,safeSummary:{enabled:true,persistent:true,previewOnly:false,serverOnly:true,verifiedAdminRequired:true,explicitConfirmationRequired:true,memoryFallback:false,credentialsExposed:false}};
}

async function buildCrmSpreadsheetPreview(payload){
  const upload=await parseSpreadsheetUpload(payload),preview=previewCrmVerificationCsv(upload.csv,payload.mapping||{});
  if(preview.results.length>MAX_CRM_ROWS)throw Object.assign(new Error(`单批最多 ${MAX_CRM_ROWS.toLocaleString('zh-CN')} 行；请按月份或年份分批后重试`),{statusCode:413,code:'CRM_BATCH_ROW_LIMIT'});
  const digest=crypto.createHash('sha256').update(upload.csv).update('\0').update(JSON.stringify(payload.mapping||{})).digest('hex');
  const count=predicate=>preview.results.filter(predicate).length;
  const summary={totalRows:preview.results.length,errorRows:count(row=>!row.valid),reviewRows:count(row=>row.valid),expiryNeedsReviewRows:count(row=>row.normalized.membershipExpiryNeedsReview===true),missingPhoneRows:count(row=>!row.normalized.phonePresent),missingWechatRows:count(row=>!row.normalized.wechatIdPresent),missingRealNameRows:count(row=>!row.normalized.realNamePresent),unpaidRows:count(row=>row.normalized.payment_status==='unpaid'),honoraryDirectorCandidateRows:count(row=>row.normalized.honoraryDirectorCandidate===true),unknownGroupRows:count(row=>!row.normalized.group_status||row.normalized.group_status==='unknown'),conflictRows:0,persistentMatchingStatus:'not_run_until_confirmed_private_batch'};
  const rehearsalRows=preview.results.map((row,index)=>({rowNumber:index+2,hasErrors:row.errors.length>0,missingFields:['wechat_group_nickname','wechat_id','phone','real_name'].filter(field=>!row.normalized[`${field==='wechat_group_nickname'?'wechatGroupNickname':field==='wechat_id'?'wechatId':field==='real_name'?'realName':'phone'}Present`]),groupStatus:row.normalized.group_status||'unknown',paymentStatus:row.normalized.payment_status||'not_recorded',membershipTierCandidate:row.normalized.membership_tier||null,honoraryDirectorCandidate:row.normalized.honoraryDirectorCandidate===true}));
  return {previewId:`crm-preview-${digest.slice(0,16)}`,previewDigest:digest,status:preview.headerErrors.length?'mapping_required':'preview_complete',persisted:false,writeAttempted:false,localDemoOnly:true,spreadsheet:{format:upload.meta.format,sheetName:upload.meta.sheetName,rowCount:upload.meta.rowCount,detectedStandardFields:preview.headers.filter(field=>crmVerificationFields.includes(field)),needsMapping:preview.headerErrors.length>0},summary,rehearsalRows,issueCodes:{headers:preview.headerErrors.map(message=>safeIssueCode(message,'header')),rows:[...new Set(preview.results.flatMap(row=>row.errors.map(message=>safeIssueCode(message,'row'))))]},safeguards:{sensitiveValuesReturned:false,rawHeadersReturned:false,rawRowsReturned:false,ordinaryLogsContainValues:false,publicDirectoryMutationAllowed:false,membershipActivated:false,unpaidMeansInactive:false,memoryFallback:false},notice:'当前仅完成本地脱敏预检，未创建正式批次、未写入内存业务事实或 CloudBase，不能作为正式入库。'};
}

class CrmPersistentImportCoordinator{
  constructor({config,stagingService}){if(!config?.enabled||config.mode!=='cloudbase_gateway')throw new Error('CRM 正式写入协调器需要完整生产配置');if(typeof stagingService?.stageCsv!=='function')throw new Error('CRM 正式写入协调器需要持久化受控批次服务');this.config=config;this.stagingService=stagingService}
  async confirm({adminSession,payload,previewDigest,explicitConfirmation,idempotencyKey}){
    if(explicitConfirmation!==true)throw Object.assign(new Error('必须明确确认创建私有 CRM 批次'),{statusCode:409,code:'CRM_IMPORT_CONFIRMATION_REQUIRED'});
    const preview=await buildCrmSpreadsheetPreview(payload);if(preview.status!=='preview_complete'||preview.summary.errorRows)throw Object.assign(new Error('CRM 预检仍有映射或行级错误'),{statusCode:409,code:'CRM_PREVIEW_NOT_READY'});
    if(!/^[a-f0-9]{64}$/.test(String(previewDigest||''))||preview.previewDigest!==previewDigest)throw Object.assign(new Error('CRM 文件或映射在确认前已改变，请重新预检'),{statusCode:409,code:'CRM_PREVIEW_CHANGED'});
    try{return await this.stagingService.stageCsv({adminSession,domain:'crm',csv:(await parseSpreadsheetUpload(payload)).csv,mapping:payload.mapping||{},idempotencyKey})}catch(error){if(error?.statusCode===403||error?.statusCode===409)throw error;throw Object.assign(new Error('CRM 持久化服务暂时不可用；未回退到本地或内存'),{statusCode:503,code:'CRM_PERSISTENCE_UNAVAILABLE'})}
  }
}
module.exports={REQUIRED_CRM_MIGRATION,MAX_CRM_ROWS,resolveCrmPersistentImportConfig,buildCrmSpreadsheetPreview,CrmPersistentImportCoordinator};
