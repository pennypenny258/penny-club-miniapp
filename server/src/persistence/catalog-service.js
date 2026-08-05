'use strict';
const {requireActiveMember}=require('../domain');

class CatalogUnavailableError extends Error{
  constructor(){super('资料与活动目录暂时不可用');this.name='CatalogUnavailableError';this.code='CATALOG_PERSISTENCE_UNAVAILABLE';this.statusCode=503}
}

function assertGatewayCatalogContractReady({repository,identityProvider,featureEnabled}){
  if(repository?.kind!=='cloudbase_gateway'||repository.config?.mode!=='cloudbase_gateway'||!repository.config?.enabled)throw new Error('真实目录读取只允许使用已通过生产预检的 cloudbase_gateway repository');
  if(repository.config.runtimeEnvironment!=='production')throw new Error('真实目录读取只允许在 production 运行');
  if(identityProvider!=='external_verified_session')throw new Error('真实目录读取必须先接入可验证的服务端会员身份映射');
  if(featureEnabled!==true||repository.config.catalogReadsEnabled!==true)throw new Error('真实目录读取开关尚未启用');
  return true;
}

class GatewayCatalogReadService{
  constructor({repository,memberResolver,identityProvider,featureEnabled}){assertGatewayCatalogContractReady({repository,identityProvider,featureEnabled});if(typeof memberResolver!=='function')throw new Error('真实目录读取需要服务端会员身份解析器');this.repository=repository;this.memberResolver=memberResolver}
  async requireMember(identityContext){const member=await this.memberResolver(identityContext);requireActiveMember(member);return member}
  async listResources(identityContext,{limit=50}={}){await this.requireMember(identityContext);try{return (await this.repository.listPublishedResources({limit})).map(safeResource)}catch{throw new CatalogUnavailableError()}}
  async listActivities(identityContext,{limit=50}={}){await this.requireMember(identityContext);try{return (await this.repository.listPublicActivities({limit})).map(safeActivity)}catch{throw new CatalogUnavailableError()}}
}

function safeResource(row){return {id:String(row.id),type:String(row.type||''),title:String(row.title||''),summary:String(row.summary||''),tags:Array.isArray(row.tags)?row.tags.map(String).slice(0,10):[],accessLevel:String(row.access_level||'active_member'),mobileSection:String(row.mobile_section||'files_templates'),viewEnabled:true,viewStatus:String(row.preview_status||'preview_not_configured'),downloadEnabled:Boolean(row.download_enabled),publishedAt:row.published_at||null,updatedAt:row.updated_at||null}}
function safeActivity(row){return {id:String(row.id),format:String(row.format||''),title:String(row.title||''),description:String(row.description||''),startsAt:row.starts_at||null,endsAt:row.ends_at||null,registrationEndsAt:row.registration_ends_at||null,category:String(row.category||''),city:String(row.city||''),venue:String(row.venue||''),status:String(row.status||''),createdAt:row.created_at||null}}

module.exports={CatalogUnavailableError,GatewayCatalogReadService,assertGatewayCatalogContractReady,safeResource,safeActivity};
