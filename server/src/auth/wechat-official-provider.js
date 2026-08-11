'use strict';

const OFFICIAL_ORIGIN='https://api.weixin.qq.com';
const ENDPOINTS=Object.freeze({code2Session:'/sns/jscode2session',accessToken:'/cgi-bin/token',phoneNumber:'/wxa/business/getuserphonenumber'});

class WechatOfficialProviderError extends Error{
  constructor(message,{code='WECHAT_PROVIDER_UNAVAILABLE',statusCode=503}={}){super(message);this.name='WechatOfficialProviderError';this.code=code;this.statusCode=statusCode}
}
const unavailable=(code='WECHAT_PROVIDER_UNAVAILABLE')=>new WechatOfficialProviderError(code==='WECHAT_PROVIDER_TIMEOUT'?'微信身份服务请求超时':'微信身份服务暂时不可用',{code,statusCode:503});
const rejected=(message,code,statusCode=401)=>new WechatOfficialProviderError(message,{code,statusCode});
function oneTimeCode(value,label){const text=String(value||'');if(!/^[A-Za-z0-9_-]{6,256}$/.test(text))throw rejected(`${label}无效`,'WECHAT_GRANT_CODE_INVALID',400);return text}

class WechatOfficialJsonTransport{
  constructor({fetchImpl=globalThis.fetch,timeoutMs=5000,maxResponseBytes=16384}={}){if(typeof fetchImpl!=='function')throw new Error('微信官方接口需要服务端 fetch');if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>15000)throw new Error('微信接口超时必须为 1000–15000 毫秒');if(!Number.isInteger(maxResponseBytes)||maxResponseBytes<1024||maxResponseBytes>65536)throw new Error('微信接口响应上限必须为 1024–65536 字节');this.fetchImpl=fetchImpl;this.timeoutMs=timeoutMs;this.maxResponseBytes=maxResponseBytes}
  async request({url,method='GET',body}){
    if(!(url instanceof URL)||url.origin!==OFFICIAL_ORIGIN||!Object.values(ENDPOINTS).includes(url.pathname))throw new Error('微信官方接口不在固定白名单');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);let response,text;
    try{
      response=await this.fetchImpl(url,{method,redirect:'error',signal:controller.signal,headers:{accept:'application/json',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      if(!response?.ok)throw unavailable();
      const declared=Number(response.headers?.get?.('content-length'));if(Number.isFinite(declared)&&declared>this.maxResponseBytes)throw unavailable('WECHAT_PROVIDER_RESPONSE_TOO_LARGE');
      text=await response.text();if(Buffer.byteLength(text,'utf8')>this.maxResponseBytes)throw unavailable('WECHAT_PROVIDER_RESPONSE_TOO_LARGE');
    }catch(error){if(error instanceof WechatOfficialProviderError)throw error;throw unavailable(error?.name==='AbortError'?'WECHAT_PROVIDER_TIMEOUT':'WECHAT_PROVIDER_UNAVAILABLE')}finally{clearTimeout(timer)}
    try{return JSON.parse(text)}catch{throw unavailable('WECHAT_PROVIDER_INVALID_RESPONSE')}
  }
}

class WechatAccessTokenProvider{
  constructor({config,transport,clock=()=>Date.now()}){if(!config?.enabled||!config.appId||!config.appSecret)throw new Error('微信 access token 需要已通过预检的服务端配置');if(!(transport instanceof WechatOfficialJsonTransport))throw new Error('微信 access token 需要受控官方接口 transport');this.config=config;this.transport=transport;this.clock=clock;this.cached=null}
  async getAccessToken(){
    const now=this.clock();if(this.cached&&this.cached.expiresAt>now+this.config.accessTokenRefreshSkewSeconds*1000)return this.cached.value;
    const url=new URL(ENDPOINTS.accessToken,OFFICIAL_ORIGIN);url.searchParams.set('grant_type','client_credential');url.searchParams.set('appid',this.config.appId);url.searchParams.set('secret',this.config.appSecret);
    const body=await this.transport.request({url});
    if(body?.errcode||typeof body?.access_token!=='string'||body.access_token.length<16)throw unavailable('WECHAT_PROVIDER_AUTH_REJECTED');
    const expiresIn=Number(body.expires_in);if(!Number.isFinite(expiresIn)||expiresIn<300||expiresIn>7200)throw unavailable('WECHAT_PROVIDER_INVALID_RESPONSE');
    this.cached={value:body.access_token,expiresAt:now+expiresIn*1000};return this.cached.value;
  }
  clear(){this.cached=null}
  safeReadiness(){return {provider:'wechat_official_access_token',serverOnly:true,cachedInProcess:true,credentialsExposed:false}}
}

class WechatPhoneNumberExchangeClient{
  constructor({config,transport,accessTokenProvider}){if(!config?.enabled)throw new Error('微信手机号交换需要已通过预检的服务端配置');if(!(transport instanceof WechatOfficialJsonTransport)||typeof accessTokenProvider?.getAccessToken!=='function')throw new Error('微信手机号交换需要受控 transport 与 access token provider');this.transport=transport;this.accessTokenProvider=accessTokenProvider}
  async verify(code){
    const grantCode=oneTimeCode(code,'手机号授权凭证'),accessToken=await this.accessTokenProvider.getAccessToken();
    const url=new URL(ENDPOINTS.phoneNumber,OFFICIAL_ORIGIN);url.searchParams.set('access_token',accessToken);
    const body=await this.transport.request({url,method:'POST',body:{code:grantCode}});
    if(body?.errcode||typeof body?.phone_info?.phoneNumber!=='string')throw rejected('手机号授权已失效或被拒绝','WECHAT_PHONE_CODE_REJECTED');
    const phoneNumber=body.phone_info.phoneNumber.trim();if(!/^\+?[0-9]{6,20}$/.test(phoneNumber))throw unavailable('WECHAT_PROVIDER_INVALID_RESPONSE');
    return {verified:true,phoneNumber};
  }
  safeReadiness(){return {provider:'wechat_official_phone_code_exchange',serverOnly:true,userConsentRequired:true,rawPhoneReturnedToClient:false,credentialsExposed:false}}
}

function createWechatOfficialProviders({config,fetchImpl=globalThis.fetch,clock}={}){
  if(!config?.enabled)throw new Error('微信官方供应器只能在真实身份配置通过后构造');
  const transport=new WechatOfficialJsonTransport({fetchImpl,timeoutMs:config.apiTimeoutMs,maxResponseBytes:config.apiMaxResponseBytes});
  const accessTokenProvider=new WechatAccessTokenProvider({config,transport,clock});
  const phoneGrantVerifier=new WechatPhoneNumberExchangeClient({config,transport,accessTokenProvider});
  return {transport,accessTokenProvider,phoneGrantVerifier};
}

module.exports={OFFICIAL_ORIGIN,ENDPOINTS,WechatOfficialProviderError,WechatOfficialJsonTransport,WechatAccessTokenProvider,WechatPhoneNumberExchangeClient,createWechatOfficialProviders};
