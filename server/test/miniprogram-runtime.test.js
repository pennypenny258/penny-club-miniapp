'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { profiles, resolveRuntime } = require('../../miniprogram/config/runtime-profiles');

test('local mini-program API configuration remains available', () => {
  assert.equal(profiles.local.apiBase, 'http://localhost:3000');
  assert.equal(profiles.local.environment, 'development');
  assert.equal(profiles.local.identityMode, 'anonymous_demo_default');
});

test('CloudBase staging is HTTPS, test-only and never presented as production', () => {
  const staging = resolveRuntime('cloudbase-staging');
  assert.equal(staging.apiBase, 'https://penny-club-test-api-294701-10-1319128701.sh.run.tcloudbase.com');
  assert.equal(staging.environment, 'cloudbase_staging');
  assert.equal(staging.testOnly, true);
  assert.equal(staging.demoMode, true);
  assert.notEqual(staging.environment, 'production');
});

test('mini-program request layer has no cookie, custom demo identity header or fake login', () => {
  const root = path.join(__dirname, '..', '..');
  const api = fs.readFileSync(path.join(root, 'miniprogram/utils/api.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'miniprogram/app.js'), 'utf8');
  assert.doesNotMatch(api, /x-demo-user|['"]cookie['"]\s*:/i);
  assert.doesNotMatch(api + app, /wx\.login\s*\(/);
});

test('unknown runtime targets fail closed', () => {
  assert.throws(() => resolveRuntime('production'), /未知的小程序运行目标/);
});

test('mini-program Agent form uses three fields and all distribution modes',()=>{
  const root=path.join(__dirname,'..','..'),js=fs.readFileSync(path.join(root,'miniprogram/pages/demands/demands.js'),'utf8'),wxml=fs.readFileSync(path.join(root,'miniprogram/pages/demands/demands.wxml'),'utf8');
  for(const value of ['who','why','target','full_public','redacted_public','private_match'])assert.equal((js+wxml).includes(value),true,value);
  assert.match(wxml,/提交人工审核/);assert.match(wxml,/模型未配置/);
});
