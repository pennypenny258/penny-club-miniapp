# 本机飞书配置与重启指南

## 先说明当前边界

本项目实际启动命令是 `node server/src/server.js`，`npm run dev` 只是该命令的别名。服务端会读取进程环境变量。现在也会在非生产环境启动时读取项目根目录的 `.env.local`；生产环境不会读取该文件，只能使用部署平台 Secret。

`.env.local` 已由 `.gitignore` 排除，加载器只接受以下四个变量，不打印值，并要求 macOS/Linux 文件权限为 `600`：

```text
FEISHU_APP_ID=
FEISHU_APP_SECRET=
PRIVATE_STORAGE_DIR=./server/private-storage
FEISHU_MAX_ATTACHMENT_BYTES=20971520
```

不要把真实值写入 `config/local.env.example`、代码、README、网页、聊天、截图或共享日志。

## 本机预览：5 步操作

1. 打开 Finder，进入 `/Users/zhuyun/Documents/自媒体/venture-club-miniapp`。
2. 双击 `configure-feishu-local.command`。系统会创建权限受限且不会提交的 `.env.local`，并用 TextEdit 打开。
3. 只在 `FEISHU_APP_ID=` 和 `FEISHU_APP_SECRET=` 的等号右侧填写自己的值。保留 `PRIVATE_STORAGE_DIR=./server/private-storage` 用于本机联调，保存并关闭文件。
4. 双击 `restart-preview.command`。它会依次运行现有的关闭与启动脚本；实际服务器仍由 `node server/src/server.js` 启动。
5. 打开 `http://localhost:3000/admin/`，进入“资料与导入 → 一次性飞书迁入”。页面应从“服务端未配置”变成“服务端已配置”；再点“测试连接”。不要把 Secret 填到后台页面。

如果 macOS 阻止首次打开 `.command` 文件，可在 Finder 中按住 Control 点击文件并选择“打开”。配置变更只有在后端进程重启后才生效。

## 卡住时先看哪一项

- “服务端已配置”表示当前运行的服务已经安全读到两项必填配置；后台只显示布尔状态，不显示值或长度。
- “连接成功”只表示应用身份可用。仍需把目标 Wiki/节点作为资源授予该应用只读访问；应用权限范围与具体知识库资源授权是两个前提。
- 若任务显示“目标 Wiki 授权失败 / 权限不足”，不需要重填 Secret。先在飞书侧补齐该 Wiki 的应用读权，再回到同一任务点击“运行一次性迁入”重试。
- 若配置文件安全检查都通过，但后台仍显示“服务端未配置”，说明浏览器连接的仍可能是旧进程；双击 `restart-preview.command`，刷新后台后再看状态。

后台的“测试连接”不会读取目标 Wiki 内容，只验证应用身份。实际 Wiki 读权只会在运行迁入任务时验证；失败时页面仅显示安全分类。

## 命令行等效操作（可选）

在项目目录中执行：

```bash
cp config/local.env.example .env.local
chmod 600 .env.local
```

编辑并保存 `.env.local` 后，使用：

```bash
./stop-preview.command
./start-preview.command
```

开发人员也可执行 `npm run dev`，但修改环境配置后必须先停止旧进程再启动。

## 本机存储不等于生产存储

`PRIVATE_STORAGE_DIR=./server/private-storage` 会把附件写入本机受忽略目录，适合验证连接、权限、目录读取和私有落盘边界，但它不是云端私有对象存储，也没有备份、跨实例共享、短时签名下载或灾难恢复。

更重要的是，当前会员、迁入任务、自有正文和审核状态仍保存在 Node 进程内存中，重启即恢复演示种子数据。因此本机联调不能作为最终一次性迁移成果，也不能直接当作生产系统。

## 部署平台需要什么

正式迁入前需要先选择一个能够满足实际访问区域和公司合规要求的部署方案，并完成：

- 可长期运行的 Node.js 18+ 服务；
- 平台 Secret/环境变量管理，在服务设置中的“环境变量”“Secrets”或“运行时配置”入口填写同名变量，保存后重新部署/重启；
- 持久化数据库，用于迁入任务、正文、审核状态和审计日志；
- 私有对象存储，用于附件私有桶、加密、访问签名、病毒/类型/大小检查、保留和删除；
- HTTPS 域名、备份恢复、监控和最小权限运维。

当前代码只有本地目录存储适配器，还没有接入具体云对象存储；`PRIVATE_STORAGE_PROVIDER` 目前只参与发布检查，不会自动创建对象存储连接。平台选定后仍需实现该平台/对象存储的适配器和数据库持久化，不能仅靠填写环境变量伪装完成。

由于国内可用性、备案、跨境访问、对象存储和预算取舍依赖用户选择，本指南不未经核验指定具体平台。当前唯一需要用户决定的关键点是：正式环境采用哪一个 Node 托管平台、数据库与私有对象存储组合。
