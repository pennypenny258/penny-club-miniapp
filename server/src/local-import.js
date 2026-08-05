'use strict';

const path=require('node:path');
const {PUBLIC_RESOURCE_SECTIONS,LEGACY_COMBINED_SECTIONS,resolveResourceSection}=require('./resource-sections');

const MAX_FILE_BYTES=25*1024*1024;
const MAX_TOTAL_BYTES=100*1024*1024;
const MAX_FILES=20;
const SECTIONS=new Set([...PUBLIC_RESOURCE_SECTIONS,'unclassified']);
const SECTION_TYPES={replays:'meeting_replay',research_reports:'industry_report',group_digests:'group_digest',books:'book',files_templates:'tool',benefits:'benefit_update',unclassified:'unclassified_resource'};
const SECTION_SUGGESTIONS={replays:['回放','线上分享','活动资料'],research_reports:['研究报告','投研','行业研究'],group_digests:['群聊精华','讨论整理','社群知识'],books:['书目','阅读','学习资料'],files_templates:['工具','文件模板','实用资料'],benefits:['会员福利','规则','福利更新'],unclassified:['待分类','资料整理','人工复核']};
const TOPIC_RULES=[
  [/(?:人工智能|生成式\s*ai|\bai\b)/i,'AI'],[/(?:软件|software)/i,'软件'],[/(?:saas|企业服务)/i,'企业服务'],[/(?:机器人|robot)/i,'机器人'],[/(?:半导体|芯片)/i,'半导体'],[/(?:新能源|光伏|储能)/i,'新能源'],[/(?:医疗|生物医药)/i,'医疗健康'],[/(?:消费|品牌)/i,'消费'],[/(?:出海|海外)/i,'出海'],[/(?:融资|融资额)/i,'融资'],[/(?:并购|m&a)/i,'并购'],[/(?:招聘|岗位)/i,'招聘'],[/(?:投资|创投|一级市场)/i,'投资'],[/(?:尽调|尽职调查)/i,'尽调'],[/(?:增长|growth)/i,'增长'],[/(?:商业化)/i,'商业化'],[/(?:行业|产业)/i,'行业研究'],[/(?:赛道)/i,'赛道'],[/(?:报告|report)/i,'报告'],[/(?:回放|复盘)/i,'回放'],[/(?:群聊精华|群聊)/i,'群聊精华']
];
const ALLOWED={
  '.pdf':['application/pdf'],
  '.docx':['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/octet-stream'],
  '.xlsx':['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'],
  '.pptx':['application/vnd.openxmlformats-officedocument.presentationml.presentation','application/octet-stream'],
  '.mp4':['video/mp4','application/octet-stream'],
  '.mp3':['audio/mpeg','audio/mp3','application/octet-stream'],
  '.m4a':['audio/mp4','audio/x-m4a','application/octet-stream'],
  '.png':['image/png','application/octet-stream'],
  '.jpg':['image/jpeg','application/octet-stream'],
  '.jpeg':['image/jpeg','application/octet-stream'],
  '.md':['text/markdown','text/plain','application/octet-stream'],
  '.txt':['text/plain','application/octet-stream'],
  '.zip':['application/zip','application/x-zip-compressed','application/octet-stream']
};

function safeText(value,{required=false,max=200,label='字段'}={}){
  const text=String(value||'').normalize('NFC').trim();
  if(required&&!text)throw Object.assign(new Error(`${label}不能为空`),{statusCode:400,code:'LOCAL_IMPORT_METADATA_INVALID'});
  if(text.length>max||/[\u0000-\u001f\u007f]/.test(text)||/^[=+@]/.test(text)||/^-\s*(?:cmd|powershell|hyperlink|webservice)\s*\(/i.test(text))throw Object.assign(new Error(`${label}包含不安全字符或公式前缀`),{statusCode:400,code:'LOCAL_IMPORT_METADATA_UNSAFE'});
  return text;
}

function sanitizeFilename(filename){
  const base=path.basename(String(filename||'')).normalize('NFC').replace(/[\u0000-\u001f\u007f/\\:]/g,'_').replace(/^\.+/,'').replace(/\s+/g,' ').trim();
  if(!base)throw Object.assign(new Error('文件名无效'),{statusCode:400,code:'LOCAL_IMPORT_FILENAME_INVALID'});
  const ext=path.extname(base).toLowerCase();
  if(!ALLOWED[ext])throw Object.assign(new Error('文件格式不在允许名单内'),{statusCode:415,code:'LOCAL_IMPORT_FORMAT_REJECTED'});
  const stem=path.basename(base,ext).slice(0,90).replace(/[=+@]/g,'_');
  return {safeName:`${stem||'资料'}${ext}`,extension:ext};
}

function hasPrefix(bytes,values){return values.every((value,index)=>bytes[index]===value)}
function validateMagic(extension,bytes){
  if(extension==='.pdf'&&!hasPrefix(bytes,[0x25,0x50,0x44,0x46]))return false;
  if(['.docx','.xlsx','.pptx','.zip'].includes(extension)&&!hasPrefix(bytes,[0x50,0x4b]))return false;
  if(extension==='.png'&&!hasPrefix(bytes,[0x89,0x50,0x4e,0x47]))return false;
  if(['.jpg','.jpeg'].includes(extension)&&!hasPrefix(bytes,[0xff,0xd8,0xff]))return false;
  if(extension==='.mp4'&&bytes.slice(4,8).toString('ascii')!=='ftyp')return false;
  return true;
}

function validateLocalFile({filename,mimeType,bytes,maxBytes=MAX_FILE_BYTES}){
  const buffer=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes||[]);
  if(!buffer.length)throw Object.assign(new Error('文件为空'),{statusCode:400,code:'LOCAL_IMPORT_FILE_EMPTY'});
  if(buffer.length>maxBytes)throw Object.assign(new Error('单个文件超过 25MB 演示限制'),{statusCode:413,code:'LOCAL_IMPORT_FILE_TOO_LARGE'});
  const {safeName,extension}=sanitizeFilename(filename),mime=String(mimeType||'application/octet-stream').split(';')[0].toLowerCase();
  if(!ALLOWED[extension].includes(mime))throw Object.assign(new Error('文件扩展名与内容类型不匹配'),{statusCode:415,code:'LOCAL_IMPORT_MIME_MISMATCH'});
  if(!validateMagic(extension,buffer))throw Object.assign(new Error('文件内容与声明格式不匹配'),{statusCode:415,code:'LOCAL_IMPORT_SIGNATURE_MISMATCH'});
  if(['.md','.txt'].includes(extension)){const text=buffer.toString('utf8');if(text.includes('\0')||/^\s*(?:<script\b|#!)|^[=+@]/im.test(text))throw Object.assign(new Error('文本文件包含脚本或公式注入风险'),{statusCode:400,code:'LOCAL_IMPORT_TEXT_UNSAFE'});}
  return {safeName,extension,mimeType:mime,sizeBytes:buffer.length,archiveMode:extension==='.zip'?'attachment_only':null,previewAvailable:false,securityReviewStatus:'pending_manual_security_review'};
}

function validateMetadata(input,{fileRequired=false}={}){
  const title=safeText(input.title,{required:true,max:120,label:'标题'}),tags=normalizeTags(input.tags),requested=String(input.section||'');
  const resolved=LEGACY_COMBINED_SECTIONS.has(requested)?resolveResourceSection({section:requested,type:input.type,title,tags}):{section:requested,needsClassification:requested==='unclassified'};
  const section=resolved.section;if(!SECTIONS.has(section))throw Object.assign(new Error('资料分类无效'),{statusCode:400,code:'LOCAL_IMPORT_SECTION_INVALID'});
  const needsClassification=Boolean(input.needsClassification)||resolved.needsClassification||section==='unclassified';
  return {title,summary:safeText(input.summary,{max:300,label:'摘要'}),tags,sourceNote:safeText(input.sourceNote||'本地迁入',{max:120,label:'来源说明'})||'本地迁入',section,type:SECTION_TYPES[section],downloadEnabled:fileRequired?Boolean(input.downloadEnabled):false,needsClassification};
}

function normalizeTags(value){
  const raw=Array.isArray(value)?value:String(value||'').split(/[,，\n\r|]+/),result=[],seen=new Set();
  for(const entry of raw){const tag=safeText(entry,{max:24,label:'关键词标签'});if(!tag||isSensitiveTag(tag))continue;const key=tag.toLocaleLowerCase('zh-CN');if(seen.has(key))continue;seen.add(key);result.push(tag);if(result.length===10)break}
  return result;
}

function isSensitiveTag(tag){return /(?:https?:\/\/|www\.|\b(?:app_?secret|api_?key|access_?token|password)\b|\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:微信|手机|电话|邮箱)\s*[:：])/i.test(String(tag||''))}
function contentGenerationBoundary({extension='',mimeType=''}){
  const ext=String(extension||'').toLowerCase(),mime=String(mimeType||'').toLowerCase();
  if(['.png','.jpg','.jpeg'].includes(ext)||mime.startsWith('image/'))return {contentStatus:'ocr_required',contentNotice:'图片需先配置 OCR，才能依据内容生成标签；当前未读取图片内容。'};
  if(['.mp3','.m4a'].includes(ext)||mime.startsWith('audio/'))return {contentStatus:'transcription_required',contentNotice:'音频需先配置转写，才能依据内容生成标签；当前未听取音频。'};
  if(ext==='.mp4'||mime.startsWith('video/'))return {contentStatus:'transcription_required',contentNotice:'视频需先配置音轨转写/帧 OCR，才能依据内容生成标签；当前未观看视频。'};
  if(['.pdf','.docx','.md','.txt'].includes(ext))return {contentStatus:'text_extraction_not_configured',contentNotice:ext==='.pdf'?'尚未配置稳健的 PDF 文本提取；若为扫描 PDF 还需 OCR。当前仅使用标题、分类和文件名。':'尚未配置稳健的文本提取；当前仅使用标题、分类和文件名。'};
  return {contentStatus:'metadata_only',contentNotice:'当前仅使用标题、分类和文件名生成规则建议，未读取文件内容。'};
}
function generateTagSuggestions({title='',section='research_reports',filename='',extension='',mimeType='',extractedText='',textExtractionConfigured=false,aiConfigured=false}={}){
  const hasExtractedText=textExtractionConfigured&&String(extractedText||'').trim(),basis=`${title} ${filename} ${hasExtractedText?extractedText:''}`,candidates=[];
  for(const [pattern,tag] of TOPIC_RULES)if(pattern.test(basis))candidates.push(tag);
  candidates.push(...(SECTION_SUGGESTIONS[section]||['资料']));
  const stem=path.basename(String(filename||''),path.extname(String(filename||''))).replace(/[\s_\-]+/g,' ').trim();
  for(const token of stem.split(/[\s—–_:：+()（）\[\]【】]+/).filter(Boolean)){if(token.length>=2&&token.length<=12&&!/^(?:final|v\d+|copy|最终|完整版|附件|资料)$/i.test(token))candidates.push(token);if(candidates.length>=8)break}
  const normalized=normalizeTags(candidates).slice(0,8);for(const fallback of SECTION_SUGGESTIONS[section]||['资料'])if(normalized.length<3&&!normalized.includes(fallback))normalized.push(fallback);
  const boundary=hasExtractedText?{contentStatus:'text_extracted',contentNotice:'建议包含已安全提取的文本特征。'}:contentGenerationBoundary({extension,mimeType});
  return {candidates:normalized.slice(0,8),source:hasExtractedText?'file_text_rules':'metadata_rules',status:'rule_suggested_pending_confirmation',label:hasExtractedText?'从文件文本生成的规则建议，待确认':'规则建议，待确认',aiConfigured:Boolean(aiConfigured),aiUsed:false,...boundary};
}

function safeLocalItem(item){const {privateStorageRef,safeFilename,...safe}=item;return {...safe,fileStored:Boolean(privateStorageRef),storageLocatorReturned:false};}

function readMultipart(req,{maxTotalBytes=MAX_TOTAL_BYTES,maxFiles=MAX_FILES}={}){
  return new Promise((resolve,reject)=>{
    const contentType=String(req.headers['content-type']||''),match=contentType.match(/^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i),declared=Number(req.headers['content-length']||0);
    if(!match)return reject(Object.assign(new Error('上传请求必须使用 multipart/form-data'),{statusCode:415,code:'LOCAL_IMPORT_MULTIPART_REQUIRED'}));
    if(declared&&declared>maxTotalBytes)return reject(Object.assign(new Error('本批文件超过 100MB 演示限制'),{statusCode:413,code:'LOCAL_IMPORT_BATCH_TOO_LARGE'}));
    const boundary=match[1]||match[2],chunks=[];let size=0,finished=false;
    const fail=error=>{if(finished)return;finished=true;reject(error)};
    req.on('data',chunk=>{if(finished)return;size+=chunk.length;if(size>maxTotalBytes)return fail(Object.assign(new Error('本批文件超过 100MB 演示限制'),{statusCode:413,code:'LOCAL_IMPORT_BATCH_TOO_LARGE'}));chunks.push(chunk)});
    req.on('error',fail);
    req.on('end',()=>{if(finished)return;try{
      const raw=Buffer.concat(chunks),delimiter=Buffer.from(`--${boundary}`),separator=Buffer.from('\r\n\r\n'),fields={},files=[];let cursor=raw.indexOf(delimiter);
      while(cursor>=0){let start=cursor+delimiter.length;if(raw.slice(start,start+2).toString()==='--')break;if(raw.slice(start,start+2).toString()==='\r\n')start+=2;const next=raw.indexOf(delimiter,start);if(next<0)break;let part=raw.slice(start,next);if(part.slice(-2).toString()==='\r\n')part=part.slice(0,-2);const headerEnd=part.indexOf(separator);if(headerEnd<0)throw Object.assign(new Error('上传表单格式无效'),{statusCode:400,code:'LOCAL_IMPORT_MULTIPART_INVALID'});const headers=part.slice(0,headerEnd).toString('latin1'),content=part.slice(headerEnd+separator.length),disposition=headers.match(/content-disposition:\s*form-data;[^\r\n]*/i)?.[0]||'',name=disposition.match(/\bname="([^"]+)"/i)?.[1],filename=disposition.match(/\bfilename="([^"]*)"/i)?.[1],mimeType=headers.match(/content-type:\s*([^\r\n;]+)/i)?.[1]||'application/octet-stream';if(!name){cursor=next;continue}if(filename!==undefined){files.push({fieldName:name,filename,mimeType,bytes:content});if(files.length>maxFiles)throw Object.assign(new Error('单批最多上传 20 个文件'),{statusCode:413,code:'LOCAL_IMPORT_TOO_MANY_FILES'})}else{if(content.length>65536)throw Object.assign(new Error('上传元数据过大'),{statusCode:413,code:'LOCAL_IMPORT_METADATA_TOO_LARGE'});fields[name]=content.toString('utf8')}cursor=next}
      finished=true;resolve({fields,files});
    }catch(error){fail(error)}});
  });
}

module.exports={MAX_FILE_BYTES,MAX_TOTAL_BYTES,MAX_FILES,SECTIONS,SECTION_TYPES,ALLOWED,safeText,normalizeTags,isSensitiveTag,contentGenerationBoundary,generateTagSuggestions,sanitizeFilename,validateLocalFile,validateMetadata,safeLocalItem,readMultipart};
