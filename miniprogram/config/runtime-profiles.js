'use strict';

const profiles = Object.freeze({
  local: Object.freeze({
    target: 'local',
    environment: 'development',
    apiBase: 'http://localhost:3000',
    demoMode: true,
    testOnly: true,
    identityMode: 'anonymous_demo_default',
    formalBindingEnabled: false
  }),
  'cloudbase-staging': Object.freeze({
    target: 'cloudbase-staging',
    environment: 'cloudbase_staging',
    // 标准版环境内的独立匿名测试服务；不能用于正式会员、CRM 或支付数据。
    apiBase: 'https://test-api.pennysclub.com',
    demoMode: true,
    testOnly: true,
    identityMode: 'anonymous_demo_default',
    formalBindingEnabled: false
  }),
  production: Object.freeze({
    target: 'production',
    environment: 'production',
    apiBase: 'https://api.pennysclub.com',
    demoMode: false,
    testOnly: false,
    identityMode: 'formal_member_binding',
    formalBindingEnabled: true
  })
});

function resolveRuntime(target) {
  const profile = profiles[target];
  if (!profile) throw new Error('未知的小程序运行目标；只允许 local、cloudbase-staging 或 production');
  if (profile.target === 'cloudbase-staging' && (!profile.testOnly || !profile.apiBase.startsWith('https://'))) {
    throw new Error('CloudBase staging 必须标记为仅测试并使用 HTTPS');
  }
  if (profile.target === 'production' && (
    profile.environment !== 'production'
    || profile.demoMode !== false
    || profile.testOnly !== false
    || !profile.apiBase.startsWith('https://')
    || profile.identityMode !== 'formal_member_binding'
    || profile.formalBindingEnabled !== true
  )) throw new Error('正式小程序档位必须使用 HTTPS、关闭演示身份并启用正式会员绑定');
  return profile;
}

module.exports = { profiles, resolveRuntime };
