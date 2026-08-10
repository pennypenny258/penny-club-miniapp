'use strict';
const crypto=require('node:crypto');

const TYPE_RULES=Object.freeze({
  investment:['投资','项目筛选','股权投资'],fundraising:['融资','募资','融资顾问'],ma:['并购','收购','出售'],
  recruitment:['招聘','岗位','人才'],business_attraction:['招商','落地','园区']
});
const DIMENSIONS=Object.freeze(['person','organization','role','matter']);
const PRIVATE_KEYS=/phone|mobile|wechat|contact|payment|crm|real.?name|order|remark/i;
const redact=text=>String(text||'').slice(0,2000)
  .replace(/1[3-9]\d{9}/g,'[手机号已移除]')
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[邮箱已移除]')
  .replace(/(?:微信|wx|wechat)\s*[:：]?\s*[A-Za-z][-_A-Za-z0-9]{5,}/gi,'[微信号已移除]');
const normalizedTags=tags=>[...new Set((Array.isArray(tags)?tags:[]).map(x=>String(x).trim().slice(0,24)).filter(Boolean))].slice(0,12);

function ruleDraft(input={}){
  const text=redact(input.text),tags=normalizedTags(input.tags),haystack=`${text} ${tags.join(' ')}`.toLowerCase();
  const scores=Object.entries(TYPE_RULES).map(([type,words])=>({type,hits:words.filter(word=>haystack.includes(word.toLowerCase()))})).filter(x=>x.hits.length).sort((a,b)=>b.hits.length-a.hits.length);
  const dimensions=Object.fromEntries(DIMENSIONS.map(key=>[key,Boolean(String(input.criteria?.[key]||'').trim())]));
  const matchedDimensions=Object.values(dimensions).filter(Boolean).length,type=scores[0]?.type||'needs_manual_classification';
  const confidence=Math.min(.95,(type==='needs_manual_classification'?0.25:0.58)+Math.min(scores[0]?.hits.length||0,3)*0.1+matchedDimensions*0.03);
  return {type,matchedKeywords:scores[0]?.hits||[],tags,dimensions,matchedDimensions,directionalCandidateEligible:matchedDimensions>=3,confidence:Number(confidence.toFixed(2)),source:'rules',humanReviewRequired:true,autoPublish:false,autoNotify:false,contactDisclosureAllowed:false};
}

class DisabledDemandModelProvider{async structure(){throw Object.assign(new Error('需求结构化模型未配置'),{code:'DEMAND_MODEL_NOT_CONFIGURED',statusCode:503})}}

class LowCostDemandMatchPlanner{
  constructor({provider=new DisabledDemandModelProvider(),providerConfigured=false,cache=new Map(),dailyModelLimit=30,maxBatchEmbeddings=64,clock=()=>new Date()}={}){this.provider=provider;this.providerConfigured=providerConfigured;this.cache=cache;this.dailyModelLimit=dailyModelLimit;this.maxBatchEmbeddings=maxBatchEmbeddings;this.clock=clock;this.usage=new Map()}
  async plan(input={}){
    const rules=ruleDraft(input),day=this.clock().toISOString().slice(0,10);
    if(rules.confidence>=.7||!this.providerConfigured)return {...rules,modelStatus:this.providerConfigured?'not_needed':'not_configured',costMode:'rules_first'};
    const modelInput={text:redact(input.text),tags:rules.tags,typeHint:rules.type};
    const cacheKey=crypto.createHash('sha256').update(JSON.stringify(modelInput)).digest('hex');
    if(this.cache.has(cacheKey))return {...rules,modelStatus:'cache_hit',modelDraft:this.cache.get(cacheKey),costMode:'cached'};
    const used=this.usage.get(day)||0;if(used>=this.dailyModelLimit)return {...rules,modelStatus:'daily_limit_reached',costMode:'rules_only'};
    const modelDraft=await this.provider.structure(modelInput);this.usage.set(day,used+1);this.cache.set(cacheKey,modelDraft);
    return {...rules,modelStatus:'low_confidence_structured',modelDraft,costMode:'limited_model',humanReviewRequired:true,autoPublish:false,autoNotify:false,contactDisclosureAllowed:false};
  }
  prepareEmbeddingBatch(items=[]){
    if(!Array.isArray(items)||items.length>this.maxBatchEmbeddings)throw Object.assign(new Error(`单批最多 ${this.maxBatchEmbeddings} 条公开安全摘要`),{code:'EMBEDDING_BATCH_LIMIT'});
    return items.map(item=>{if(Object.keys(item||{}).some(key=>PRIVATE_KEYS.test(key)))throw Object.assign(new Error('嵌入批次包含禁止的私有字段'),{code:'PRIVATE_FIELD_NOT_ALLOWED'});return {id:String(item.id||''),text:redact(item.publicSummary),tags:normalizedTags(item.tags)}});
  }
}

function safeDemandMatchingReadiness(){return {mode:'rules_first',modelConfigured:false,modelUse:'low_confidence_only',cacheRequired:true,dailyLimitRequired:true,batchEmbeddingsRequired:true,humanReviewRequired:true,autoPublish:false,autoNotify:false,contactDisclosureAllowed:false};}
module.exports={TYPE_RULES,DIMENSIONS,redact,ruleDraft,DisabledDemandModelProvider,LowCostDemandMatchPlanner,safeDemandMatchingReadiness};
