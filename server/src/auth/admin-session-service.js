'use strict';

const crypto=require('node:crypto');
const {keyedHash}=require('./admin-auth-config');
const {requirePermission,requiresStepUp}=require('./admin-rbac');

class AdminAuthUnavailableError extends Error{constructor(){super('正式后台认证服务暂时不可用');this.code='ADMIN_AUTH_UNAVAILABLE';this.statusCode=503}}
class AdminAuthenticationError extends Error{constructor(message='后台身份验证失败'){super(message);this.code='ADMIN_AUTHENTICATION_REQUIRED';this.statusCode=401}}

class FormalAdminSessionService{
  constructor({config,identityVerifier,repository,clock=()=>new Date(),randomBytes=crypto.randomBytes}){if(!config?.enabled||typeof identityVerifier?.verify!=='function'||!repository)throw new Error('正式后台会话服务依赖未完整注入');this.config=config;this.identityVerifier=identityVerifier;this.repository=repository;this.clock=clock;this.randomBytes=randomBytes}
  async login(assertion){
    let identity;try{identity=await this.identityVerifier.verify(assertion)}catch{throw new AdminAuthenticationError()}
    if(!identity?.verified||!identity.provider||!identity.subject||!identity.authenticatedAt)throw new AdminAuthenticationError();
    const now=this.clock(),authenticatedAt=new Date(identity.authenticatedAt);if(!Number.isFinite(authenticatedAt.getTime())||authenticatedAt>now)throw new AdminAuthenticationError();
    const subjectHash=keyedHash(this.config.subjectHmacKey,`admin:${identity.provider}`,identity.subject);
    const token=this.randomBytes(32).toString('base64url'),sessionHash=keyedHash(this.config.sessionHashKey,'admin-session',token),expiresAt=new Date(now.getTime()+this.config.ttlSeconds*1000);
    let created;try{created=await this.repository.beginSession({subjectHash,sessionHash,issuedAt:now.toISOString(),expiresAt:expiresAt.toISOString(),authenticatedAt:authenticatedAt.toISOString(),stepUpVerifiedAt:identity.stepUpVerified===true?authenticatedAt.toISOString():null})}catch{throw new AdminAuthUnavailableError()}
    if(!created?.session_id||created.status!=='active')throw new AdminAuthenticationError('后台账号未绑定或未获授权');
    return {accessToken:token,tokenType:'Bearer',expiresAt:expiresAt.toISOString(),rolesNotEmbedded:true};
  }
  async resolveRequest(request={}){
    const headers=lowerHeaders(request.headers||{});
    if(headers['x-demo-user']||headers['x-admin-role']||headers['x-demo-role']||headers.cookie)throw new AdminAuthenticationError('正式后台禁止演示身份、角色声明或 Cookie 会话');
    const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(String(headers.authorization||''));if(!match)throw new AdminAuthenticationError();
    const sessionHash=keyedHash(this.config.sessionHashKey,'admin-session',match[1]);let session;try{session=await this.repository.resolveSession({sessionHash})}catch{throw new AdminAuthUnavailableError()}
    const now=this.clock();if(!session||session.status!=='active'||new Date(session.expires_at)<=now||!session.user_id)throw new AdminAuthenticationError();
    return {verified:true,userId:session.user_id,roles:Array.isArray(session.roles)?session.roles:[],permissions:Array.isArray(session.permissions)?session.permissions:[],sessionId:session.session_id,authenticatedAt:session.authenticated_at,stepUpVerifiedAt:session.step_up_verified_at,expiresAt:session.expires_at};
  }
  async authorizeAction({request,permission,idempotencyKey,excludedActorIds=[]}){
    const admin=await this.resolveRequest(request);requirePermission(admin,permission);
    if(!/^[A-Za-z0-9._:-]{8,128}$/.test(String(idempotencyKey||''))){const error=new Error('后台操作幂等键格式无效');error.code='ADMIN_IDEMPOTENCY_REQUIRED';error.statusCode=400;throw error}
    const stepUpRequired=requiresStepUp(permission),stepUpAt=new Date(admin.stepUpVerifiedAt||0),now=this.clock();if(stepUpRequired&&(now-stepUpAt)>this.config.stepUpMaxAgeSeconds*1000){const error=new Error('该操作需要近期重新验证身份');error.code='ADMIN_STEP_UP_REQUIRED';error.statusCode=403;throw error}
    if(excludedActorIds.map(String).includes(String(admin.userId))){const error=new Error('该操作要求职责分离');error.code='SEPARATION_OF_DUTIES_REQUIRED';error.statusCode=409;throw error}
    const keyHash=keyedHash(this.config.sessionHashKey,`admin-action:${permission}:${admin.userId}`,idempotencyKey);
    try{const reservation=await this.repository.reserveAction({sessionId:admin.sessionId,actorId:admin.userId,permission,actionKeyHash:keyHash,stepUpRequired,excludedActorIds});if(!reservation?.authorized)throw new AdminAuthenticationError('后台操作授权已失效');return {...admin,authorizationId:reservation.authorization_id}}
    catch(error){if(error?.code==='ADMIN_AUTHENTICATION_REQUIRED')throw error;throw new AdminAuthUnavailableError()}
  }
}
function lowerHeaders(headers){const result={};for(const [key,value] of Object.entries(headers))result[String(key).toLowerCase()]=value;return result}
module.exports={FormalAdminSessionService,AdminAuthUnavailableError,AdminAuthenticationError};
