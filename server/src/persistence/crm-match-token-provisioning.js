'use strict';

const crypto=require('node:crypto');

const REQUIRED_FUTURE_MIGRATION='012_member_binding_rpc_008_baseline';
const PREPARATION_MODE='offline_contract_only';
const TOKEN_KIND='phone';
const KEY_VERSION=/^[a-z0-9][a-z0-9._-]{1,31}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/;
const HEX64=/^[0-9a-f]{64}$/;
const CONFIG_KEYS=Object.freeze(['CRM_MATCH_TOKEN_PROVISIONING_PREPARED','CRM_MATCH_TOKEN_ACTIVE_KEY_VERSION','CRM_MATCH_TOKEN_ACTIVE_HMAC_KEY','CRM_MATCH_TOKEN_PREVIOUS_KEY_VERSION','CRM_MATCH_TOKEN_PREVIOUS_HMAC_KEY','CRM_MATCH_TOKEN_MIGRATION_APPLIED']);

class CrmMatchTokenProvisioningError extends Error{constructor(code='CRM_MATCH_TOKEN_PROVISIONING_UNAVAILABLE'){super('会员匹配令牌服务暂时不可用');this.code=code;this.statusCode=503}}
function present(value){return Boolean(String(value||'').trim())}
function key(value,name){const text=String(value||''),buffer=Buffer.from(text,'base64');if(buffer.length!==32||buffer.toString('base64').replace(/=+$/,'')!==text.replace(/=+$/,''))throw new Error(`${name} 必须是 32 字节服务端密钥`);return buffer}
function version(value,name){const text=String(value||'');if(!KEY_VERSION.test(text))throw new Error(`${name} 格式无效`);return text}
function safeId(value){const text=String(value||'');if(!ID.test(text))throw new CrmMatchTokenProvisioningError('CRM_MATCH_TOKEN_REQUEST_INVALID');return text}
function safeHash(value){const text=String(value||'');if(!HEX64.test(text))throw new CrmMatchTokenProvisioningError('CRM_MATCH_TOKEN_REQUEST_INVALID');return text}

function resolveCrmMatchTokenPreparationConfig(environment=process.env){
  const prepared=environment.CRM_MATCH_TOKEN_PROVISIONING_PREPARED==='true',partial=CONFIG_KEYS.some(name=>name!=='CRM_MATCH_TOKEN_PROVISIONING_PREPARED'&&present(environment[name]));
  if(!prepared){if(partial||(present(environment.CRM_MATCH_TOKEN_PROVISIONING_PREPARED)&&environment.CRM_MATCH_TOKEN_PROVISIONING_PREPARED!=='false'))throw new Error('匹配令牌生成未准备，拒绝保留部分密钥或迁移配置');return {prepared:false,runtimeEnabled:false,safeSummary:{prepared:false,serverOnly:true,routesEnabled:false,cloudWritesEnabled:false,ordinaryLogsContainValues:false,credentialsExposed:false}}}
  if(environment.NODE_ENV!=='production'||environment.DATA_REPOSITORY!=='cloudbase_gateway')throw new Error('匹配令牌准备只允许生产 CloudBase 后端网关模式');
  if(environment.DEPLOYMENT_PROFILE==='cloudbase_staging_demo'||environment.DEMO_DATA_ONLY==='true')throw new Error('匿名 staging 禁止准备会员匹配令牌');
  if(environment.FORMAL_MEMBER_BINDING_ROUTES_ENABLED!=='false'||environment.CLOUDBASE_MEMBER_BINDING_WRITES_ENABLED!=='false')throw new Error('离线准备阶段必须继续关闭正式绑定路由与 CloudBase 写入');
  if(environment.CRM_MATCH_TOKEN_MIGRATION_APPLIED!==REQUIRED_FUTURE_MIGRATION)throw new Error(`匹配令牌准备需要未来 ${REQUIRED_FUTURE_MIGRATION} 标识；不代表数据库已应用`);
  const activeVersion=version(environment.CRM_MATCH_TOKEN_ACTIVE_KEY_VERSION,'CRM_MATCH_TOKEN_ACTIVE_KEY_VERSION'),activeKey=key(environment.CRM_MATCH_TOKEN_ACTIVE_HMAC_KEY,'CRM_MATCH_TOKEN_ACTIVE_HMAC_KEY');
  const hasPreviousVersion=present(environment.CRM_MATCH_TOKEN_PREVIOUS_KEY_VERSION),hasPreviousKey=present(environment.CRM_MATCH_TOKEN_PREVIOUS_HMAC_KEY);if(hasPreviousVersion!==hasPreviousKey)throw new Error('上一代匹配密钥版本与密钥必须成对配置');
  let previous=null;if(hasPreviousVersion){previous={version:version(environment.CRM_MATCH_TOKEN_PREVIOUS_KEY_VERSION,'CRM_MATCH_TOKEN_PREVIOUS_KEY_VERSION'),key:key(environment.CRM_MATCH_TOKEN_PREVIOUS_HMAC_KEY,'CRM_MATCH_TOKEN_PREVIOUS_HMAC_KEY')};if(previous.version===activeVersion||crypto.timingSafeEqual(previous.key,activeKey))throw new Error('新旧匹配密钥版本和密钥必须不同')}
  return {prepared:true,runtimeEnabled:false,mode:PREPARATION_MODE,requiredFutureMigration:REQUIRED_FUTURE_MIGRATION,active:{version:activeVersion,key:activeKey},previous,safeSummary:{prepared:true,runtimeEnabled:false,serverOnly:true,routesEnabled:false,cloudWritesEnabled:false,ordinaryLogsContainValues:false,keyVersions:previous?[activeVersion,previous.version]:[activeVersion],rotationWindow:previous?'dual_write':'single_active',credentialsExposed:false}};
}

function normalizePhone(value){const compact=String(value||'').normalize('NFKC').trim().replace(/[\s\-()]/g,'').replace(/^\+86/,'').replace(/^86(?=1[3-9]\d{9}$)/,'');if(!/^1[3-9]\d{9}$/.test(compact))throw new CrmMatchTokenProvisioningError('CRM_MATCH_TOKEN_PHONE_INVALID');return compact}
function tokenFor({kind=TOKEN_KIND,value,keyVersion,hmacKey}){const normalized=kind===TOKEN_KIND?normalizePhone(value):null;if(!normalized)throw new CrmMatchTokenProvisioningError('CRM_MATCH_TOKEN_KIND_UNSUPPORTED');return crypto.createHmac('sha256',hmacKey).update(`venture-club\0crm-match-token\0${keyVersion}\0${kind}\0${normalized}`,'utf8').digest('hex')}

class VersionedCrmMatchTokenizer{
  constructor({config}){if(!config?.prepared||config.mode!==PREPARATION_MODE||config.runtimeEnabled!==false)throw new Error('匹配令牌器需要完整的离线准备配置');this.config=config}
  async tokenize(kind,value){if(kind!==TOKEN_KIND)throw new CrmMatchTokenProvisioningError('CRM_MATCH_TOKEN_KIND_UNSUPPORTED');return tokenFor({kind,value,keyVersion:this.config.active.version,hmacKey:this.config.active.key})}
  tokenizeForProvisioning(kind,value){if(kind!==TOKEN_KIND)throw new CrmMatchTokenProvisioningError('CRM_MATCH_TOKEN_KIND_UNSUPPORTED');const generations=[this.config.active,this.config.previous].filter(Boolean).map(item=>({kind,keyVersion:item.version,tokenHash:tokenFor({kind,value,keyVersion:item.version,hmacKey:item.key})}));return {kind,generations,rotationState:this.config.previous?'dual_write':'single_active',sensitiveValuesReturned:false}}
  safeReadiness(){return this.config.safeSummary}
}

class OfflineCrmMatchTokenProvisioningService{
  constructor({config,tokenizer,repository}){if(!config?.prepared||config.runtimeEnabled!==false||!(tokenizer instanceof VersionedCrmMatchTokenizer))throw new Error('受控匹配令牌服务需要离线准备配置与版本化令牌器');if(repository?.kind!=='mockable_crm_match_token_repository'||repository.runtimeEnabled!==false||typeof repository.replaceConfirmedPhoneTokens!=='function')throw new Error('受控匹配令牌服务需要可 mock 且禁止真实写入的持久化合约');this.config=config;this.tokenizer=tokenizer;this.repository=repository}
  async provisionConfirmedCrmPhone({actor,review,memberId,phone,crmRecordVersionHash,idempotencyKey}={}){
    try{
      if(!actor?.verified||!safeId(actor.userId)||!safeId(actor.authorizationId)||!Array.isArray(actor.permissions)||!actor.permissions.includes('member_import.materialize.execute'))throw new CrmMatchTokenProvisioningError('CRM_MATCH_TOKEN_OPERATOR_DENIED');
      if(!review?.approved||!safeId(review.reviewerId)||review.reviewerId===actor.userId||review.permission!=='member_import.review'||!safeId(review.authorizationId))throw new CrmMatchTokenProvisioningError('CRM_MATCH_TOKEN_REVIEW_REQUIRED');
      const userId=safeId(memberId),recordVersion=safeHash(crmRecordVersionHash),requestKey=safeHash(idempotencyKey),generated=this.tokenizer.tokenizeForProvisioning(TOKEN_KIND,phone);
      const result=await this.repository.replaceConfirmedPhoneTokens({userId,tokenKind:TOKEN_KIND,generations:generated.generations,source:'confirmed_crm_materialization',crmRecordVersionHash:recordVersion,actorId:actor.userId,reviewerId:review.reviewerId,actorAuthorizationId:actor.authorizationId,reviewAuthorizationId:review.authorizationId,idempotencyKeyHash:requestKey,writeScope:'member_binding_match_tokens_only'});
      if(!result||!['created','reused'].includes(result.idempotencyStatus)||Number(result.tokenGenerationCount)!==generated.generations.length)throw new CrmMatchTokenProvisioningError();
      return {status:'prepared_contract_validated',idempotencyStatus:result.idempotencyStatus,tokenGenerationCount:generated.generations.length,keyVersions:generated.generations.map(item=>item.keyVersion),runtimeEnabled:false,cloudWriteAttempted:false,ordinaryLogsContainValues:false,sensitiveValuesReturned:false};
    }catch(error){if(error instanceof CrmMatchTokenProvisioningError)throw error;throw new CrmMatchTokenProvisioningError()}
  }
  safeReadiness(){return {prepared:true,runtimeEnabled:false,serverOnly:true,requiresConfirmedCrmMaterialization:true,separationOfDuties:true,rotation:this.config.safeSummary.rotationWindow,cloudWriteAttempted:false,routesEnabled:false,memoryFallback:false,ordinaryLogsContainValues:false,credentialsExposed:false}}
}

module.exports={REQUIRED_FUTURE_MIGRATION,PREPARATION_MODE,TOKEN_KIND,CrmMatchTokenProvisioningError,resolveCrmMatchTokenPreparationConfig,normalizePhone,VersionedCrmMatchTokenizer,OfflineCrmMatchTokenProvisioningService};
