'use strict';

const MAX_CANARY_ROWS=50;

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

module.exports={MAX_CANARY_ROWS,buildCrmSmallBatchCanaryPlan};
