const runtime = require('./config/runtime');

App({
  onLaunch() {
    if (runtime.environment === 'production' && (runtime.demoMode || !runtime.apiBase.startsWith('https://'))) {
      throw new Error('生产配置无效：必须关闭演示模式并使用 HTTPS API');
    }
  },
  globalData: { runtime }
});
