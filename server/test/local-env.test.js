'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {parseLocalEnv,loadLocalEnv,diagnoseLocalEnv}=require('../src/load-local-env');

test('local env parser accepts only the Feishu development allowlist',()=>{
  const values=parseLocalEnv('FEISHU_APP_ID=demo-app\nFEISHU_APP_SECRET="demo-secret"\nPRIVATE_STORAGE_DIR=./server/private-storage\nUNRELATED_SECRET=ignored\n');
  assert.deepEqual(values,{FEISHU_APP_ID:'demo-app',FEISHU_APP_SECRET:'demo-secret',PRIVATE_STORAGE_DIR:'./server/private-storage'});
});

test('local env loader does not override injected environment and never loads in production',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'venture-local-env-')),filePath=path.join(directory,'.env.local');
  fs.writeFileSync(filePath,'FEISHU_APP_ID=file-app\nFEISHU_APP_SECRET=file-secret\n',{mode:0o600});
  const development={FEISHU_APP_ID:'platform-app'};const loaded=loadLocalEnv({environment:development,filePath});
  assert.equal(loaded.loaded,true);assert.deepEqual(loaded.keys,['FEISHU_APP_SECRET']);assert.equal(development.FEISHU_APP_ID,'platform-app');assert.equal(development.FEISHU_APP_SECRET,'file-secret');
  const production={NODE_ENV:'production'};const skipped=loadLocalEnv({environment:production,filePath});assert.equal(skipped.reason,'production_uses_platform_secrets');assert.equal(production.FEISHU_APP_ID,undefined);
  const staging={DEPLOYMENT_PROFILE:'cloudbase_staging_demo'};const cloudSkipped=loadLocalEnv({environment:staging,filePath});assert.equal(cloudSkipped.reason,'cloud_staging_ignores_local_files');assert.equal(staging.FEISHU_APP_ID,undefined);
  const testEnvironment={NODE_ENV:'test'};const testSkipped=loadLocalEnv({environment:testEnvironment,filePath});assert.equal(testSkipped.reason,'non_development_ignores_local_files');assert.equal(testEnvironment.FEISHU_APP_ID,undefined);
});

test('local env loader rejects group-readable secret files',()=>{
  if(process.platform==='win32')return;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'venture-local-env-mode-')),filePath=path.join(directory,'.env.local');
  fs.writeFileSync(filePath,'FEISHU_APP_ID=demo-app\n',{mode:0o644});fs.chmodSync(filePath,0o644);
  assert.throws(()=>loadLocalEnv({environment:{},filePath}),/权限过宽/);
});

test('local env diagnostics report only safe booleans and problem categories',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'venture-local-env-diagnostics-')),filePath=path.join(directory,'.env.local');
  fs.writeFileSync(filePath,'FEISHU_APP_ID=safe-fixture-app\nFEISHU_APP_SECRET=safe-fixture-secret\nPRIVATE_STORAGE_DIR=./private\n',{mode:0o600});
  const result=diagnoseLocalEnv({filePath,projectRoot:directory}),serialized=JSON.stringify(result);
  assert.equal(result.fileExists,true);assert.equal(result.permissionSafe,true);assert.equal(result.requiredKeysPresent,true);assert.equal(result.requiredValuesNonEmpty,true);assert.deepEqual(result.problemCodes,[]);
  assert.equal(serialized.includes('safe-fixture'),false);assert.equal(Object.values(result).some(value=>typeof value==='number'),false);
});

test('local env diagnostics classify unsafe formatting without returning values',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'venture-local-env-invalid-')),filePath=path.join(directory,'.env.local');
  fs.writeFileSync(filePath,'FEISHU_APP_ID = "example"\r\nFEISHU_APP_SECRET=\r\n',{mode:0o600});
  const result=diagnoseLocalEnv({filePath,projectRoot:directory});
  assert.equal(result.hasCrlf,true);assert.equal(result.hasQuotedRequiredValues,true);assert.equal(result.hasPlaceholderRequiredValues,true);assert.equal(result.requiredValuesNonEmpty,false);assert.ok(result.problemCodes.includes('REQUIRED_VALUE_EMPTY'));
});

test('local helper files contain no credentials and private paths are ignored',()=>{
  const root=path.join(__dirname,'..','..'),example=fs.readFileSync(path.join(root,'config','local.env.example'),'utf8'),helper=fs.readFileSync(path.join(root,'configure-feishu-local.command'),'utf8'),ignore=fs.readFileSync(path.join(root,'.gitignore'),'utf8');
  assert.match(example,/FEISHU_APP_ID=\nFEISHU_APP_SECRET=\n/);assert.equal(/app_[a-z0-9]{8,}|secret-[a-z0-9]/i.test(example+helper),false);assert.match(ignore,/\.env\.\*/);assert.match(ignore,/server\/private-storage\//);
});
