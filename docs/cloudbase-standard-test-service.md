# 标准版环境内的匿名测试服务

目标：在标准版环境 `penny-club-prod` 内保留两个互相独立的云托管服务。

| 用途 | 服务名 | 数据与访问规则 |
| --- | --- | --- |
| 正式预备 | `penny-club-prod-api` | 继续保持 production bootstrap 锁定态；不能用于测试提交。 |
| 匿名联调 | `penny-club-test-api` | 仅匿名演示数据；允许小程序开发者工具测试需求提交、后台审核和分发。 |

两个服务使用同一份代码仓库，但环境变量不同；云托管服务并不会共享容器内存、测试数据或服务 URL。

## 一次性部署表单

在 `penny-club-prod` → 云函数/托管 → 服务管理 → 使用 Git 仓库部署中填写：

- GitHub 仓库：`pennypenny258/penny-club-miniapp`
- 分支：`main`
- 服务名：`penny-club-test-api`
- 构建目录：仓库根目录（`.` 或留空）
- 构建方式：Dockerfile 自动识别
- 容器端口：`3000`
- 自动部署：可开启，只影响这个测试服务
- 公网访问：开启

环境变量使用“配置文件输入”时，粘贴：

```json
{
  "NODE_ENV": "staging",
  "DEPLOYMENT_PROFILE": "cloudbase_staging_demo",
  "DEMO_DATA_ONLY": "true",
  "DATA_REPOSITORY": "memory_demo",
  "PORT": "3000"
}
```

不要在测试服务填写微信 AppSecret、CloudBase PG API Key、COS 密钥、数据库 URL、飞书 Secret 或任何真实 CRM 数据。

## 验收与小程序联调

部署成功后，先访问 `https://<测试服务域名>/healthz`。正确结果必须包含：

- `deploymentProfile: "cloudbase_staging_demo"`
- `anonymousDemoOnly: true`
- `businessApisEnabled: true`

再访问 `/member/` 和 `/admin/`，应为匿名演示页面。

最后将 `miniprogram/config/runtime-profiles.js` 中 `cloudbase-staging.apiBase` 替换成该测试服务的 HTTPS 根域名；保留 `runtime-target.js` 的 `cloudbase-staging`。开发者工具保存后点“普通编译”。这只用于开发者工具，不可用于体验版或正式发布。

如果 healthz 是 production bootstrap、503、或任何非匿名演示状态，停止测试，不修改正式服务，先核对服务名与以上五项变量。
