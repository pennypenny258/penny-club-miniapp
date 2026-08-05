'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parsePort, validateDeploymentEnvironment } = require('../server/src/deployment');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const issues = [];

for (const file of ['Dockerfile', '.dockerignore', 'config/cloudbase-staging.env.example']) {
  if (!fs.existsSync(path.join(root, file))) issues.push(`缺少 ${file}`);
}

if (!issues.length) {
  const dockerfile = read('Dockerfile');
  const dockerignore = read('.dockerignore');
  if (!/CMD \["npm", "start"\]/.test(dockerfile)) issues.push('Dockerfile 未使用 npm start');
  if (!/EXPOSE 3000/.test(dockerfile)) issues.push('Dockerfile 未声明 3000 端口');
  if (!/\/healthz/.test(dockerfile)) issues.push('Dockerfile 未配置健康检查');
  if (!/NODE_ENV=staging/.test(dockerfile)) issues.push('Dockerfile 未默认使用 staging 环境');
  if (!/DEPLOYMENT_PROFILE=cloudbase_staging_demo/.test(dockerfile)) issues.push('Dockerfile 未默认使用 CloudBase 匿名测试配置');
  if (!/DEMO_DATA_ONLY=true/.test(dockerfile)) issues.push('Dockerfile 未默认限制为匿名演示数据');
  for (const pattern of ['.env.*', 'server/private-storage', 'server/data']) {
    if (!dockerignore.includes(pattern)) issues.push(`.dockerignore 未排除 ${pattern}`);
  }
}

try {
  parsePort('3000');
  validateDeploymentEnvironment({
    NODE_ENV: 'staging',
    DEPLOYMENT_PROFILE: 'cloudbase_staging_demo',
    DEMO_DATA_ONLY: 'true'
  });
} catch (error) {
  issues.push(error.message);
}

if (issues.length) {
  console.error('CloudBase 测试部署预检未通过：\n- ' + issues.join('\n- '));
  process.exitCode = 1;
} else {
  console.log('CloudBase 匿名测试部署预检通过；未检查、读取或上传任何 Secret 与本地附件。');
}
