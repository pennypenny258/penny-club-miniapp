'use strict';

const fs=require('node:fs');
const path=require('node:path');

const LOCAL_ENV_KEYS=new Set(['FEISHU_APP_ID','FEISHU_APP_SECRET','PRIVATE_STORAGE_DIR','FEISHU_MAX_ATTACHMENT_BYTES']);

function parseLocalEnv(text){
  const result={};
  String(text||'').split(/\r?\n/).forEach((raw,index)=>{
    const line=raw.trim();
    if(!line||line.startsWith('#'))return;
    const match=line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if(!match)throw new Error(`.env.local 第 ${index+1} 行格式无效，应为变量名=值`);
    const key=match[1];if(!LOCAL_ENV_KEYS.has(key))return;
    let value=match[2].trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    if(/[\r\n\0]/.test(value))throw new Error(`.env.local 第 ${index+1} 行包含无效字符`);
    result[key]=value;
  });
  return result;
}

function diagnoseLocalEnv({filePath=path.join(__dirname,'..','..','.env.local'),projectRoot=path.join(__dirname,'..','..')}={}){
  const result={fileExists:false,permissionSafe:false,requiredKeysPresent:false,requiredValuesNonEmpty:false,hasQuotedRequiredValues:false,hasCrlf:false,hasBom:false,hasMalformedLines:false,hasDuplicateRequiredKeys:false,hasPlaceholderRequiredValues:false,hasWhitespaceInRequiredValues:false,hasUnsupportedInlineComment:false,misplacedLocalEnvDetected:false,problemCodes:[]};
  const ignored=new Set(['.git','node_modules','private-storage']);let misplaced=false;
  const scan=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){if(ignored.has(entry.name))continue;const full=path.join(directory,entry.name);if(entry.isDirectory())scan(full);else if(entry.name==='.env.local'&&path.resolve(full)!==path.resolve(filePath))misplaced=true}};
  try{scan(projectRoot)}catch{void 0}result.misplacedLocalEnvDetected=misplaced;
  if(!fs.existsSync(filePath)){result.problemCodes.push('ROOT_FILE_MISSING');if(misplaced)result.problemCodes.push('MISPLACED_FILE');return result}
  result.fileExists=true;const stat=fs.statSync(filePath);result.permissionSafe=process.platform==='win32'||(stat.mode&0o077)===0;if(!result.permissionSafe)result.problemCodes.push('PERMISSIONS_TOO_OPEN');
  const text=fs.readFileSync(filePath,'utf8');result.hasCrlf=text.includes('\r\n');result.hasBom=text.charCodeAt(0)===0xfeff;if(result.hasBom)result.problemCodes.push('BOM_PRESENT');
  const required=['FEISHU_APP_ID','FEISHU_APP_SECRET'];const seen=new Map();
  for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('#'))continue;const match=line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);if(!match){result.hasMalformedLines=true;continue}const [,,rawValue]=match,key=match[1];if(!required.includes(key))continue;if(seen.has(key))result.hasDuplicateRequiredKeys=true;let value=rawValue.trim();const quoted=(value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"));if(quoted){result.hasQuotedRequiredValues=true;value=value.slice(1,-1)}else if(/\s+#/.test(value)){result.hasUnsupportedInlineComment=true}if(/\s/.test(value))result.hasWhitespaceInRequiredValues=true;if(/^(?:your[_-]?|replace[_-]?me|example|placeholder|demo|xxx+|changeme|<[^>]+>)$/i.test(value))result.hasPlaceholderRequiredValues=true;seen.set(key,value)}
  result.requiredKeysPresent=required.every(key=>seen.has(key));result.requiredValuesNonEmpty=required.every(key=>Boolean(seen.get(key)));
  if(!result.requiredKeysPresent)result.problemCodes.push('REQUIRED_KEY_MISSING');if(!result.requiredValuesNonEmpty)result.problemCodes.push('REQUIRED_VALUE_EMPTY');if(result.hasMalformedLines)result.problemCodes.push('MALFORMED_LINE');if(result.hasDuplicateRequiredKeys)result.problemCodes.push('DUPLICATE_KEY');if(result.hasPlaceholderRequiredValues)result.problemCodes.push('PLACEHOLDER_VALUE');if(result.hasWhitespaceInRequiredValues)result.problemCodes.push('REQUIRED_VALUE_HAS_WHITESPACE');if(result.hasUnsupportedInlineComment)result.problemCodes.push('INLINE_COMMENT_NOT_SUPPORTED');if(misplaced)result.problemCodes.push('MISPLACED_FILE');
  return result;
}

function loadLocalEnv({environment=process.env,filePath=path.join(__dirname,'..','..','.env.local')}={}){
  if(environment.NODE_ENV==='production')return {loaded:false,reason:'production_uses_platform_secrets',keys:[]};
  if(environment.DEPLOYMENT_PROFILE==='cloudbase_staging_demo')return {loaded:false,reason:'cloud_staging_ignores_local_files',keys:[]};
  if(environment.NODE_ENV&&environment.NODE_ENV!=='development')return {loaded:false,reason:'non_development_ignores_local_files',keys:[]};
  if(!fs.existsSync(filePath))return {loaded:false,reason:'file_missing',keys:[]};
  const stat=fs.statSync(filePath);
  if(process.platform!=='win32'&&(stat.mode&0o077)!==0)throw new Error('.env.local 权限过宽；请运行 chmod 600 .env.local 或重新使用本地配置助手创建');
  const values=parseLocalEnv(fs.readFileSync(filePath,'utf8')),loaded=[];
  for(const [key,value] of Object.entries(values)){if(environment[key]===undefined){environment[key]=value;loaded.push(key)}}
  return {loaded:true,reason:'local_file',keys:loaded};
}

module.exports={LOCAL_ENV_KEYS,parseLocalEnv,loadLocalEnv,diagnoseLocalEnv};
