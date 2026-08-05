'use strict';

const profiles = Object.freeze({
  local: Object.freeze({
    target: 'local',
    environment: 'development',
    apiBase: 'http://localhost:3000',
    demoMode: true,
    testOnly: true,
    identityMode: 'anonymous_demo_default'
  }),
  'cloudbase-staging': Object.freeze({
    target: 'cloudbase-staging',
    environment: 'cloudbase_staging',
    apiBase: 'https://penny-club-miniapp2-292157-4-1319128701.sh.run.tcloudbase.com',
    demoMode: true,
    testOnly: true,
    identityMode: 'anonymous_demo_default'
  })
});

function resolveRuntime(target) {
  const profile = profiles[target];
  if (!profile) throw new Error('未知的小程序运行目标；只允许 local 或 cloudbase-staging');
  if (profile.target === 'cloudbase-staging' && (!profile.testOnly || !profile.apiBase.startsWith('https://'))) {
    throw new Error('CloudBase staging 必须标记为仅测试并使用 HTTPS');
  }
  return profile;
}

module.exports = { profiles, resolveRuntime };
