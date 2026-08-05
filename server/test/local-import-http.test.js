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
