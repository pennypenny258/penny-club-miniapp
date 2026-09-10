'use strict';
const {requirePermission}=require('./auth/admin-rbac');

function createProductionIntakeHttpHandler({config,sessionService,crmCoordinator,activityService,previewBuilder}){
  return async function productionIntakeHttp(req,res){
    const pathname=new URL(req.url,'http://localhost').pathname;if(!pathname.startsWith('/api/production-admin'))return false;
    if(!config?.enabled){respond(res,503,{error:'生产录入服务未启用',code:'PRODUCTION_INTAKE_DISABLED',persistent:false});return true}
    try{
      if(req.method==='GET'&&pathname==='/api/production-admin/readiness'){respond(res,200,{...config.safeSummary,ready:true});return true}
      if(req.method==='POST'&&pathname==='/api/production-admin/session'){const input=await body(req,8192),session=await sessionService.login({accessToken:input.accessToken,deviceId:input.deviceId});respond(res,201,session);return true}
      if(req.method==='GET'&&pathname==='/api/production-admin/session'){const admin=await sessionService.resolveRequest(req);respond(res,200,{verified:true,expiresAt:admin.expiresAt,permissions:admin.permissions.filter(code=>['activity.manage','member_import.stage','member_import.review'].includes(code)),rolesNotClientControlled:true});return true}
      if(req.method==='POST'&&pathname==='/api/production-admin/crm/preview'){const admin=await sessionService.resolveRequest(req);requirePermission(admin,'member_import.stage');respond(res,200,await previewBuilder(await body(req,15*1024*1024)));return true}
      if(req.method==='POST'&&pathname==='/api/production-admin/crm/confirm'){const input=await body(req,15*1024*1024),result=await crmCoordinator.confirm({adminSession:req,payload:input.upload,previewDigest:input.previewDigest,explicitConfirmation:input.explicitConfirmation,idempotencyKey:String(req.headers['idempotency-key']||'')});respond(res,201,result);return true}
      if(req.method==='GET'&&pathname==='/api/production-admin/activities'){respond(res,200,await activityService.list(req));return true}
      if(req.method==='POST'&&pathname==='/api/production-admin/activities'){respond(res,201,await activityService.upsert(req,await body(req,262144)));return true}
      respond(res,404,{error:'Not found'});return true;
    }catch(error){const status=Number(error?.statusCode)||500,known=status>=400&&status<500||status===503;respond(res,status,known?{error:error.message,code:error.code||'REQUEST_REJECTED'}:{error:'生产录入服务暂时不可用',code:'PRODUCTION_INTAKE_UNAVAILABLE'});return true}
  }
}
function body(req,maxBytes){return new Promise((resolve,reject)=>{let raw='',large=false;req.on('data',chunk=>{if(large)return;raw+=chunk;if(Buffer.byteLength(raw,'utf8')>maxBytes){large=true;raw=''}});req.on('end',()=>{if(large)return reject(Object.assign(new Error('请求体过大'),{statusCode:413,code:'REQUEST_TOO_LARGE'}));try{resolve(raw?JSON.parse(raw):{})}catch{reject(Object.assign(new Error('JSON 格式无效'),{statusCode:400,code:'INVALID_JSON'}))}});req.on('error',()=>reject(Object.assign(new Error('请求读取失败'),{statusCode:400,code:'REQUEST_READ_FAILED'})))})}
function respond(res,status,value){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','permissions-policy':'camera=(), microphone=(), geolocation=()','cross-origin-resource-policy':'same-origin','strict-transport-security':'max-age=31536000; includeSubDomains'});res.end(JSON.stringify(value))}
module.exports={createProductionIntakeHttpHandler};
