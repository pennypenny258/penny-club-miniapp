'use strict';

const ALLOWED_SOURCE_MODES = ['official_readonly','export_package'];
const ALLOWED_SCOPES = ['all_descendants','selected_directories'];
const ALLOWED_STRATEGIES = ['directory_first','content_inference','manual_first'];
const SENSITIVE_INPUT = /(app_?id|app_?secret|token|authorization|cookie|password|private_?key)/i;
const ROUTES = {
  usage_guide:'knowledge_review', member_directory:'directory_review', fundraising_connections:'fundraising_review',
  recruitment:'recruitment_review', activity_notices:'activity_review', meeting_replays:'replay_review',
  group_digests:'knowledge_review', industry_reports:'knowledge_review', books:'knowledge_review', data_files_tools:'knowledge_review'
};

function normalizeFeishuWikiLink(value) {
  let url;
  try { url=new URL(String(value||'').trim()); }
  catch { return {ok:false,code:'INVALID_URL',message:'链接格式无效，请粘贴完整的飞书 Wiki 链接'}; }
  if(url.protocol!=='https:')return {ok:false,code:'HTTPS_REQUIRED',message:'链接必须使用 HTTPS 协议'};
  const hostname=url.hostname.toLowerCase().replace(/\.$/,'');
  if(hostname!=='feishu.cn'&&!hostname.endsWith('.feishu.cn'))return {ok:false,code:'UNTRUSTED_DOMAIN',message:'链接不是可信的飞书域名，仅允许 feishu.cn 及其子域名'};
  if(url.username||url.password)return {ok:false,code:'URL_CREDENTIALS_FORBIDDEN',message:'链接中不能包含用户名或密码'};
  if(!url.pathname.startsWith('/wiki'))return {ok:false,code:'NOT_WIKI_LINK',message:'链接不是飞书 Wiki 链接，路径应为 /wiki/{节点标识}'};
  if(url.pathname==='/wiki'||url.pathname==='/wiki/')return {ok:false,code:'NODE_TOKEN_MISSING',message:'飞书 Wiki 链接缺少节点标识'};
  const match=url.pathname.match(/^\/wiki\/([^/]+)\/?$/);
  if(!match)return {ok:false,code:'INVALID_WIKI_PATH',message:'飞书 Wiki 路径无效，应只包含 /wiki/{节点标识}'};
  let nodeToken;
  try { nodeToken=decodeURIComponent(match[1]); }
  catch { return {ok:false,code:'INVALID_NODE_TOKEN',message:'飞书 Wiki 节点标识编码无效'}; }
  if(!nodeToken||/[\/\\\u0000-\u001f\u007f]/.test(nodeToken))return {ok:false,code:'INVALID_NODE_TOKEN',message:'飞书 Wiki 节点标识无效'};
  return {ok:true,code:'VALID',normalizedUrl:`${url.origin}/wiki/${encodeURIComponent(nodeToken)}`,nodeToken};
}
function validateRootLink(value) { return normalizeFeishuWikiLink(value).ok; }
function assertNoCredentials(input) {
  const unsafe=Object.keys(input||{}).filter(key=>SENSITIVE_INPUT.test(key));
  if(unsafe.length){const error=new Error('请求不得携带 App Secret、token、Cookie 或其他凭据；授权引用必须由生产密钥管理服务注入');error.statusCode=400;throw error}
}
function routeSource(directoryCode, detectedType) {
  if (ROUTES[directoryCode]) return {destination:ROUTES[directoryCode],confidence:'directory_rule'};
  const byType={member_directory:'directory_review',recruitment:'recruitment_review',fundraising:'fundraising_review',activity:'activity_review',meeting_replay:'replay_review',knowledge:'knowledge_review'};
  return byType[detectedType]?{destination:byType[detectedType],confidence:'content_type'}:{destination:'quarantine',confidence:'unknown'};
}
function summarize(items) {
  const count=status=>items.filter(x=>x.status===status).length;
  return {total:items.length,pendingReview:count('pending_review'),migrated:count('migrated'),skipped:count('skipped'),failed:count('failed')+count('queued_for_retry'),needsClassification:count('needs_classification'),attachmentPending:count('attachment_pending')};
}
function safeTask(task, items=[]) {
  const {sourceConnection,rootLinkDigest,...safe}=task;
  return {...safe,rootLinkStored:false,credentialStored:false,report:summarize(items)};
}
function createPreflight(input, id, createdAt) {
  assertNoCredentials(input);
  if(!ALLOWED_SOURCE_MODES.includes(input.sourceMode)){const error=new Error('迁入来源方式无效');error.statusCode=400;throw error}
  if(!ALLOWED_SCOPES.includes(input.scope)){const error=new Error('抓取范围无效');error.statusCode=400;throw error}
  if(!ALLOWED_STRATEGIES.includes(input.classificationStrategy)){const error=new Error('分类策略无效');error.statusCode=400;throw error}
  if(input.sourceMode==='official_readonly'){const validation=normalizeFeishuWikiLink(input.rootUrl);if(!validation.ok){const error=new Error(validation.message);error.statusCode=400;error.code=validation.code;throw error}void validation.normalizedUrl}
  return {id,sourceMode:input.sourceMode,scope:input.scope,classificationStrategy:input.classificationStrategy,status:input.sourceMode==='official_readonly'?'awaiting_readonly_authorization':'awaiting_export_package',sourceReady:false,continuousSync:false,defaultPublishPolicy:'pending_review',rootLinkValidated:input.sourceMode==='official_readonly',rootLinkStored:false,credentialStored:false,sourceDisconnected:false,directoryTree:[],createdAt,updatedAt:createdAt};
}
function retryFailedItems(task, items, updatedAt=new Date().toISOString()) {
  if(task.sourceDisconnected){const error=new Error('来源已断开；如需重试必须新建任务并重新授权或上传导出包');error.statusCode=409;throw error}
  const failed=items.filter(x=>x.status==='failed');
  for(const item of failed){item.status='queued_for_retry';item.retryCount=(item.retryCount||0)+1;delete item.failureCode}
  task.status=task.sourceReady?'retry_queued':(task.sourceMode==='official_readonly'?'awaiting_readonly_authorization':'awaiting_export_package');task.updatedAt=updatedAt;
  return failed.length;
}
function disconnectSource(task,items,updatedAt=new Date().toISOString()) {
  task.sourceReady=false;task.sourceDisconnected=true;task.status='source_disconnected';task.rootLinkValidated=false;delete task.sourceConnection;delete task.rootLinkDigest;task.updatedAt=updatedAt;
  for(const item of items){item.sourceHandlePresent=false;delete item.sourceUrl;delete item.sourceExternalId}
  return task;
}

class FeishuSourceAdapter {
  constructor(kind){this.kind=kind}
  async preflight(){throw new Error('SOURCE_ADAPTER_NOT_CONFIGURED')}
  async listTree(){throw new Error('SOURCE_ADAPTER_NOT_CONFIGURED')}
  async copyItem(){throw new Error('SOURCE_ADAPTER_NOT_CONFIGURED')}
  async disconnect(){return {disconnected:true}}
}
class OfficialReadonlyAdapter extends FeishuSourceAdapter {
  constructor(){super('official_readonly')}
  async preflight(context={}){return {ready:Boolean(context.serverManagedAuthorizationRef),status:context.serverManagedAuthorizationRef?'ready':'awaiting_readonly_authorization',credentialEchoed:false}}
}
class ExportPackageAdapter extends FeishuSourceAdapter {
  constructor(){super('export_package');this.supportedFormats=['text/html','text/markdown','application/pdf','application/octet-stream']}
  async preflight(context={}){return {ready:Boolean(context.privateUploadRef),status:context.privateUploadRef?'ready':'awaiting_export_package',privateUploadRequired:true}}
}

module.exports={ROUTES,normalizeFeishuWikiLink,validateRootLink,assertNoCredentials,routeSource,summarize,safeTask,createPreflight,retryFailedItems,disconnectSource,FeishuSourceAdapter,OfficialReadonlyAdapter,ExportPackageAdapter};
