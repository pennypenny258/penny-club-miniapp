'use strict';

class DisabledTagSuggestionProvider {
  get configured(){return false}
  get providerName(){return 'none'}
  get modelName(){return null}
  async suggest(){const error=new Error('AI 标签服务未配置');error.statusCode=503;error.code='AI_TAGGING_NOT_CONFIGURED';throw error}
}

class TagSuggestionService {
  constructor({provider=new DisabledTagSuggestionProvider()}={}){this.provider=provider}
  safeCapabilities(){return {aiTaggingConfigured:Boolean(this.provider.configured),aiProvider:this.provider.configured?this.provider.providerName:'none',aiModel:this.provider.configured?this.provider.modelName:null,apiKeysAcceptedByBrowser:false,configurationBoundary:'server_only'}}
  async suggestFromExtractedText(input){if(!this.provider.configured)return this.provider.suggest(input);return this.provider.suggest({title:input.title,section:input.section,extractedText:input.extractedText})}
}

module.exports={DisabledTagSuggestionProvider,TagSuggestionService};
