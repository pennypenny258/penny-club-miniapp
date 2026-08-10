'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),ExcelJS=require('exceljs');
const {buildCrmSpreadsheetPreview,resolveCrmPersistentImportConfig,CrmPersistentImportCoordinator}=require('../src/persistence/crm-import-pipeline');
const {CloudBaseGovernedImportRepository}=require('../src/persistence/governed-import-repository');

async function fixturePayload(){
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('匿名历史续费');
  sheet.addRow(['昵称','备注名','到期月份','续费价格','通知状态','通知日期','付款状态','付款日期','手机号','付款姓名','操作备注','群状态','微信号','真实姓名','会员等级','首次入群月份','累计在群月数']);
  sheet.addRow(['匿名甲','示例备注名','2026-08','499','待续费跟进','2026-08','未付','','','','仅匿名测试','在群','','','荣誉董事','2025-01','19']);
  sheet.addRow(['匿名乙','','2026-09','666','未通知','','已付','2026-08','','','','未知','','','','','']);
  sheet.addRow(['匿名丙','','待确认','666','未通知','','未付','','','','','未知','','','','','']);
  return {format:'xlsx',dataBase64:Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64')};
}

test('historical renewal XLSX produces only a redacted, zero-write CRM preview',async()=>{
  const payload=await fixturePayload(),preview=await buildCrmSpreadsheetPreview(payload);
  assert.equal(preview.status,'preview_complete');assert.equal(preview.persisted,false);assert.equal(preview.writeAttempted,false);
  assert.equal(preview.summary.totalRows,3);assert.equal(preview.summary.unpaidRows,2);assert.equal(preview.summary.honoraryDirectorCandidateRows,1);
  assert.equal(preview.summary.missingPhoneRows,3);assert.equal(preview.summary.missingWechatRows,3);assert.equal(preview.summary.unknownGroupRows,2);assert.equal(preview.summary.expiryNeedsReviewRows,1);assert.equal(preview.summary.errorRows,0);
  assert.equal(preview.safeguards.unpaidMeansInactive,false);assert.equal(preview.safeguards.membershipActivated,false);assert.equal(preview.safeguards.publicDirectoryMutationAllowed,false);
  const serialized=JSON.stringify(preview);for(const forbidden of ['匿名甲','匿名丙','示例备注名','仅匿名测试','待确认','499','666'])assert.equal(serialized.includes(forbidden),false,forbidden);
});

test('CRM persistence activation is exact, server-only and fail closed',()=>{
  assert.equal(resolveCrmPersistentImportConfig({}).enabled,false);
  assert.throws(()=>resolveCrmPersistentImportConfig({GOVERNED_MEMBER_IMPORTS_ENABLED:'true'}),/配置不完整/);
  const key=Buffer.alloc(32,5).toString('base64'),production={CRM_PERSISTENT_IMPORTS_ENABLED:'true',GOVERNED_MEMBER_IMPORTS_ENABLED:'true',GOVERNED_MATERIALIZATION_ENABLED:'true',NODE_ENV:'production',DATA_REPOSITORY:'cloudbase_gateway',CLOUDBASE_PG_ENV_ID:'fixture-env',CLOUDBASE_PG_SERVER_API_KEY:'fixture-server-only',CLOUDBASE_PG_REGION:'ap-shanghai',CRM_PERSISTENCE_MIGRATION_APPLIED:'011_crm_master_import',GOVERNED_IMPORT_ENCRYPTION_KEY:key,MEMBER_MATCH_HMAC_KEY:key,GOVERNED_IMPORT_ADMIN_PROVIDER:'external_verified_session',GOVERNED_IMPORT_AUDIT_STORE:'cloudbase_pg',GOVERNED_IMPORT_IDEMPOTENCY_STORE:'cloudbase_pg'};
  assert.throws(()=>resolveCrmPersistentImportConfig({...production,DEMO_DATA_ONLY:'true'}),/匿名 staging/);
  assert.throws(()=>resolveCrmPersistentImportConfig({...production,CRM_PERSISTENCE_MIGRATION_APPLIED:'009_admin_governance'}),/011_crm_master_import/);
  const config=resolveCrmPersistentImportConfig(production);assert.equal(config.safeSummary.memoryFallback,false);assert.equal(JSON.stringify(config.safeSummary).includes('fixture-server-only'),false);
});

test('explicit confirmation checks digest and never falls back when gateway staging fails',async()=>{
  const payload=await fixturePayload(),preview=await buildCrmSpreadsheetPreview(payload);let calls=0;
  const coordinator=new CrmPersistentImportCoordinator({config:{enabled:true,mode:'cloudbase_gateway'},stagingService:{stageCsv:async()=>{calls+=1;throw new Error('upstream secret should not escape')}}});
  await assert.rejects(()=>coordinator.confirm({payload,previewDigest:preview.previewDigest,explicitConfirmation:false}),error=>error.code==='CRM_IMPORT_CONFIRMATION_REQUIRED');assert.equal(calls,0);
  await assert.rejects(()=>coordinator.confirm({payload,previewDigest:'a'.repeat(64),explicitConfirmation:true}),error=>error.code==='CRM_PREVIEW_CHANGED');assert.equal(calls,0);
  await assert.rejects(()=>coordinator.confirm({payload,previewDigest:preview.previewDigest,explicitConfirmation:true,idempotencyKey:'fixture-key'}),error=>error.code==='CRM_PERSISTENCE_UNAVAILABLE'&&!error.message.includes('secret'));assert.equal(calls,1);
});

test('repository chunks regular large batches and finalizes once',async()=>{
  const calls=[],config={enabled:true,mode:'cloudbase_gateway',runtimeEnvironment:'production',origin:'https://fixture.api.tcloudbasegateway.com',serverApiKey:'fixture-only',timeoutMs:1000,maxResponseBytes:4096};
  const repository=new CloudBaseGovernedImportRepository({config,fetchImpl:async(url)=>{calls.push(String(url));return {ok:true,text:async()=>'{}'}}});
  await repository.stageRows({batchId:'batch-fixture',rows:Array.from({length:1200},(_,index)=>({row_id:`row-${index}`}))});
  assert.equal(calls.filter(url=>url.endsWith('/venture_stage_governed_import_chunk')).length,3);assert.equal(calls.filter(url=>url.endsWith('/venture_finalize_governed_import_batch')).length,1);
});
