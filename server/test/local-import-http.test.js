'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
process.env.PRIVATE_STORAGE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'venture-local-private-'));
const server=require('../src/server');
const store=require('../src/store');
const confirmed={operatorConfirmed:true,copyrightConfirmed:true,securityResponsibilityConfirmed:true};

const call=(pathname,{method='GET',body,contentType,headers={},user='active'}={})=>new Promise((resolve,reject)=>{const req=new PassThrough();req.method=method;req.url=pathname;req.headers={host:'localhost','x-demo-role':'administrator','x-demo-user':user,...headers,...(contentType?{'content-type':contentType}:body&&!Buffer.isBuffer(body)?{'content-type':'application/json'}:{})};const response={statusCode:200,headers:{},writeHead(status,responseHeaders){this.statusCode=status;this.headers=responseHeaders||{}},end(chunk=''){const text=String(chunk||'');resolve({status:this.statusCode,payload:text?JSON.parse(text):{}})}};req.on('error',reject);server.emit('request',req,response);req.end(Buffer.isBuffer(body)?body:body?JSON.stringify(body):'')});
function multipart(metadata,filename,mimeType,bytes){const boundary='----ventureSyntheticBoundary',chunks=[Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)];return {body:Buffer.concat(chunks),contentType:`multipart/form-data; boundary=${boundary}`}}
function multipartMany(metadata,files){const boundary='----ventureSyntheticBatchBoundary',chunks=[Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n`)];for(const file of files)chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`),file.bytes,Buffer.from('\r\n'));chunks.push(Buffer.from(`--${boundary}--\r\n`));return {body:Buffer.concat(chunks),contentType:`multipart/form-data; boundary=${boundary}`}}

test('controlled computer upload publishes immediately into member resources and timeline',async()=>{
  const longTitle='匿名端到端研究报告：这是一个用于验证移动端长标题两行显示与完整名称可访问性的安全合成标题';
  const uploadBody=multipart([{...confirmed,title:longTitle,summary:'仅用于安全回归。',tags:'匿名验收，行业\n匿名验收',section:'research_reports',sourceNote:'本地迁入',downloadEnabled:true,needsClassification:false}],'synthetic-report.pdf','application/pdf',Buffer.from('%PDF-1.4\nsynthetic fixture'));
  const uploaded=await call('/api/admin/local-imports/upload',{method:'POST',...uploadBody});assert.equal(uploaded.status,201);const serialized=JSON.stringify(uploaded.payload);assert.equal(serialized.includes('private:'),false);assert.equal(serialized.includes('synthetic-report.pdf'),false);const item=uploaded.payload.items[0];assert.equal(item.fileStored,true);
  assert.equal(item.status,'published');assert.equal(uploaded.payload.batch.publishedRows,1);assert.equal(uploaded.payload.batch.reviewRows,0);
  assert.equal(item.tagSuggestion.aiUsed,false);assert.equal(item.tagSuggestion.source,'metadata_rules');assert.ok(item.tagSuggestion.candidates.length>=3);assert.equal(item.tagStatus,'manual_confirmed');
  const after=await call('/api/resources');const visible=after.payload.find(x=>x.title===longTitle);assert.ok(visible);assert.equal(visible.downloadEnabled,true);assert.deepEqual(visible.tags,['匿名验收','行业']);for(const forbidden of ['privateStorageRef','storageKey','privateAttachments','safeFilename','sourceNote'])assert.equal(JSON.stringify(visible).includes(forbidden),false,forbidden);
  const feed=await call('/api/feed');const timelineItem=feed.payload.items.find(x=>x.targetId===visible.id);assert.ok(timelineItem);assert.equal(timelineItem.title,longTitle);assert.ok(new Date(timelineItem.updatedAt).getTime()>0);
  const retagged=await call(`/api/admin/local-import-items/${item.id}`,{method:'PATCH',body:{title:longTitle+'（更新）',section:'research_reports',tags:'软件，AI\n软件',downloadEnabled:false}});assert.equal(retagged.status,200);assert.deepEqual(retagged.payload.tags,['软件','AI']);assert.equal(retagged.payload.status,'published');
  const searched=await call('/api/feed?query='+encodeURIComponent('AI'));assert.equal(searched.payload.items.some(x=>x.targetId===visible.id),true);
  const viewed=await call(`/api/resources/${visible.id}/view`);assert.equal(viewed.status,200);assert.equal(viewed.payload.viewStatus,'preview_not_configured');assert.match(viewed.payload.message,/在线预览能力待配置/);
  const regenerated=await call(`/api/admin/local-import-items/${item.id}/tag-suggestions`,{method:'POST',body:{}});assert.equal(regenerated.status,200);assert.equal(regenerated.payload.tagSuggestion.aiUsed,false);assert.equal(regenerated.payload.tagSuggestion.status,'rule_suggested_pending_confirmation');
});

test('direct publish requires operator acknowledgements and an admin route',async()=>{
  const missing=multipart([{title:'匿名未确认资料',section:'research_reports'}],'missing.pdf','application/pdf',Buffer.from('%PDF-1.4\nsynthetic'));
  const denied=await call('/api/admin/local-imports/upload',{method:'POST',...missing});assert.equal(denied.status,409);assert.equal(denied.payload.code,'LOCAL_IMPORT_ACKNOWLEDGEMENT_REQUIRED');
  const ordinary=multipart([{...confirmed,title:'匿名普通用户尝试',section:'research_reports'}],'ordinary.pdf','application/pdf',Buffer.from('%PDF-1.4\nsynthetic'));
  const forbidden=await call('/api/admin/local-imports/upload',{method:'POST',...ordinary,headers:{'x-demo-role':'unknown-role'}});assert.equal(forbidden.status,403);
});

test('metadata-only import creates a controlled missing-attachment queue item',async()=>{
  const response=await call('/api/admin/local-imports/metadata',{method:'POST',body:{items:[{title:'匿名待补附件资料',section:'books',sourceNote:'本地迁入',downloadEnabled:true}]}});assert.equal(response.status,201);const item=response.payload.items[0];assert.equal(item.attachmentStatus,'missing');assert.equal(item.downloadEnabled,false);assert.equal(item.fileStored,false);
});

test('computer upload rejects executable extensions before private storage',async()=>{
  const uploadBody=multipart([{...confirmed,title:'匿名不安全文件',section:'files_templates'}],'unsafe.js','text/javascript',Buffer.from('console.log(1)'));
  const response=await call('/api/admin/local-imports/upload',{method:'POST',...uploadBody});assert.equal(response.status,415);assert.equal(response.payload.code,'LOCAL_IMPORT_FORMAT_REJECTED');
});

test('report and book batch publishes safe files, isolates failure and supports explicit historical transition',async()=>{
  const metadata=[
    {...confirmed,title:'匿名行业报告甲',section:'research_reports',tags:'行业，批量\n行业',downloadEnabled:false},
    {...confirmed,title:'匿名书籍乙',section:'books',tags:'阅读，批量',downloadEnabled:false},
    {...confirmed,title:'匿名失败项',section:'books',tags:'批量',downloadEnabled:false}
  ];
  const uploadBody=multipartMany(metadata,[
    {filename:'synthetic-report-a.pdf',mimeType:'application/pdf',bytes:Buffer.from('%PDF-1.4\nsynthetic report')},
    {filename:'synthetic-book-b.md',mimeType:'text/markdown',bytes:Buffer.from('# Synthetic anonymous book')},
    {filename:'unsafe-script.js',mimeType:'text/javascript',bytes:Buffer.from('console.log(1)')}
  ]);
  const uploaded=await call('/api/admin/local-imports/upload',{method:'POST',...uploadBody});
  assert.equal(uploaded.status,201);assert.equal(uploaded.payload.partial,true);assert.equal(uploaded.payload.batch.totalRows,3);assert.equal(uploaded.payload.batch.validRows,2);assert.equal(uploaded.payload.batch.errorRows,1);assert.equal(uploaded.payload.items.length,2);assert.equal(uploaded.payload.errors.length,1);assert.equal(uploaded.payload.errors[0].fileIndex,3);assert.equal(uploaded.payload.errors[0].code,'LOCAL_IMPORT_FORMAT_REJECTED');
  const serialized=JSON.stringify(uploaded.payload);for(const forbidden of ['synthetic-report-a.pdf','synthetic-book-b.md','unsafe-script.js','privateStorageRef','storageKey','privateAttachments','private:'])assert.equal(serialized.includes(forbidden),false,forbidden);
  const before=await call('/api/resources');assert.equal(before.payload.filter(x=>x.title==='匿名行业报告甲'||x.title==='匿名书籍乙').length,2);assert.equal(uploaded.payload.batch.publishedRows,2);
  const batchId=uploaded.payload.batch.id;
  const historical=store.localImportItems.find(x=>x.id===uploaded.payload.items[0].id),historicalResource=store.resources.find(x=>x.id===historical.resourceId);historical.status='pending_review';historical.securityReviewStatus='pending_manual_security_review';historicalResource.status='draft';historicalResource.sourceStatus='needs_rights_review';historicalResource.migrationStatus='needs_review';
  const bulk=await call(`/api/admin/local-import-batches/${batchId}/apply-metadata`,{method:'PATCH',body:{section:'books',tags:'批量标签，阅读\n批量标签',downloadEnabled:true}});
  assert.equal(bulk.status,200);assert.equal(bulk.payload.updatedCount,1);assert.equal(bulk.payload.skippedCount,1);assert.equal(bulk.payload.pendingOnly,true);assert.equal(bulk.payload.items[0].status,'pending_review');
  const overridden=await call(`/api/admin/local-import-items/${bulk.payload.items[0].id}`,{method:'PATCH',body:{section:'research_reports',tags:'行业报告，单项覆盖',downloadEnabled:false}});assert.equal(overridden.status,200);assert.equal(overridden.payload.section,'research_reports');assert.deepEqual(overridden.payload.tags,['行业报告','单项覆盖']);assert.equal(overridden.payload.downloadEnabled,false);
  const published=await call(`/api/admin/local-import-items/${historical.id}/review`,{method:'POST',body:{decision:'publish',copyrightConfirmed:true,securityConfirmed:true},headers:{'x-admin-confirmation':'resource.publish','idempotency-key':'local-batch-publish-fixture'}});assert.equal(published.status,200);assert.equal(published.payload.status,'published');
  const search=await call('/api/feed?query='+encodeURIComponent('单项覆盖'));assert.equal(search.status,200);const visible=search.payload.items.find(x=>x.targetId===historical.resourceId);assert.ok(visible);for(const forbidden of ['privateStorageRef','storageKey','privateAttachments','safeFilename','sourceNote'])assert.equal(JSON.stringify(visible).includes(forbidden),false,forbidden);
  const unpublished=await call(`/api/admin/local-import-items/${historical.id}/review`,{method:'POST',body:{decision:'unpublish'},headers:{'x-admin-confirmation':'resource.publish','idempotency-key':'local-batch-unpublish-fixture'}});assert.equal(unpublished.status,200);assert.equal(unpublished.payload.status,'unpublished');const afterUnpublish=await call('/api/feed?query='+encodeURIComponent('单项覆盖'));assert.equal(afterUnpublish.payload.items.some(x=>x.targetId===historical.resourceId),false);
});
