'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {TagSuggestionService}=require('../src/tag-suggestion-provider');

test('AI tag provider boundary is server-only and disabled by default',async()=>{
  const service=new TagSuggestionService(),capabilities=service.safeCapabilities();
  assert.deepEqual(capabilities,{aiTaggingConfigured:false,aiProvider:'none',aiModel:null,apiKeysAcceptedByBrowser:false,configurationBoundary:'server_only'});
  await assert.rejects(()=>service.suggestFromExtractedText({title:'匿名报告',extractedText:'测试'}),error=>error.code==='AI_TAGGING_NOT_CONFIGURED');
});
