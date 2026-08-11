const runtime = require('./config/runtime');

App({
  onLaunch() {
    if (runtime.target === 'cloudbase-staging' && (!runtime.testOnly || !runtime.apiBase.startsWith('https://'))) {
      throw new Error('CloudBase staging 配置无效：必须标为仅测试并使用 HTTPS API');
    }
    if (runtime.environment === 'production' && (runtime.demoMode || !runtime.apiBase.startsWith('https://'))) {
      throw new Error('生产配置无效：必须关闭演示模式并使用 HTTPS API');
    }
    if (runtime.formalBindingEnabled === true && runtime.identityMode !== 'formal_member_binding') {
      throw new Error('正式会员绑定配置无效：身份模式不匹配');
    }
    if (runtime.formalBindingEnabled === true && !wx.getStorageSync('memberAccessToken')) {
      wx.reLaunch({ url: '/pages/member-binding/member-binding' });
    }
  },
  globalData: { runtime }
});
