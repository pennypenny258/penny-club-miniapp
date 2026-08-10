'use strict';

const MAX_BODY_BYTES=65536;
function writeJson(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(payload))}
function readJson(req){return new Promise((resolve,reject)=>{let raw='',bytes=0,finished=false;req.on('data',chunk=>{if(finished)return;bytes+=Buffer.byteLength(chunk);if(bytes>MAX_BODY_BYTES){finished=true;const error=new Error('请求体超过安全上限');error.code='AGENT_REQUEST_TOO_LARGE';error.statusCode=413;reject(error);return}raw+=chunk});req.on('end',()=>{if(finished)return;try{resolve(raw?JSON.parse(raw):{})}catch{const error=new Error('请求正文必须是 JSON');error.code='AGENT_JSON_INVALID';error.statusCode=400;reject(error)}});req.on('error',()=>{if(finished)return;const error=new Error('请求读取失败');error.code='AGENT_REQUEST_INVALID';error.statusCode=400;reject(error)})})}
function idempotencyKey(req){const value=String(req.headers?.['idempotency-key']||'');if(!/^[A-Za-z0-9._:-]{8,128}$/.test(value)){const error=new Error('后台审核与分发必须提供有效幂等键');error.code='ADMIN_IDEMPOTENCY_REQUIRED';error.statusCode=400;throw error}return value}
function safeFailure(error){const status=Number(error?.statusCode);if(!Number.isInteger(status)||status<400||status>499)return {status:503,body:{error:'正式需求撮合服务暂时不可用',code:'FORMAL_AGENT_UNAVAILABLE'}};return {status,body:{error:String(error.message||'请求未通过安全校验').slice(0,180),code:String(error.code||'FORMAL_AGENT_REQUEST_REJECTED').slice(0,80)}}}

function createFormalAgentHttpHandler({config,service}={}){
  if(!config||typeof config.enabled!=='boolean')throw new Error('正式 Agent HTTP 边界需要已验证配置');
  if(config.enabled&&(!service||typeof service.listOpportunities!=='function'||typeof service.submitDemand!=='function'||typeof service.applyToDemand!=='function'||typeof service.reviewDemand!=='function'||typeof service.dispatchApplication!=='function'))throw new Error('正式 Agent HTTP 路由启用时必须完整注入 004/008 Agent 服务');
  const prefix=config.prefix||'/api/formal-agent';
  return async function handleFormalAgentHttp(req,res){
    const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith(`${prefix}/`)&&url.pathname!==prefix)return false;
    if(!config.enabled){writeJson(res,503,{error:'正式需求撮合路由尚未启用',code:'FORMAL_AGENT_ROUTES_DISABLED',memoryFallback:false,crmWrites:false});return true}
    try{
      let match;
      if(req.method==='GET'&&url.pathname===`${prefix}/opportunities`){const limit=url.searchParams.get('limit')||30;writeJson(res,200,await service.listOpportunities({request:req,limit:Number(limit)}));return true}
      if(req.method==='POST'&&url.pathname===`${prefix}/demands`){writeJson(res,201,await service.submitDemand({request:req,input:await readJson(req)}));return true}
      match=url.pathname.match(new RegExp(`^${prefix}/demands/([A-Za-z0-9_-]{6,128})/applications$`));
      if(req.method==='POST'&&match){writeJson(res,201,await service.applyToDemand({request:req,demandId:match[1],input:await readJson(req)}));return true}
      match=url.pathname.match(new RegExp(`^${prefix}/admin/demands/([A-Za-z0-9_-]{6,128})/review$`));
      if(req.method==='PATCH'&&match){writeJson(res,200,await service.reviewDemand({request:req,demandId:match[1],input:await readJson(req),idempotencyKey:idempotencyKey(req)}));return true}
      match=url.pathname.match(new RegExp(`^${prefix}/admin/applications/([A-Za-z0-9_-]{6,128})/dispatch$`));
      if(req.method==='PATCH'&&match){writeJson(res,200,await service.dispatchApplication({request:req,applicationId:match[1],input:await readJson(req),idempotencyKey:idempotencyKey(req)}));return true}
      writeJson(res,404,{error:'正式需求撮合路由不存在',code:'FORMAL_AGENT_ROUTE_NOT_FOUND'});return true;
    }catch(error){const failure=safeFailure(error);writeJson(res,failure.status,failure.body);return true}
  };
}

module.exports={MAX_BODY_BYTES,createFormalAgentHttpHandler};
