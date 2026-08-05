'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
process.env.PRIVATE_STORAGE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'venture-local-private-'));
const server=require('../src/server');

const call=(pathname,{method='GET',body,contentType,headers={},user='active'}={})=>new Promise((resolve,reject)=>{const req=new PassThrough();req.method=method;req.url=pathname;req.headers={host:'localhost','x-demo-role':'administrator','x-demo-user':user,...headers,...(contentType?{'content-type':contentType}:body&&!Buffer.isBuffer(body)?{'content-type':'application/json'}:{})};const response={statusCode:200,headers:{},writeHead(status,responseHeaders){this.statusCode=status;this.headers=responseHeaders||{}},end(chunk=''){const text=String(chunk||'');resolve({status:this.statusCode,payload:text?JSON.parse(text):{}})}};req.on('error',reject);server.emit('request',req,response);req.end(Buffer.isBuffer(body)?body:body?JSON.stringify(body):'')});
function multipart(metadata,filename,mimeType,bytes){const boundary='----ventureSyntheticBoundary',chunks=[Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)];return {body:Buffer.concat(chunks),contentType:`multipart/form-data; boundary=${boundary}`}}
function multipartMany(metadata,files){const boundary='----ventureSyntheticBatchBoundary',chunks=[Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n`)];for(const file of files)chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`),file.bytes,Buffer.from('\r\n'));chunks.push(Buffer.from(`--${boundary}--\r\n`));return {body:Buffer.concat(chunks),contentType:`multipart/form-data; boundary=${boundary}`}}

test('computer upload remains pending until confirmed and member responses stay locator-free',async()=>{
  const uploadBody=multipart([{title:'匿名端到端报告',summary:'仅用于安全回归。',tags:'匿名验收，行业\n匿名验收',section:'reports_digest',sourceNote:'本地迁入',downloadEnabled:true,needsClassification:false}],'synthetic-report.pdf','application/pdf',Buffer.from('%PDF-1.4\nsynthetic fixture'));
  const uploaded=await call('/api/admin/local-imports/upload',{method:'POST',...uploadBody});assert.equal(uploaded.status,201);const serialized=JSON.stringify(uploaded.payload);assert.equal(serialized.includes('private:'),false);assert.equal(serialized.includes('synthetic-report.pdf'),false);const item=uploaded.payload.items[0];assert.equal(item.status,'pending_review');assert.equal(item.fileStored,true);
  assert.equal(item.tagSuggestion.aiUsed,false);assert.equal(item.tagSuggestion.source,'metadata_rules');assert.ok(item.tagSuggestion.candidates.length>=3);assert.equal(item.tagStatus,'manual_confirmed');
  const before=await call('/api/resources');assert.equal(before.payload.some(x=>x.title==='匿名端到端报告'),false);
  const blocked=await call(`/api/admin/local-import-items/${item.id}/review`,{method:'POST',body:{decision:'publish',copyrightConfirmed:true,securityConfirmed:true}});assert.equal(blocked.status,428);
  const published=await call(`/api/admin/local-import-items/${item.id}/review`,{method:'POST',body:{decision:'publish',copyrightConfirmed:true,securityConfirmed:true},headers:{'x-admin-confirmation':'resource.publish','idempotency-key':'local-import-publish-fixture'}});assert.equal(published.status,200);
  const after=await call('/api/resources');const visible=after.payload.find(x=>x.title==='匿名端到端报告');assert.ok(visible);assert.equal(visible.downloadEnabled,true);assert.deepEqual(visible.tags,['匿名验收','行业']);for(const forbidden of ['privateStorageRef','storageKey','privateAttachments','safeFilename','sourceNote'])assert.equal(JSON.stringify(visible).includes(forbidden),false,forbidden);
  const retagged=await call(`/api/admin/local-import-items/${item.id}`,{method:'PATCH',body:{tags:'软件，AI\n软件'}});assert.equal(retagged.status,200);assert.deepEqual(retagged.payload.tags,['软件','AI']);assert.equal(retagged.payload.status,'published');
  const searched=await call('/api/feed?query='+encodeURIComponent('AI'));assert.equal(searched.payload.items.some(x=>x.targetId===visible.id),true);
  const viewed=await call(`/api/resources/${visible.id}/view`);assert.equal(viewed.status,200);assert.equal(viewed.payload.viewStatus,'preview_not_configured');assert.match(viewed.payload.message,/在线预览能力待配置/);
  const regenerated=await call(`/api/admin/local-import-items/${item.id}/tag-suggestions`,{method:'POST',body:{}});assert.equal(regenerated.status,200);assert.equal(regenerated.payload.tagSuggestion.aiUsed,false);assert.equal(regenerated.payload.tagSuggestion.status,'rule_suggested_pending_confirmation');
});

test('metadata-only import creates a controlled missing-attachment queue item',async()=>{
  const response=await call('/api/admin/local-imports/metadata',{method:'POST',body:{items:[{title:'匿名待补附件资料',section:'books',sourceNote:'本地迁入',downloadEnabled:true}]}});assert.equal(response.status,201);const item=response.payload.items[0];assert.equal(item.attachmentStatus,'missing');assert.equal(item.downloadEnabled,false);assert.equal(item.fileStored,false);
});

test('computer upload rejects executable extensions before private storage',async()=>{
  const uploadBody=multipart([{title:'匿名不安全文件',section:'files_templates'}],'unsafe.js','text/javascript',Buffer.from('console.log(1)'));
  const response=await call('/api/admin/local-imports/upload',{method:'POST',...uploadBody});assert.equal(response.status,415);assert.equal(response.payload.code,'LOCAL_IMPORT_FORMAT_REJECTED');
});

test('report and book batch keeps safe files when one item fails, then supports pending-only bulk metadata',async()=>{
  const metadata=[
    {title:'匿名行业报告甲',section:'reports_digest',tags:'行业，批量\n行业',downloadEnabled:false},
    {title:'匿名书籍乙',section:'books',tags:'阅读，批量',downloadEnabled:false},
    {title:'匿名失败项',section:'books',tags:'批量',downloadEnabled:false}
  ];
  const uploadBody=multipartMany(metadata,[
    {filename:'synthetic-report-a.pdf',mimeType:'application/pdf',bytes:Buffer.from('%PDF-1.4\nsynthetic report')},
    {filename:'synthetic-book-b.md',mimeType:'text/markdown',bytes:Buffer.from('# Synthetic anonymous book')},
    {filename:'unsafe-script.js',mimeType:'text/javascript',bytes:Buffer.from('console.log(1)')}
  ]);
  const uploaded=await call('/api/admin/local-imports/upload',{method:'POST',...uploadBody});
  assert.equal(uploaded.status,201);assert.equal(uploaded.payload.partial,true);assert.equal(uploaded.payload.batch.totalRows,3);assert.equal(uploaded.payload.batch.validRows,2);assert.equal(uploaded.payload.batch.errorRows,1);assert.equal(uploaded.payload.items.length,2);assert.equal(uploaded.payload.errors.length,1);assert.equal(uploaded.payload.errors[0].fileIndex,3);assert.equal(uploaded.payload.errors[0].code,'LOCAL_IMPORT_FORMAT_REJECTED');
  const serialized=JSON.stringify(uploaded.payload);for(const forbidden of ['synthetic-report-a.pdf','synthetic-book-b.md','unsafe-script.js','privateStorageRef','storageKey','privateAttachments','private:'])assert.equal(serialized.includes(forbidden),false,forbidden);
  const before=await call('/api/resources');assert.equal(before.payload.some(x=>x.title==='匿名行业报告甲'||x.title==='匿名书籍乙'),false);
  const batchId=uploaded.payload.batch.id;
  const bulk=await call(`/api/admin/local-import-batches/${batchId}/apply-metadata`,{method:'PATCH',body:{section:'books',tags:'批量标签，阅读\n批量标签',downloadEnabled:true}});
  assert.equal(bulk.status,200);assert.equal(bulk.payload.updatedCount,2);assert.equal(bulk.payload.pendingOnly,true);for(const item of bulk.payload.items){assert.equal(item.section,'books');assert.deepEqual(item.tags,['批量标签','阅读']);assert.equal(item.downloadEnabled,true);assert.equal(item.status,'pending_review')}
  const overridden=await call(`/api/admin/local-import-items/${bulk.payload.items[0].id}`,{method:'PATCH',body:{section:'reports_digest',tags:'行业报告，单项覆盖',downloadEnabled:false}});assert.equal(overridden.status,200);assert.equal(overridden.payload.section,'reports_digest');assert.deepEqual(overridden.payload.tags,['行业报告','单项覆盖']);assert.equal(overridden.payload.downloadEnabled,false);
  const published=await call(`/api/admin/local-import-items/${bulk.payload.items[1].id}/review`,{method:'POST',body:{decision:'publish',copyrightConfirmed:true,securityConfirmed:true},headers:{'x-admin-confirmation':'resource.publish','idempotency-key':'local-batch-publish-fixture'}});assert.equal(published.status,200);
  const search=await call('/api/feed?query='+encodeURIComponent('批量标签'));assert.equal(search.status,200);const visible=search.payload.items.find(x=>x.targetId===bulk.payload.items[1].resourceId);assert.ok(visible);assert.deepEqual(visible.tags,['批量标签','阅读']);for(const forbidden of ['privateStorageRef','storageKey','privateAttachments','safeFilename','sourceNote'])assert.equal(JSON.stringify(visible).includes(forbidden),false,forbidden);
  const postPublishBulk=await call(`/api/admin/local-import-batches/${batchId}/apply-metadata`,{method:'PATCH',body:{section:'books',tags:'再次批量',downloadEnabled:false}});assert.equal(postPublishBulk.status,200);assert.equal(postPublishBulk.payload.updatedCount,1);assert.equal(postPublishBulk.payload.skippedCount,1);
});
