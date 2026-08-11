function request(path, options = {}) {
  const runtime = getApp().globalData.runtime;
  const header = { 'content-type': 'application/json' };
  // 联调只使用服务端匿名演示默认身份；不发送 cookie、自定义身份头，也不伪造 wx.login。
  return new Promise((resolve, reject) => wx.request({
    url: runtime.apiBase + path,
    method: options.method || 'GET',
    data: options.data,
    header,
    success: ({ statusCode, data }) => statusCode < 400 ? resolve(data) : reject(new Error(data.error || '请求失败')),
    fail: reject
  }));
}
function formalRequest(path, options = {}) {
  const runtime = getApp().globalData.runtime;
  if (runtime.environment !== 'production' || runtime.identityMode !== 'formal_member_binding' || runtime.formalBindingEnabled !== true || !runtime.apiBase.startsWith('https://')) {
    return Promise.reject(new Error('正式会员绑定尚未配置；当前不会发送微信身份或手机号凭证'));
  }
  const header = { 'content-type': 'application/json' };
  if (options.auth === true) {
    const token = wx.getStorageSync('memberAccessToken');
    if (!token) return Promise.reject(new Error('需要重新完成会员登录'));
    header.authorization = `Bearer ${token}`;
  }
  return new Promise((resolve, reject) => wx.request({
    url: runtime.apiBase + path,
    method: options.method || 'GET',
    data: options.data,
    header,
    success: ({ statusCode, data }) => statusCode < 400 ? resolve(data) : reject(new Error(data.error || '正式会员绑定请求失败')),
    fail: () => reject(new Error('正式会员绑定服务暂时不可用'))
  }));
}
module.exports = { request, formalRequest };
