'use strict';

const MAX_BODY_BYTES=16384;
function writeJson(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(payload))}
function readJson(req){return new Promise((resolve,reject)=>{let raw='',bytes=0,done=false;req.on('data',chunk=>{if(done)return;bytes+=Buffer.byteLength(chunk);if(bytes>MAX_BODY_BYTES){done=true;const error=new Error('绑定请求超过安全上限');error.code='MEMBER_BINDING_REQUEST_TOO_LARGE';error.statusCode=413;reject(error);return}raw+=chunk});req.on('end',()=>{if(done)return;try{resolve(raw?JSON.parse(raw):{})}catch{const error=new Error('绑定请求正文必须是 JSON');error.code='MEMBER_BINDING_JSON_INVALID';error.statusCode=400;reject(error)}});req.on('error',()=>{if(done)return;const error=new Error('绑定请求读取失败');error.code='MEMBER_BINDING_REQUEST_INVALID';error.statusCode=400;reject(error)})})}
function idempotencyKey(req){const value=String(req.headers?.['idempotency-key']||'');if(!/^[A-Za-z0-9._:-]{8,128}$/.test(value)){const error=new Error('人工绑定操作必须提供有效幂等键');error.code='ADMIN_IDEMPOTENCY_REQUIRED';error.statusCode=400;throw error}return value}
function safeFailure(error){const status=Number(error?.statusCode);if(!Number.isInteger(status)||status<400||status>499)return {status:503,body:{error:'正式会员绑定服务暂时不可用',code:'FORMAL_MEMBER_BINDING_UNAVAILABLE'}};return {status,body:{error:String(error.message||'请求未通过安全校验').slice(0,180),code:String(error.code||'MEMBER_BINDING_REQUEST_REJECTED').slice(0,80)}}}
function createFormalMemberBindingHttpHandler({config,service,identityLoginService}={}){
  if(!config||typeof config.enabled!=='boolean')throw new Error('正式会员绑定 HTTP 边界需要已验证配置');
  if(config.enabled&&(!service||typeof service.start!=='function'||typeof service.listPending!=='function'||typeof service.confirm!=='function'||typeof service.reject!=='function'||typeof identityLoginService?.loginWithCode!=='function'))throw new Error('正式会员绑定路由启用时必须完整注入微信、手机号、004/008、绑定与会话服务');
  const prefix=config.prefix||'/api/formal-member-binding';
  return async function handleFormalMemberBindingHttp(req,res){
    const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith(`${prefix}/`)&&url.pathname!==prefix)return false;
    if(!config.enabled){writeJson(res,503,{error:'正式会员绑定路由尚未启用',code:'FORMAL_MEMBER_BINDING_ROUTES_DISABLED',memoryFallback:false,crmWrites:false});return true}
    try{
      let match;
      if(req.method==='POST'&&url.pathname===`${prefix}/start`){const input=await readJson(req);if('memberId' in input)throw Object.assign(new Error('客户端不得提交内部会员 ID'),{code:'MEMBER_BINDING_CLIENT_MEMBER_ID_FORBIDDEN',statusCode:400});writeJson(res,202,await service.start(input));return true}
      if(req.method==='POST'&&url.pathname===`${prefix}/session`){const input=await readJson(req);writeJson(res,200,await identityLoginService.loginWithCode(input.code));return true}
      if(req.method==='GET'&&url.pathname===`${prefix}/admin/candidates`){writeJson(res,200,await service.listPending({request:req,limit:Number(url.searchParams.get('limit')||30),idempotencyKey:idempotencyKey(req)}));return true}
      match=url.pathname.match(new RegExp(`^${prefix}/admin/candidates/([A-Za-z0-9_-]{6,128})/confirm$`));
      if(req.method==='PATCH'&&match){const input=await readJson(req);if('memberId' in input)throw Object.assign(new Error('客户端不得提交内部会员 ID'),{code:'MEMBER_BINDING_CLIENT_MEMBER_ID_FORBIDDEN',statusCode:400});writeJson(res,200,await service.confirm({request:req,candidateId:match[1],selectedMatchId:input.selectedMatchId,reasonCode:input.reasonCode,idempotencyKey:idempotencyKey(req)}));return true}
      match=url.pathname.match(new RegExp(`^${prefix}/admin/candidates/([A-Za-z0-9_-]{6,128})/reject$`));
      if(req.method==='PATCH'&&match){const input=await readJson(req);writeJson(res,200,await service.reject({request:req,candidateId:match[1],reasonCode:input.reasonCode,idempotencyKey:idempotencyKey(req)}));return true}
      writeJson(res,404,{error:'正式会员绑定路由不存在',code:'FORMAL_MEMBER_BINDING_ROUTE_NOT_FOUND'});return true;
    }catch(error){const failure=safeFailure(error);writeJson(res,failure.status,failure.body);return true}
  };
}
module.exports={MAX_BODY_BYTES,createFormalMemberBindingHttpHandler};
