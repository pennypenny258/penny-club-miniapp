'use strict';

class CloudBaseIdentityUnavailableError extends Error{constructor(){super('CloudBase 身份验证暂时不可用');this.code='CLOUDBASE_IDENTITY_UNAVAILABLE';this.statusCode=503}}

class CloudBaseAdminIdentityVerifier{
  constructor({config,fetchImpl=globalThis.fetch,clock=()=>new Date()}){if(!config?.enabled||config.mode!=='cloudbase_gateway'||config.runtimeEnvironment!=='production')throw new Error('CloudBase 后台身份验证器需要生产网关配置');this.config=config;this.fetchImpl=fetchImpl;this.clock=clock}
  async verify(assertion={}){
    const accessToken=String(assertion.accessToken||''),deviceId=String(assertion.deviceId||'');
    if(accessToken.length<32||accessToken.length>4096||/[\s\x00-\x1f]/.test(accessToken))return null;
    if(!/^[A-Za-z0-9._:-]{8,128}$/.test(deviceId))return null;
    const url=new URL('/auth/v1/token/introspect',this.config.origin),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);
    try{
      const response=await this.fetchImpl(url,{method:'GET',redirect:'error',signal:controller.signal,headers:{accept:'application/json',authorization:`Bearer ${accessToken}`,'x-device-id':deviceId}});
      if(!response?.ok)return null;
      const declared=Number(response.headers?.get?.('content-length')||0);if(declared>32768)throw new CloudBaseIdentityUnavailableError();
      const text=await response.text();if(Buffer.byteLength(text,'utf8')>32768)throw new CloudBaseIdentityUnavailableError();
      const value=JSON.parse(text||'{}'),subject=String(value?.sub||'');
      if(!/^[A-Za-z0-9._:-]{3,160}$/.test(subject)||String(value.token_type||'').toLowerCase()!=='bearer')return null;
      return {verified:true,provider:'cloudbase_user',subject,authenticatedAt:this.clock().toISOString(),stepUpVerified:false};
    }catch(error){if(error instanceof CloudBaseIdentityUnavailableError)throw error;throw new CloudBaseIdentityUnavailableError()}finally{clearTimeout(timer)}
  }
}

module.exports={CloudBaseAdminIdentityVerifier,CloudBaseIdentityUnavailableError};
