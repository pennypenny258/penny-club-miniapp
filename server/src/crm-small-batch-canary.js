'use strict';

const MAX_CANARY_ROWS=50;

function buildCrmSmallBatchReviewReadiness(batch){
  if(!batch||typeof batch!=='object'||!Array.isArray(batch.rows))throw new Error('CRM 脱敏演练批次无效');
  const summary=batch.summary||{};
  const totalRows=Number(summary.totalRows||batch.rows.length||0);
  const reviewReadyRows=Number(summary.reviewReadyRows||0);
  const errorRows=Number(summary.errorRows||0);
  const unresolvedRows=Number(summary.unresolvedRows||0);
  const conflictRows=Number(summary.conflictRows||0);
  const unknownGroupRows=Number(summary.unknownGroupRows||0);
  const missingFieldRows=Number(summary.missingFieldRows||0);
  const withinLimit=totalRows>0&&totalRows<=MAX_CANARY_ROWS;
  const rowsReady=reviewReadyRows===totalRows&&errorRows===0&&unresolvedRows===0&&conflictRows===0&&unknownGroupRows===0;
  const readyForIndependentReview=withinLimit&&rowsReady;
  const blockers=[];
  if(!withinLimit)blockers.push(totalRows>MAX_CANARY_ROWS?'canary_row_limit_exceeded':'no_rows_present');
  if(errorRows)blockers.push('row_errors_need_source_correction');
  if(unresolvedRows)blockers.push('matching_decisions_incomplete');
  if(conflictRows)blockers.push('matching_conflicts_unresolved');
  if(unknownGroupRows)blockers.push('group_status_confirmation_incomplete');
  return {
    status:readyForIndependentReview?'awaiting_independent_reviewer':'operator_row_review_required',
    maxRows:MAX_CANARY_ROWS,
    totalRows,
    reviewReadyRows,
    readyForIndependentReview,
    automaticBindingEligibleRows:0,
    automaticBindingBlockedByMissingMatchEvidence:missingFieldRows,
    blockers,
    nextStep:readyForIndependentReview
      ? '请由独立复核人核对脱敏状态与原始受控表；当前系统不会暂存、写入或开通会籍。'
      : '请继续在演练中处理匹配、群状态或源表校正；不要把未完成行带入未来小批次。',
    safeguards:{
      rehearsalOnly:true,
      persistent:false,
      crmFactsMutated:false,
      membershipActivated:false,
      automaticBindingPerformed:false,
      notificationsSent:false,
      rawRowsReturned:false
    }
  };
}

function buildCrmSmallBatchCanaryPlan(preview,{requestedRows}={}){
  if(!preview||typeof preview!=='object')throw new Error('CRM 脱敏预检结果无效');
  const requested=Number(requestedRows||MAX_CANARY_ROWS);
  if(!Number.isInteger(requested)||requested<1||requested>MAX_CANARY_ROWS)throw Object.assign(new Error(`首批 CRM 演练只能准备 1–${MAX_CANARY_ROWS} 行`),{statusCode:400,code:'CRM_CANARY_SIZE_INVALID'});
  const summary=preview.summary||{};
  const previewReady=preview.status==='preview_complete'&&Number(summary.errorRows||0)===0;
  const hasRows=Number(summary.totalRows||0)>0;
  const stageEligible=previewReady&&hasRows&&Number(summary.totalRows)<=MAX_CANARY_ROWS;
  const blockers=[];
  if(!previewReady)blockers.push('preview_or_row_errors_present');
  if(!hasRows)blockers.push('no_rows_present');
  if(Number(summary.totalRows)>MAX_CANARY_ROWS)blockers.push('prepare_a_separate_operator_selected_small_spreadsheet');
  return {
    status:stageEligible?'canary_file_ready_when_runtime_is_enabled':'operator_preparation_required',
    maxRows:MAX_CANARY_ROWS,
    selectedRows:Math.min(requested,Number(summary.totalRows||0)),
    sourceFileRows:Number(summary.totalRows||0),
    stageEligible,
    formalWriteEnabled:false,
    materializationEnabled:false,
    requiredRuntimeEvidence:['production_cloudbase_gateway','008_baseline','formal_admin_session','governed_import_rpc_manifest','server_only_encryption_and_match_keys'],
    requiredReviewSteps:['private_batch_staged','each_row_matched_or_marked_new','group_status_confirmed','independent_reviewer_approval','explicit_materialization_request'],
    blockers,
    safeguards:{
      rawRowsReturned:false,
      crmFactsMutated:false,
      membershipActivated:false,
      publicDirectoryMutated:false,
      memoryFallback:false,
      noAutomaticNotifications:true
    },
    notice:stageEligible
      ? '这份小表已经适合作为未来私有 canary 输入；当前系统仍只生成计划，不会上传、入库或改变会籍。'
      : `请从原始表中人工挑选最多 ${MAX_CANARY_ROWS} 名已知成员，另存为独立小表后重新预检；不要由系统自动挑选行。`
  };
}

module.exports={MAX_CANARY_ROWS,buildCrmSmallBatchCanaryPlan,buildCrmSmallBatchReviewReadiness};
