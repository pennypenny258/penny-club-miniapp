'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {sanitizeFilename,validateLocalFile,validateMetadata,normalizeTags,generateTagSuggestions,safeLocalItem}=require('../src/local-import');
const {resolveResourceSection}=require('../src/resource-sections');

test('local import accepts the MVP allowlist and keeps ZIP attachment-only',()=>{
  const pdf=validateLocalFile({filename:'匿名行业报告.pdf',mimeType:'application/pdf',bytes:Buffer.from('%PDF-1.4\nsynthetic')});
  assert.equal(pdf.extension,'.pdf');assert.equal(pdf.previewAvailable,false);
  const zip=validateLocalFile({filename:'匿名附件包.zip',mimeType:'application/zip',bytes:Buffer.from([0x50,0x4b,0x03,0x04,0,0])});
  assert.equal(zip.archiveMode,'attachment_only');
});

test('local import rejects scripts, mismatched signatures and unsafe formula metadata',()=>{
  assert.throws(()=>sanitizeFilename('run.js'),error=>error.code==='LOCAL_IMPORT_FORMAT_REJECTED');
  assert.throws(()=>validateLocalFile({filename:'fake.pdf',mimeType:'application/pdf',bytes:Buffer.from('not pdf')}),error=>error.code==='LOCAL_IMPORT_SIGNATURE_MISMATCH');
  assert.throws(()=>validateMetadata({title:'=HYPERLINK("unsafe")',section:'research_reports'}),error=>error.code==='LOCAL_IMPORT_METADATA_UNSAFE');
});

test('metadata-only entries force downloads off and safe responses omit locators and filenames',()=>{
  const metadata=validateMetadata({title:'匿名资料条目',section:'books',tags:'行业，工具\n行业',downloadEnabled:true},{fileRequired:false});
  assert.equal(metadata.downloadEnabled,false);
  assert.deepEqual(metadata.tags,['行业','工具']);
  const safe=safeLocalItem({id:'item',safeFilename:'private.pdf',privateStorageRef:'private:opaque',title:'匿名资料',status:'pending_review'}),serialized=JSON.stringify(safe);
  assert.equal(safe.fileStored,true);assert.equal(safe.storageLocatorReturned,false);assert.equal(serialized.includes('private.pdf'),false);assert.equal(serialized.includes('private:opaque'),false);
});

test('keyword tags normalize Chinese commas and newlines with safe limits',()=>{
  assert.deepEqual(normalizeTags('报告，工具\n报告, 投研'),['报告','工具','投研']);
  assert.equal(normalizeTags(Array.from({length:15},(_,i)=>`标签${i}`)).length,10);
  assert.throws(()=>normalizeTags('=HYPERLINK("unsafe")'),error=>error.code==='LOCAL_IMPORT_METADATA_UNSAFE');
});

test('rule suggestions are useful without claiming AI or file-text access',()=>{
  const suggestion=generateTagSuggestions({title:'AI 时代软件行业增长报告',filename:'software-growth-report.pdf',extension:'.pdf',mimeType:'application/pdf',section:'research_reports'});
  assert.ok(suggestion.candidates.length>=3&&suggestion.candidates.length<=8);for(const tag of ['AI','软件','增长'])assert.ok(suggestion.candidates.includes(tag),tag);
  assert.equal(suggestion.source,'metadata_rules');assert.equal(suggestion.status,'rule_suggested_pending_confirmation');assert.equal(suggestion.aiConfigured,false);assert.equal(suggestion.aiUsed,false);assert.equal(suggestion.contentStatus,'text_extraction_not_configured');assert.match(suggestion.contentNotice,/仅使用标题、分类和文件名/);
});

test('images and media require OCR or transcription and sensitive candidates are filtered',()=>{
  const image=generateTagSuggestions({title:'匿名融资图片',filename:'scan.png',extension:'.png',mimeType:'image/png',section:'research_reports'});assert.equal(image.contentStatus,'ocr_required');assert.match(image.contentNotice,/当前未读取图片内容/);assert.equal(image.aiUsed,false);
  const audio=generateTagSuggestions({title:'匿名分享',filename:'meeting.m4a',extension:'.m4a',mimeType:'audio/mp4',section:'replays'});assert.equal(audio.contentStatus,'transcription_required');assert.match(audio.contentNotice,/当前未听取音频/);
  assert.deepEqual(normalizeTags(['行业','api_key: secret','13800138000','user@example.com']),['行业']);
});

test('legacy combined categories split only when safe metadata is decisive',()=>{
  assert.deepEqual(resolveResourceSection({mobileSection:'reports_digests',type:'industry_report'}).section,'research_reports');
  assert.deepEqual(resolveResourceSection({section:'reports_digest',type:'group_digest'}).section,'group_digests');
  const ambiguous=validateMetadata({title:'匿名历史资料',section:'reports_digest'});assert.equal(ambiguous.section,'unclassified');assert.equal(ambiguous.needsClassification,true);
  const digest=validateMetadata({title:'匿名群聊精华整理',section:'reports_digest'});assert.equal(digest.section,'group_digests');assert.equal(digest.needsClassification,false);
});
