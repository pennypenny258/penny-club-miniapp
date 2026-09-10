'use strict';
const crypto=require('node:crypto');
const {CloudBaseGatewayTransport}=require('./repository');

const ACTIVITY_RPC='venture_upsert_activity',ACTIVITY_VIEW='venture_activities_public';
const ACTIVITY_FIELDS='id,format,title,description,starts_at,ends_at,registration_ends_at,category,city,venue,status,created_at,speaker_summary,participant_summary,updated_at,replay_available';
class ProductionActivityUnavailableError extends Error{constructor(){super('生产活动录入服务暂时不可用');this.code='PRODUCTION_ACTIVITY_UNAVAILABLE';this.statusCode=503}}

class ActivityPrivateProtector{
  constructor(value){const text=String(value||''),key=Buffer.from(text,'base64');if(key.length!==32||key.toString('base64').replace(/=+$/,'')!==text.replace(/=+$/,''))throw new Error('ACTIVITY_PRIVATE_LINK_ENCRYPTION_KEY 必须是 32 字节 base64 服务端密钥');this.key=key}
  protect(value,context){if(!value)return null;const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(context));const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([Buffer.from([1]),iv,cipher.getAuthTag(),body]).toString('base64url')}
}

class CloudBaseProductionActivityRepository{
  constructor({config,fetchImpl=globalThis.fetch}){if(!config?.enabled||config.mode!=='cloudbase_gateway'||config.migration!=='014_production_intake_008_baseline')throw new Error('活动仓库需要已验收的 014 生产网关配置');this.kind='cloudbase_gateway';this.config=config;this.fetchImpl=fetchImpl;this.reader=new CloudBaseGatewayTransport({config,fetchImpl})}
  list({limit=50}={}){const n=Number(limit);if(!Number.isInteger(n)||n<1||n>100)throw new Error('活动分页上限必须是 1–100');return this.reader.readView(ACTIVITY_VIEW,[['select',ACTIVITY_FIELDS],['order','starts_at.desc'],['limit',n]])}
  call(input){return this.rpc({p_authorization_id:id(input.authorizationId,'授权'),p_actor_id:id(input.actorId,'操作者'),p_activity_id:id(input.activityId,'活动'),p_format:input.format,p_title:input.title,p_description:input.description,p_starts_at:input.startsAt,p_ends_at:input.endsAt,p_registration_ends_at:input.registrationEndsAt,p_category:input.category,p_city:input.city,p_venue:input.venue,p_speaker_summary:input.speakerSummary,p_participant_summary:input.participantSummary,p_status:input.status,p_meeting_link_ciphertext:input.meetingLinkCiphertext,p_replay_link_ciphertext:input.replayLinkCiphertext,p_minutes_object_key_ciphertext:input.minutesLocatorCiphertext,p_recording_object_key_ciphertext:input.recordingLocatorCiphertext})}
  async rpc(payload){const url=new URL(`/v1/rdb/rest/rpc/${ACTIVITY_RPC}`,this.config.origin),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);try{const response=await this.fetchImpl(url,{method:'POST',redirect:'error',signal:controller.signal,headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${this.config.serverApiKey}`},body:JSON.stringify(payload)});if(!response?.ok)throw new ProductionActivityUnavailableError();const text=await response.text();if(Buffer.byteLength(text,'utf8')>32768)throw new ProductionActivityUnavailableError();const value=JSON.parse(text||'null');if(!value||typeof value!=='object'||Array.isArray(value))throw new ProductionActivityUnavailableError();return value}catch(error){if(error instanceof ProductionActivityUnavailableError)throw error;throw new ProductionActivityUnavailableError()}finally{clearTimeout(timer)}}
}

class ProductionActivityService{
  constructor({repository,protector,adminSessionService,uuid=crypto.randomUUID}){if(repository?.kind!=='cloudbase_gateway'||!(protector instanceof ActivityPrivateProtector)||typeof adminSessionService?.authorizeAction!=='function')throw new Error('生产活动服务依赖未完整注入');this.repository=repository;this.protector=protector;this.adminSessionService=adminSessionService;this.uuid=uuid}
  async list(request){const admin=await this.adminSessionService.resolveRequest(request);requireActivityPermission(admin);return this.repository.list({limit:50})}
  async upsert(request,input={}){
    const idempotencyKey=String(request?.headers?.['idempotency-key']||request?.headers?.['Idempotency-Key']||'');
    const admin=await this.adminSessionService.authorizeAction({request,permission:'activity.manage',idempotencyKey});
    const activity=normalizeActivity(input,this.uuid),context=`activity:${activity.activityId}`;
    const result=await this.repository.call({...activity,actorId:admin.userId,authorizationId:admin.authorizationId,meetingLinkCiphertext:this.protector.protect(activity.meetingLink,`${context}:meeting`),replayLinkCiphertext:this.protector.protect(activity.replayLink,`${context}:replay`),minutesLocatorCiphertext:this.protector.protect(activity.minutesLocator,`${context}:minutes`),recordingLocatorCiphertext:this.protector.protect(activity.recordingLocator,`${context}:recording`)});
    return {activityId:result.activity_id||activity.activityId,status:result.status||activity.status,persistent:true,reused:result.reused===true,privateLinksReturned:false,contactDisclosed:false};
  }
}

function normalizeActivity(input,uuid){
  const format=String(input.format||''),status=String(input.status||''),title=String(input.title||'').trim(),description=nullable(input.description,2000),startsAt=date(input.startsAt,true),endsAt=date(input.endsAt,false),registrationEndsAt=date(input.registrationEndsAt,false),city=nullable(input.city,80),venue=nullable(input.venue,200);
  if(!['online','offline'].includes(format)||!['draft','waiting','completed','cancelled'].includes(status)||title.length<2||title.length>160)throw invalid('活动主题、形式或状态无效');
  if(endsAt&&new Date(endsAt)<new Date(startsAt))throw invalid('活动结束时间不能早于开始时间');
  const meetingLink=httpsUrl(input.meetingLink,'会议链接'),replayLink=httpsUrl(input.replayLink,'回放链接'),minutesLocator=privateLocator(input.minutesLocator),recordingLocator=privateLocator(input.recordingLocator);
  if(format==='online'&&status==='waiting'&&!meetingLink)throw invalid('等待开启的线上活动必须填写 HTTPS 会议链接');
  if(format==='online'&&status==='completed'&&!replayLink&&!minutesLocator&&!recordingLocator)throw invalid('已完成的线上活动必须填写回放、纪要或录屏之一');
  if(format==='offline'&&status==='waiting'&&(!city||!venue))throw invalid('等待开启的线下活动必须填写城市和地点');
  return {activityId:input.activityId?id(input.activityId,'活动'):`activity-${uuid()}`,format,status,title,description,startsAt,endsAt,registrationEndsAt,category:nullable(input.category,80)||'member_event',city,venue,speakerSummary:people(input.speakers,'分享者'),participantSummary:people(input.participants,'参会者'),meetingLink,replayLink,minutesLocator,recordingLocator};
}
function people(value,label){if(value===undefined||value===null)return [];if(!Array.isArray(value)||value.length>(label==='分享者'?30:200))throw invalid(`${label}信息数量无效`);return value.map(item=>{if(!item||typeof item!=='object'||item.publicDisplayConsent!==true)throw invalid(`${label}信息必须逐项确认公开授权`);const person={displayName:nullable(item.displayName,80),role:nullable(item.role,80),organization:nullable(item.organization,120)};if(!person.displayName)throw invalid(`${label}公开称呼不能为空`);for(const text of Object.values(person).filter(Boolean))if(/(?:1[3-9]\d{9}|@|微信|wechat|wx号)/i.test(text))throw invalid(`${label}公开信息不得包含联系方式`);return person})}
function httpsUrl(value,label){const text=nullable(value,2048);if(!text)return null;let parsed;try{parsed=new URL(text)}catch{throw invalid(`${label}格式无效`)}if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw invalid(`${label}必须使用无账号信息的 HTTPS 地址`);return parsed.toString()}
function privateLocator(value){const text=nullable(value,2048);if(!text)return null;if(/[\x00-\x1f]/.test(text))throw invalid('私有文件引用格式无效');return text}
function nullable(value,max){if(value===undefined||value===null||String(value).trim()==='')return null;const text=String(value).trim();if(text.length>max)throw invalid('活动字段超过长度限制');return text}
function date(value,required){if(value===undefined||value===null||value===''){if(required)throw invalid('活动开始时间不能为空');return null}const parsed=new Date(value);if(!Number.isFinite(parsed.getTime()))throw invalid('活动时间格式无效');return parsed.toISOString()}
function id(value,label='标识'){const text=String(value||'');if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(text))throw invalid(`${label}格式无效`);return text}
function invalid(message){return Object.assign(new Error(message),{statusCode:400,code:'INVALID_ACTIVITY_INPUT'})}
function requireActivityPermission(admin){if(!admin?.verified||!admin.permissions?.includes('activity.manage'))throw Object.assign(new Error('活动管理权限不足'),{statusCode:403,code:'ADMIN_PERMISSION_DENIED'})}

module.exports={ACTIVITY_RPC,ACTIVITY_VIEW,ACTIVITY_FIELDS,ActivityPrivateProtector,CloudBaseProductionActivityRepository,ProductionActivityService,ProductionActivityUnavailableError,normalizeActivity};
