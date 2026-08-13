'use strict';

const { buildCrmSmallBatchReviewReadiness } = require('./crm-small-batch-canary');

const ALLOWED_MISSING_FIELDS=new Set(['wechat_group_nickname','wechat_id','phone','real_name']);
const MATCH_RESOLUTIONS=new Set(['not_run','unique_match','conflict','unmatched','manual_new_record']);
const GROUP_STATUSES=new Set(['in_group','left','removed','unknown']);

function safeRow(input,index){
  const missingFields=Array.isArray(input?.missingFields)?[...new Set(input.missingFields.filter(field=>ALLOWED_MISSING_FIELDS.has(field)))]:[];
  const groupStatus=GROUP_STATUSES.has(input?.groupStatus)?input.groupStatus:'unknown';
  return {id:`crm-rehearsal-row-${index+1}`,rowNumber:Number(input?.rowNumber)||index+2,status:input?.hasErrors?'needs_correction':'needs_match',validationErrorPresent:Boolean(input?.hasErrors),missingFields,groupStatus,paymentStatus:['paid','unpaid','needs_review'].includes(input?.paymentStatus)?input.paymentStatus:'not_recorded',membershipTierCandidate:['angel_shareholder','a1_shareholder','a2_shareholder','honorary_director'].includes(input?.membershipTierCandidate)?input.membershipTierCandidate:null,honoraryDirectorCandidate:Boolean(input?.honoraryDirectorCandidate),matchingStatus:'not_run',candidateCount:null,operatorDecision:'pending',sourceKind:'historical_renewal_table',sensitiveValuesStored:false};
}
function summarize(batch){
  const rows=batch.rows,totalRows=rows.length;
  const unresolvedRows=rows.filter(row=>!['unique_match','manual_new_record'].includes(row.matchingStatus)&&row.status!=='excluded').length;
  const conflictRows=rows.filter(row=>row.matchingStatus==='conflict').length;
  const missingFieldRows=rows.filter(row=>row.missingFields.length>0&&row.status!=='excluded').length;
  const unknownGroupRows=rows.filter(row=>row.groupStatus==='unknown'&&row.status!=='excluded').length;
  const excludedRows=rows.filter(row=>row.status==='excluded').length;
  const errorRows=rows.filter(row=>row.validationErrorPresent&&row.status!=='excluded').length;
  const reviewReadyRows=rows.filter(row=>!row.validationErrorPresent&&row.status!=='excluded'&&['unique_match','manual_new_record'].includes(row.matchingStatus)&&row.groupStatus!=='unknown').length;
  return {totalRows,reviewReadyRows,unresolvedRows,conflictRows,missingFieldRows,unknownGroupRows,errorRows,excludedRows,formalWriteEligible:false,persistent:false};
}
class CrmImportRehearsalStore{
  constructor({now=()=>new Date().toISOString()}={}){this.now=now;this.batches=[];this.sequence=0}
  list(){return this.batches.map(batch=>this.publicBatch(batch))}
  create({previewId,previewDigest,rows}){
    if(!/^crm-preview-[a-f0-9]{16}$/.test(String(previewId||''))||!/^[a-f0-9]{64}$/.test(String(previewDigest||'')))throw Object.assign(new Error('脱敏预检标识无效，请重新预检'),{statusCode:400,code:'CRM_REHEARSAL_PREVIEW_INVALID'});
    if(!Array.isArray(rows)||!rows.length||rows.length>10000)throw Object.assign(new Error('演练批次行数无效'),{statusCode:400,code:'CRM_REHEARSAL_ROWS_INVALID'});
    const existing=this.batches.find(batch=>batch.previewDigest===previewDigest);if(existing)return this.publicBatch(existing);
    const batch={id:`crm-rehearsal-${++this.sequence}`,previewId,previewDigest,status:'local_rehearsal',sourceKind:'historical_renewal_table',createdAt:this.now(),rows:rows.map(safeRow)};
    this.batches.unshift(batch);return this.publicBatch(batch);
  }
  updateRow(batchId,rowId,input={}){
    const batch=this.batches.find(item=>item.id===batchId),row=batch?.rows.find(item=>item.id===rowId);if(!row)throw Object.assign(new Error('CRM 演练行不存在'),{statusCode:404,code:'CRM_REHEARSAL_ROW_NOT_FOUND'});
    if(input.action==='mark_field_present'){
      if(!ALLOWED_MISSING_FIELDS.has(input.field))throw Object.assign(new Error('待补字段不在白名单'),{statusCode:400,code:'CRM_REHEARSAL_FIELD_INVALID'});
      row.missingFields=row.missingFields.filter(field=>field!==input.field);
    }else if(input.action==='set_match_resolution'){
      if(!MATCH_RESOLUTIONS.has(input.resolution)||input.resolution==='not_run')throw Object.assign(new Error('匹配处理结论无效'),{statusCode:400,code:'CRM_REHEARSAL_MATCH_INVALID'});
      row.matchingStatus=input.resolution;row.candidateCount=input.resolution==='unique_match'?1:input.resolution==='conflict'?2:0;row.operatorDecision=input.resolution==='conflict'?'conflict_requires_selection':'operator_rehearsal_confirmed';
    }else if(input.action==='set_group_status'){
      if(!GROUP_STATUSES.has(input.groupStatus))throw Object.assign(new Error('大群状态无效'),{statusCode:400,code:'CRM_REHEARSAL_GROUP_INVALID'});row.groupStatus=input.groupStatus;
    }else if(input.action==='exclude'){
      row.status='excluded';row.operatorDecision='excluded_from_rehearsal';
    }else throw Object.assign(new Error('CRM 演练操作无效'),{statusCode:400,code:'CRM_REHEARSAL_ACTION_INVALID'});
    if(row.status!=='excluded')row.status=row.validationErrorPresent?'needs_correction':row.matchingStatus==='conflict'?'conflict':(['unique_match','manual_new_record'].includes(row.matchingStatus)&&row.groupStatus!=='unknown'?'review_ready':row.missingFields.length?'needs_completion':'needs_match');
    return {batch:this.publicBatch(batch),row:{...row,missingFields:[...row.missingFields]}};
  }
  canaryReadiness(batchId){
    const batch=this.batches.find(item=>item.id===batchId);
    if(!batch)throw Object.assign(new Error('CRM 演练批次不存在'),{statusCode:404,code:'CRM_REHEARSAL_BATCH_NOT_FOUND'});
    return {batchId:batch.id,sourceKind:batch.sourceKind,createdAt:batch.createdAt,review:buildCrmSmallBatchReviewReadiness(this.publicBatch(batch))};
  }
  publicBatch(batch){return {id:batch.id,previewId:batch.previewId,status:batch.status,sourceKind:batch.sourceKind,createdAt:batch.createdAt,summary:summarize(batch),rows:batch.rows.map(row=>({...row,missingFields:[...row.missingFields]})),safeguards:{rehearsalOnly:true,sensitiveValuesStored:false,persistent:false,memoryBusinessFactsWritten:false,publicDirectoryMutationAllowed:false,membershipActivated:false,formalConfirmationAvailable:false}}}
}

function buildSourceOverview(store){
  const payments=Array.isArray(store?.paymentEvidence)?store.paymentEvidence:[],ocr=Array.isArray(store?.groupLabelOcrResults)?store.groupLabelOcrResults:[];
  const paymentCount=source=>payments.filter(item=>item.source===source||(source==='wechat_shop_order'&&item.source==='shop_evidence')||(source==='manual_transfer'&&item.source==='manual_payment')).length;
  return [{key:'historical_renewal_table',label:'历史续费追踪表',status:'upload_and_preview'},{key:'group_label_ocr',label:'微信群标签 / OCR',status:'human_confirmation_required',total:ocr.length,pending:ocr.filter(item=>item.reviewStatus==='pending_human_confirmation').length,unmatched:ocr.filter(item=>!item.candidateUserId).length},{key:'wechat_shop_order',label:'微信小店订单',status:'payment_clue_only',total:paymentCount('wechat_shop_order')},{key:'wechat_merchant_receipt',label:'商户号支付小票',status:'payment_clue_only',total:paymentCount('wechat_merchant_receipt')},{key:'manual_transfer',label:'手动转账',status:'payment_clue_only',total:paymentCount('manual_transfer')}];
}

module.exports={ALLOWED_MISSING_FIELDS,MATCH_RESOLUTIONS,GROUP_STATUSES,CrmImportRehearsalStore,buildSourceOverview,summarize};
