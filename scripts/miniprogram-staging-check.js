'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const { profiles, resolveRuntime } = require('../miniprogram/config/runtime-profiles');
const issues = [];
const expectedOrigin = 'https://test-api.pennysclub.com';
const staging = resolveRuntime('cloudbase-staging');
const apiText = fs.readFileSync(path.join(root, 'miniprogram/utils/api.js'), 'utf8');
const appText = fs.readFileSync(path.join(root, 'miniprogram/app.js'), 'utf8');
const project = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/project.config.json'), 'utf8'));

if (staging.apiBase !== expectedOrigin) issues.push('CloudBase staging API 地址与已验证测试服务不一致');
if (!staging.testOnly || staging.demoMode !== true) issues.push('CloudBase staging 必须明确标为仅匿名演示');
if (staging.identityMode !== 'anonymous_demo_default') issues.push('联调身份模式必须使用服务端匿名演示默认值');
if (profiles.local.apiBase !== 'http://localhost:3000') issues.push('本机 API 配置未保留');
if (/x-demo-user|['"]cookie['"]\s*:/i.test(apiText)) issues.push('小程序请求不得发送 cookie 或自定义演示身份头');
if (/wx\.login\s*\(/.test(apiText + appText)) issues.push('联调层不得伪造微信登录');
if (project.setting?.urlCheck === false) issues.push('仓库可发布基线不得关闭域名校验；本地联调只能在忽略提交的 project.private.config.json 中覆盖');

if (issues.length) {
  console.error('小程序 CloudBase 联调预检未通过：\n- ' + issues.join('\n- '));
  process.exitCode = 1;
} else {
  console.log('小程序 CloudBase 联调档位预检通过：HTTPS、仅匿名演示、无 cookie/演示身份头/伪造微信登录；仓库基线仍开启域名校验。');
}
