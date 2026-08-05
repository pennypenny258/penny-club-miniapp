function request(path, options = {}) {
  const runtime = getApp().globalData.runtime;
  const header = { 'content-type': 'application/json' };
  // 演示身份只允许在明确的开发模式发送，正式登录必须由服务端校验微信官方登录凭证。
  if (runtime.demoMode && runtime.environment === 'development') header['x-demo-user'] = runtime.demoIdentity;
  return new Promise((resolve, reject) => wx.request({
    url: runtime.apiBase + path,
    method: options.method || 'GET',
    data: options.data,
    header,
    success: ({ statusCode, data }) => statusCode < 400 ? resolve(data) : reject(new Error(data.error || '请求失败')),
    fail: reject
  }));
}
module.exports = { request };
