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
module.exports = { request };
