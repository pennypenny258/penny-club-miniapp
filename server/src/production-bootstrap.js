'use strict';

const BOOTSTRAP_CODE='PRODUCTION_BOOTSTRAP_NOT_CONFIGURED';

function writeJson(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body))}

function handleProductionBootstrap(req,res,{deployment,repository}){
  if(!deployment?.bootstrapOnly)return false;
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&(pathname==='/healthz'||pathname==='/api/health')){
    writeJson(res,200,{ok:true,version:'0.1.0',deploymentProfile:deployment.profile,anonymousDemoOnly:false,businessApisEnabled:false,serviceState:'production_bootstrap_not_configured',persistence:repository.safeReadiness()});
    return true;
  }
  if(req.method==='GET'&&(pathname==='/'||pathname==='/bootstrap')){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
    res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>生产初始化</title><body style="font:16px/1.7 system-ui;max-width:680px;margin:12vh auto;padding:24px"><h1>生产初始化服务已启动</h1><p>当前业务尚未完成安全配置，会员端、运营后台、CRM 和匿名演示数据均未开放。</p><p>健康检查正常。请按上线清单完成数据库、正式身份与私有存储后，再由开发方逐项启用。</p></body></html>');
    return true;
  }
  writeJson(res,503,{error:'生产服务尚未完成安全配置',code:BOOTSTRAP_CODE,businessApisEnabled:false,anonymousDemoOnly:false});
  return true;
}

module.exports={BOOTSTRAP_CODE,handleProductionBootstrap};
