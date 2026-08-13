'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PassThrough}=require('node:stream');
const {CrmImportRehearsalStore,buildSourceOverview}=require('../src/crm-import-rehearsal');
const server=require('../src/server');

function request(method,pathname,payload){return new Promise((resolve,reject)=>{const req=new PassThrough();req.method=method;req.url=pathname;req.headers={host:'localhost','x-demo-role':'administrator',...(payload?{'content-type':'application/json'}:{})};const response={statusCode:200,headers:{},writeHead(status,headers){this.statusCode=status;this.headers=headers||{}},end(chunk=''){const text=String(chunk||'');resolve({status:this.statusCode,payload:text?JSON.parse(text):{}})}};req.on('error',reject);server.emit('request',req,response);req.end(payload?JSON.stringify(payload):'')})}

test('rehearsal batches retain only safe row state and support completion/conflict decisions',()=>{
  const workbench=new CrmImportRehearsalStore({now:()=> '2026-08-06T00:00:00.000Z'}),rawMarker='never-return-this-name';
  const batch=workbench.create({previewId:'crm-preview-abcdef0123456789',previewDigest:'a'.repeat(64),rows:[{rowNumber:2,missingFields:['phone','wechat_id'],groupStatus:'unknown',paymentStatus:'unpaid',honoraryDirectorCandidate:true,nickname:rawMarker}]});
  assert.equal(batch.summary.formalWriteEligible,false);assert.equal(batch.safeguards.sensitiveValuesStored,false);assert.equal(JSON.stringify(batch).includes(rawMarker),false);
  workbench.updateRow(batch.id,batch.rows[0].id,{action:'mark_field_present',field:'phone'});
  workbench.updateRow(batch.id,batch.rows[0].id,{action:'set_match_resolution',resolution:'conflict'});
  let current=workbench.list()[0];assert.deepEqual(current.rows[0].missingFields,['wechat_id']);assert.equal(current.summary.conflictRows,1);
  workbench.updateRow(batch.id,batch.rows[0].id,{action:'set_match_resolution',resolution:'unique_match'});
  workbench.updateRow(batch.id,batch.rows[0].id,{action:'set_group_status',groupStatus:'in_group'});
  current=workbench.list()[0];assert.equal(current.rows[0].status,'review_ready');assert.equal(current.summary.reviewReadyRows,1);assert.equal(current.summary.persistent,false);
});

test('a validation error cannot be turned into a review-ready row inside rehearsal',()=>{
  const workbench=new CrmImportRehearsalStore(),batch=workbench.create({previewId:'crm-preview-0123456789abcdef',previewDigest:'b'.repeat(64),rows:[{rowNumber:3,hasErrors:true,missingFields:['phone'],groupStatus:'unknown'}]}),row=batch.rows[0];
  workbench.updateRow(batch.id,row.id,{action:'set_match_resolution',resolution:'unique_match'});workbench.updateRow(batch.id,row.id,{action:'set_group_status',groupStatus:'in_group'});
  const current=workbench.list()[0];assert.equal(current.rows[0].status,'needs_correction');assert.equal(current.summary.errorRows,1);assert.equal(current.summary.reviewReadyRows,0);
});

test('CRM source overview keeps OCR and three payment sources aggregate-only',()=>{
  const overview=buildSourceOverview({groupLabelOcrResults:[{reviewStatus:'pending_human_confirmation',candidateUserId:null}],paymentEvidence:[{source:'wechat_shop_order'},{source:'wechat_merchant_receipt'},{source:'manual_transfer'}]});
  assert.deepEqual(overview.map(item=>item.key),['historical_renewal_table','group_label_ocr','wechat_shop_order','wechat_merchant_receipt','manual_transfer']);
  assert.equal(overview.find(item=>item.key==='group_label_ocr').unmatched,1);for(const item of overview)assert.equal('values' in item,false);
});

test('HTTP preview can create a safe review batch while formal write stays 503',async()=>{
  const marker='匿名演练成员-不可回显',previewResponse=await request('POST','/api/admin/imports/internal-crm/preview',{format:'csv',csv:`昵称,到期月份,续费价格,付款状态,群状态\n${marker},2026-08,499,未付,待确认`});
  assert.equal(previewResponse.status,200);const preview=previewResponse.payload;assert.equal(preview.rehearsalRows.length,1);assert.equal(JSON.stringify(preview).includes(marker),false);
  const createResponse=await request('POST','/api/admin/imports/internal-crm/rehearsals',{previewId:preview.previewId,previewDigest:preview.previewDigest,rows:preview.rehearsalRows});
  assert.equal(createResponse.status,201);assert.equal(createResponse.payload.safeguards.rehearsalOnly,true);assert.equal(createResponse.payload.safeguards.memoryBusinessFactsWritten,false);
  const listResponse=await request('GET','/api/admin/imports/internal-crm/rehearsals');assert.equal(listResponse.status,200);assert.equal(listResponse.payload.capabilities.formalWriteEnabled,false);assert.equal(JSON.stringify(listResponse.payload).includes(marker),false);
  const confirm=await request('POST','/api/admin/imports/internal-crm/confirm',{previewDigest:preview.previewDigest});assert.equal(confirm.status,503);assert.equal(confirm.payload.persisted,false);assert.equal(confirm.payload.memoryFallback,false);
});

test('HTTP small-batch canary accepts only an already small anonymous input and never writes facts',async()=>{
  const small=await request('POST','/api/admin/imports/internal-crm/small-batch-canary',{format:'csv',csv:'昵称,到期月份\n匿名甲,2026-08\n匿名乙,2026-08'});
  assert.equal(small.status,200);assert.equal(small.payload.canary.stageEligible,true);assert.equal(small.payload.canary.formalWriteEnabled,false);assert.equal(small.payload.canary.safeguards.crmFactsMutated,false);
  const rows=['昵称,到期月份',...Array.from({length:51},(_,index)=>`匿名${index},2026-08`)];
  const large=await request('POST','/api/admin/imports/internal-crm/small-batch-canary',{format:'csv',csv:rows.join('\n')});
  assert.equal(large.status,200);assert.equal(large.payload.canary.stageEligible,false);assert.ok(large.payload.canary.blockers.includes('prepare_a_separate_operator_selected_small_spreadsheet'));
});

test('admin CRM workbench exposes review steps without claiming persistence',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'),rehearsal=fs.readFileSync(path.join(__dirname,'../src/crm-import-rehearsal.js'),'utf8');
  for(const text of ['脱敏批次审阅工作台','演练补齐','确认唯一匹配','标记匹配冲突','新建待补主档','历史续费追踪表','确认写入正式 CRM（尚未启用）','检查是否适合 50 人小批次'])assert.ok(app.includes(text)||rehearsal.includes(text),text);
  assert.ok(rehearsal.includes('微信群标签 / OCR'));
  assert.ok(app.includes('演练批次不保存原始值，也不会连接 CloudBase'));
  assert.ok(app.includes('身份绑定安全状态'));
  assert.ok(app.includes('未来 012 未应用'));
});

test('CRM readiness exposes only safe offline binding state',async()=>{const response=await request('GET','/api/admin/imports/internal-crm/readiness');assert.equal(response.status,200);assert.deepEqual(response.payload.identityBinding,{status:'offline_preparation_only',futureMigration:'012_not_applied',matchTokenGenerationPrepared:false,tokenRpcTransportEnabled:false,bindingRpcCapabilityVerified:false,formalRoutesEnabled:false,cloudWritesEnabled:false,credentialsRequiredNow:false,rawCrmFieldsExposed:false});assert.equal(JSON.stringify(response.payload).includes('HMAC_KEY'),false)});
