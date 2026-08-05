# CloudBase 云托管测试环境部署

本指南只用于上海区域测试环境 `penny-club-staging` 的匿名演示。当前服务是内存型 Node MVP：重启、扩缩容或重新部署后，后台操作产生的数据会消失；容器本地文件也不持久、不跨实例共享。因此它不能承载真实会员、真实订单、飞书资料或任何私有附件。

## 部署前的安全边界

- GitHub 仓库必须设为私有。
- 只推送源代码与匿名演示数据。不要把 `.env.local`、任何 `.env`、飞书 Secret、微信/支付密钥、真实报表、真实附件或 `server/private-storage/` 推送到 GitHub。
- `Dockerfile` 只把浏览器服务需要的 `package.json`、`server/` 和 `templates/` 放入镜像；`.dockerignore` 再次排除了本地配置、运行数据和常见附件类型。
- 测试环境禁止配置 `PRIVATE_STORAGE_DIR`。容器本地磁盘不是正式私有存储，不能替代 COS。
- 真实上线前必须完成数据库、私有 COS、正式后台身份、字段加密、备份、监控和微信合法域名；`npm run release:check` 会继续阻止演示/HTTP/缺少生产基础设施的发布。

## 先创建私有 GitHub 仓库

1. 在 GitHub 新建一个 **Private** 空仓库，例如 `venture-club-miniapp`。不要选择自动添加 README、许可证或 `.gitignore`，避免第一次推送冲突。
2. 在本机项目中确认准备推送的内容至少包括：`Dockerfile`、`.dockerignore`、`package.json`、`server/`、`templates/`、`config/cloudbase-staging.env.example` 和本说明。原生小程序目录可以一并保存在仓库中，但不会被复制进服务镜像。
3. 推送前运行 `npm test` 与 `npm run staging:check`，并检查 Git 待提交列表中没有 `.env.local`、`server/private-storage/`、真实资料或附件。
4. 将当前项目推送到私有仓库的 `main` 分支。本项目不会自动初始化 Git、创建仓库或替你连接云账号。

## 在 CloudBase“新建 Git 平台部署”页填写

| 页面字段 | 建议值 |
| --- | --- |
| Git 平台/仓库 | 授权 GitHub 后选择刚创建的私有仓库 |
| 分支 | `main` |
| 服务名 | `penny-club-web` |
| 代码/构建目录 | 仓库根目录：`.`（页面允许留空并代表根目录时可留空） |
| 构建方式 | Dockerfile / 自动识别 Dockerfile |
| Dockerfile 路径 | `Dockerfile`（若已自动识别，不再填写自定义构建命令） |
| 服务端口/容器端口 | `3000` |
| 健康检查 | HTTP，路径 `/healthz`；如页面不要求，可使用镜像内置健康检查 |

服务名建议保持全小写并使用连字符。服务端读取平台注入的 `PORT`，没有注入时默认 3000；不要改成硬编码 80，也不要填写 9100。

## 首次测试环境变量

在 CloudBase 服务端环境变量界面逐项填写以下三个非敏感值：

```text
NODE_ENV=staging
DEPLOYMENT_PROFILE=cloudbase_staging_demo
DEMO_DATA_ONLY=true
```

端口已在服务设置中填写 3000 时，可以不另填 `PORT`；如页面明确要求环境变量，则填写 `PORT=3000`。完整模板见 `config/cloudbase-staging.env.example`。

首次部署不要填写 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`PRIVATE_STORAGE_DIR`、`DATABASE_URL`、微信密钥、支付密钥或其他真实系统凭据。测试配置在检测到本机私有目录或已知真实集成变量时会拒绝启动，避免误把本地能力当作云端持久能力。

## 验证

部署成功后只用匿名演示数据检查：

- `/healthz` 返回 `ok: true`，且 `anonymousDemoOnly: true`。
- `/member/` 能打开会员端浏览器演示。
- `/admin/` 能打开运营后台匿名演示。
- 不上传真实文件，不配置飞书，不录入真实会员或订单。

若 CloudBase 报“就绪探针连接失败”，先核对服务端口是否为 3000、构建目录是否为仓库根目录、容器日志中进程是否保持运行。不要通过把私钥写进仓库来排查。

## 从测试走向正式环境

正式接入顺序建议为：持久数据库与迁移 → 私有 COS 与短时授权 → 正式后台会话/RBAC → 字段加密、备份与监控 → 微信登录/合法域名 → 支付与飞书等外部能力。密钥只能通过云端密钥管理或服务端环境注入，不能进入前端、GitHub 或聊天记录。
