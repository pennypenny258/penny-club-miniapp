'use strict';

const crypto=require('node:crypto');
const {requireActiveMember}=require('../domain');
const {hashWechatSubject}=require('./wechat-config');

class AuthBoundaryError extends Error{constructor(message,{code,statusCode}={}){super(message);this.name='AuthBoundaryError';this.code=code;this.statusCode=statusCode}}
const unavailable=()=>new AuthBoundaryError('会员身份服务暂时不可用',{code:'MEMBER_IDENTITY_UNAVAILABLE',statusCode:503});
const unauthorized=()=>new AuthBoundaryError('需要有效的会员会话',{code:'VERIFIED_SESSION_REQUIRED',statusCode:401});
const notBound=()=>new AuthBoundaryError('微信身份尚未绑定会员账号',{code:'IDENTITY_NOT_BOUND',statusCode:403});

class WechatCodeExchangeClient{
  constructor({config,fetchImpl=globalThis.fetch,timeoutMs=5000,maxResponseBytes=16384}){if(!config?.enabled||config.mode!=='server_code_exchange')throw new Error('微信 code 交换需要已通过预检的服务端配置');if(typeof fetchImpl!=='function')throw new Error('微信 code 交换需要服务端 fetch');this.config=config;this.fetchImpl=fetchImpl;this.timeoutMs=timeoutMs;this.maxResponseBytes=maxResponseBytes}
  async exchange(code){
    const value=String(code||'');if(!/^[A-Za-z0-9_-]{6,256}$/.test(value))throw new AuthBoundaryError('微信登录凭证无效',{code:'WECHAT_CODE_INVALID',statusCode:400});
    const url=new URL('https://api.weixin.qq.com/sns/jscode2session');url.searchParams.set('appid',this.config.appId);url.searchParams.set('secret',this.config.appSecret);url.searchParams.set('js_code',value);url.searchParams.set('grant_type','authorization_code');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);let response,text;
    try{response=await this.fetchImpl(url,{method:'GET',redirect:'error',signal:controller.signal,headers:{accept:'application/json'}});if(!response?.ok)throw unavailable();const declared=Number(response.headers?.get?.('content-length'));if(Number.isFinite(declared)&&declared>this.maxResponseBytes)throw unavailable();text=await response.text();if(Buffer.byteLength(text,'utf8')>this.maxResponseBytes)throw unavailable()}catch(error){if(error instanceof AuthBoundaryError)throw error;throw unavailable()}finally{clearTimeout(timer)}
    let body;try{body=JSON.parse(text)}catch{throw unavailable()}
    if(body?.errcode||!body?.openid||typeof body.openid!=='string')throw new AuthBoundaryError('微信登录凭证已失效或被拒绝',{code:'WECHAT_CODE_REJECTED',statusCode:401});
    // Use the app-scoped openid consistently. A conditionally returned unionid would make bindings unstable.
    return {subjectType:'openid',subject:body.openid};
  }
}

class OpaqueMemberSessionManager{
  constructor({config,revocationStore,clock=()=>Date.now(),randomBytes=crypto.randomBytes}){if(!config?.enabled||!Buffer.isBuffer(config.sessionEncryptionKey)||config.sessionEncryptionKey.length!==32)throw new Error('会员会话需要 32 字节服务端加密密钥');if(!revocationStore||typeof revocationStore.isRevoked!=='function')throw new Error('会员会话需要可持久化撤销存储适配器');this.config=config;this.revocationStore=revocationStore;this.clock=clock;this.randomBytes=randomBytes}
  issue({memberId,subjectHash,entitlementVersion}){if(!memberId||!/^[0-9a-f]{64}$/.test(subjectHash))throw new Error('会话 subject/member 无效');const issuedAt=Math.floor(this.clock()/1000),payload={v:1,sid:crypto.randomUUID(),sub:String(memberId),sh:subjectHash,ev:String(entitlementVersion||''),iss:this.config.issuer,aud:this.config.audience,iat:issuedAt,exp:issuedAt+this.config.ttlSeconds};const iv=this.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.config.sessionEncryptionKey,iv);cipher.setAAD(Buffer.from('venture-member-session-v1'));const encrypted=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),encrypted.toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.')}
  async verify(token){try{const [version,ivText,cipherText,tagText,...rest]=String(token||'').split('.');if(version!=='v1'||rest.length||!ivText||!cipherText||!tagText)throw unauthorized();const decipher=crypto.createDecipheriv('aes-256-gcm',this.config.sessionEncryptionKey,Buffer.from(ivText,'base64url'));decipher.setAAD(Buffer.from('venture-member-session-v1'));decipher.setAuthTag(Buffer.from(tagText,'base64url'));const payload=JSON.parse(Buffer.concat([decipher.update(Buffer.from(cipherText,'base64url')),decipher.final()]).toString('utf8'));const now=Math.floor(this.clock()/1000);if(payload?.v!==1||payload.iss!==this.config.issuer||payload.aud!==this.config.audience||!payload.sid||!payload.sub||!/^[0-9a-f]{64}$/.test(String(payload.sh||''))||!Number.isInteger(payload.exp)||payload.exp<=now||payload.iat>now+30)throw unauthorized();if(await this.revocationStore.isRevoked(payload.sid))throw unauthorized();return payload}catch(error){if(error instanceof AuthBoundaryError)throw error;throw unauthorized()}}
}

function entitlementToMember(row){if(!row||!row.member_id)return null;return {id:String(row.member_id),userStatus:row.account_active===true?'active':'disabled',status:row.decision_active===true?'active':'inactive',startsAt:row.membership_start||null,endsAt:row.membership_end||null,crmVerificationStatus:row.crm_verified===true?'verified':'not_verified',latestPaymentEvidenceStatus:row.payment_verified===true?'verified':'not_verified',latestValidPaymentAt:row.payment_reviewed_at||null,groupStatus:row.group_active===true?'in_group':'not_in_group',entitlementVersion:String(row.entitlement_version||'')}}

class VerifiedMemberIdentityService{
  constructor({config,exchangeClient,repository,sessionManager}){if(!config?.enabled)throw new Error('真实会员身份服务需要已启用配置');if(!exchangeClient||typeof exchangeClient.exchange!=='function')throw new Error('真实会员身份服务需要微信 code 交换器');if(repository?.kind!=='cloudbase_gateway'||typeof repository.resolveMemberEntitlement!=='function')throw new Error('真实会员身份服务需要 CloudBase 会籍只读仓库');if(!sessionManager||typeof sessionManager.issue!=='function'||typeof sessionManager.verify!=='function')throw new Error('真实会员身份服务需要服务端会话管理器');this.config=config;this.exchangeClient=exchangeClient;this.repository=repository;this.sessionManager=sessionManager}
  async lookup(subjectHash){let row;try{row=await this.repository.resolveMemberEntitlement({subjectHash})}catch{throw unavailable()}if(!row)return null;if(row.subject_hash!==subjectHash)throw unavailable();return entitlementToMember(row)}
  async loginWithCode(code){const exchanged=await this.exchangeClient.exchange(code);const {subjectHash}=hashWechatSubject({config:this.config,...exchanged});const member=await this.lookup(subjectHash);if(!member)throw notBound();requireActiveMember(member);return {accessToken:this.sessionManager.issue({memberId:member.id,subjectHash,entitlementVersion:member.entitlementVersion}),tokenType:'Bearer',expiresIn:this.config.ttlSeconds}}
  async resolveAuthorizationRequest(request){const headers=request?.headers||{};if(header(headers,'x-demo-user')||header(headers,'cookie'))throw unauthorized();const authorization=String(header(headers,'authorization')||'');const match=/^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization);if(!match)throw unauthorized();const session=await this.sessionManager.verify(match[1]);const member=await this.lookup(session.sh);if(!member||member.id!==session.sub)throw unauthorized();requireActiveMember(member);return member}
}

function header(headers,name){if(typeof headers.get==='function')return headers.get(name);const key=Object.keys(headers).find(item=>item.toLowerCase()===name);return key?headers[key]:undefined}

module.exports={AuthBoundaryError,WechatCodeExchangeClient,OpaqueMemberSessionManager,VerifiedMemberIdentityService,entitlementToMember};
