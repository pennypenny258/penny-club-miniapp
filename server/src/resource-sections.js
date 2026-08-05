'use strict';

const PUBLIC_RESOURCE_SECTIONS=new Set(['replays','research_reports','group_digests','books','files_templates','benefits']);
const LEGACY_COMBINED_SECTIONS=new Set(['reports_digest','reports_digests']);
const SECTION_BY_TYPE={meeting_replay:'replays',industry_report:'research_reports',group_digest:'group_digests',book:'books',data_source:'files_templates',tool:'files_templates',usage_guide:'files_templates',directory_guide:'files_templates',fundraising_guide:'files_templates',recruitment_guide:'files_templates',activity_notice:'benefits',benefit_update:'benefits'};

function resolveResourceSection(resource={}){
  const current=String(resource.section||resource.mobileSection||'').trim();
  if(PUBLIC_RESOURCE_SECTIONS.has(current))return {section:current,needsClassification:false,source:'canonical'};
  if(current==='unclassified')return {section:'unclassified',needsClassification:true,source:'unclassified'};
  if(!current&&SECTION_BY_TYPE[resource.type])return {section:SECTION_BY_TYPE[resource.type],needsClassification:false,source:'type'};
  if(!LEGACY_COMBINED_SECTIONS.has(current))return {section:current||'unclassified',needsClassification:!PUBLIC_RESOURCE_SECTIONS.has(current),source:'unknown'};

  if(resource.type==='industry_report')return {section:'research_reports',needsClassification:false,source:'legacy_type'};
  if(resource.type==='group_digest')return {section:'group_digests',needsClassification:false,source:'legacy_type'};
  const text=[resource.title,...(Array.isArray(resource.tags)?resource.tags:[])].join(' ');
  const report=/(?:研究报告|行业报告|投研报告|报告)/i.test(text);
  const digest=/(?:群聊精华|群聊摘要|群聊整理)/i.test(text);
  if(report&&!digest)return {section:'research_reports',needsClassification:false,source:'legacy_safe_metadata'};
  if(digest&&!report)return {section:'group_digests',needsClassification:false,source:'legacy_safe_metadata'};
  return {section:'unclassified',needsClassification:true,source:'legacy_ambiguous'};
}

function isMemberVisibleResource(resource){
  return resource?.status==='published'&&resolveResourceSection(resource).section!=='unclassified';
}

module.exports={PUBLIC_RESOURCE_SECTIONS,LEGACY_COMBINED_SECTIONS,SECTION_BY_TYPE,resolveResourceSection,isMemberVisibleResource};
