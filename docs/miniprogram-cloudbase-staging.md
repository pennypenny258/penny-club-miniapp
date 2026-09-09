# 微信开发者工具连接 CloudBase 测试环境

> 当前 local 与 CloudBase staging 都是匿名演示配置，`formalBindingEnabled=false`。即使首次绑定页面已随代码打包，也不会调用 `wx.login`、`getPhoneNumber` 或正式绑定接口。不要为了测试匿名 staging 手工改开该值。

本指南只用于匿名演示联调，不是正式发布流程。测试 API 已使用自有子域名 `https://test-api.pennysclub.com`，但后端仍是不持久化的匿名演示服务，不承诺生产 SLA，也不能作为真实会员数据的正式 API。

## 1. 导入项目

1. 打开微信开发者工具，选择“小程序 → 导入项目”。
2. 项目目录选择本机项目中的 `miniprogram/` 文件夹。
3. 当前仓库已配置小程序 AppID（公开标识），但不包含 AppSecret。AppSecret 只能保存在受控的服务端环境，不能写进项目、小程序包或 GitHub。
4. 导入后先确认项目能编译。此阶段不会调用 `wx.login`，也不会模拟微信登录成功。

## 2. 切换到 CloudBase staging

在开发者工具左侧打开 `config/runtime-target.js`，把唯一的目标值从：

```js
module.exports = 'local';
```

改为：

```js
module.exports = 'cloudbase-staging';
```

保存并重新编译。该目标只会解析到 `config/runtime-profiles.js` 中的白名单配置，未知目标会直接报错；它被明确标记为 `cloudbase_staging`、`testOnly: true` 和匿名演示模式，不会冒充生产。

需要回到本机服务时，再把这一行改回 `local`。本机地址仍为 `http://localhost:3000`。

## 3. 仅在开发者工具临时关闭域名校验

1. 在开发者工具右上角进入“详情”。
2. 打开“本地设置”。
3. 开发联调期间勾选“不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”。不同版本的工具文字可能略有差异。
4. 重新编译，打开“动态、活动、Agents、我的”检查匿名演示数据是否能加载。

仓库中的 `project.config.json` 当前也保留 `urlCheck: false`，发布预检会持续拦截它。这个开关只适用于开发者工具临时调试，不能代表真机、体验版、审核版或正式版已经具备合法域名配置。

## 4. 当前联调身份与能力边界

- 小程序请求只发送 JSON 内容类型，不使用浏览器 cookie，也不发送 `x-demo-user` 等自定义身份头。
- 服务端在匿名测试环境中返回匿名演示默认身份和虚构数据；这不等于微信登录或真实会员鉴权。
- 当前不接真实支付、会员数据库、飞书、COS 或其他私有数据源。页面显示“待配置”的能力仍然是待配置，不能据此验收正式功能。
- 不要在匿名环境录入真实姓名、手机号、订单、报告或附件。

可在项目根目录运行 `npm run miniprogram:staging-check`，检查 HTTPS staging 地址、测试标记、本机配置保留情况，以及请求层没有 cookie、演示身份头或伪造登录。

## 5. 测试子域名不是正式生产 API

开发者工具和真机匿名验收可使用 `test-api.pennysclub.com`，并应在微信公众平台“小程序后台 → 开发 → 开发设置 → 服务器域名”中将它登记为 `request` 合法域名。绑定的免费 HTTPS 证书有效期至 2026-12-08，到期前需续期或替换并重新验证。

正式上线时仍需准备独立生产域名（例如 `api.pennysclub.com`），创建生产运行配置、关闭演示模式并通过 `npm run release:check`。不要为了绕过微信域名校验长期依赖开发者工具的“不校验合法域名”选项。
