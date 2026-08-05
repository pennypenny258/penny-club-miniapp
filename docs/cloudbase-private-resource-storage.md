# CloudBase 私有资料存储与持久化目录：接入准备

当前状态仍是“代码、迁移和离线契约已准备，真实存储未启用”。本阶段没有连接 CloudBase，没有创建 Bucket，没有上传或读取任何文件，也没有新增真实业务路由。匿名 staging、本机导入 MVP 和未来真实持久化是三条明确隔离的路径。

## 官方能力与本项目选择

CloudBase 的 PG 模式云存储通过 HTTPS Storage API 提供 Bucket/Object、流式上传下载、签名 URL、对象元信息及分片能力；对象字节存放在对象存储后端，元数据位于 `storage` schema，并由 RLS 管理。`service_role` 会绕过 RLS，只能由服务端 API Key 使用：

- PG 云存储 HTTP API 概述：https://docs.cloudbase.net/http-api/storage-overview
- PG Storage API 与角色：https://docs.cloudbase.net/http-api/storage-pg/pg-storage-api
- 创建/上传对象：https://docs.cloudbase.net/http-api/storage-pg/%E5%88%9B%E5%BB%BA-%E4%B8%8A%E4%BC%A0%E5%AF%B9%E8%B1%A1
- PG 存储权限与 RLS：https://docs.cloudbase.net/storage/pg/data-permission
- Bucket 私有属性、大小与 MIME 白名单：https://docs.cloudbase.net/storage/pg/bucket
- CloudBase PostgreSQL RPC：https://docs.cloudbase.net/http-api/pgdb/rpc-call

这些接口使用 CloudBase HTTPS 网关，因此不要求购买标准版私有网络，也不需要开启数据库外网 IPv4。

本项目采用以下更保守边界：

- 浏览器和小程序只把文件发到 Node 后台；不获得 `service_role`、Storage 管理令牌、预签名上传地址或对象键。
- Node 完成扩展名、MIME、基础文件签名、单文件大小和文本注入检查后，才通过 PG Storage API 把字节写入固定私有 Bucket。
- 当前仍限制单文件 25MB，使用单次 binary body 上传。虽然官方提供分片能力，本阶段没有验证具体分片契约；超过 25MB 直接拒绝，不伪称已经支持分片。
- 下载使用 Node 代理字节流。会员端既不拿裸链接，也不拿短签名 URL；将来若因性能改用签名 URL，必须另做不超过 60 秒、一次性审计和撤销评审。
- 在线查看仍只有已发布标题、摘要和标签。PDF、Office、视频、音频没有安全预览/转码能力，固定显示“在线预览能力待配置”。

## 005 数据边界

`005_resource_private_storage.sql` 不修改已经执行的 001/CloudBase 002/003，也不修改尚待执行的 004：

- `resource_upload_intents`：记录期望 MIME、扩展名、大小、SHA-256、过期时间和安全失败码。
- `resource_files`：只保存加密对象定位符、带密钥引用哈希、完整性元数据、人工安全状态和预览状态；不保存原文件名、公开 URL、裸对象键或来源链接。
- `resource_review_records`：记录版权确认、人工/扫描安全状态、发布或拒绝决定、下载开关；预览仍固定未配置。
- `venture_resource_storage_compliance`：后台可见的安全合规状态，不含任何对象定位信息。
- `venture_resource_download_object`：仅供 Node `service_role` 在会籍和下载门禁之后读取加密定位符，绝不能序列化给客户端。
- 四个固定 RPC 负责“开始上传、完成上传、安全失败、审核发布”。CloudBase 官方文档提示 RPC 不能只依赖 `GRANT EXECUTE`；因此每个函数都会在函数体内校验 JWT role 必须为 `service_role`。

资料目录继续使用 003 的 `venture_resources_published`：只有 `status=published` 且 `rights_review_status=approved` 的安全元数据可见；附件定位符、内部来源和原文件名从不进入目录视图。

## 上传与下载顺序

上传成功必须完整经过：

1. 服务端管理员会话与 RBAC（目前尚未接入真实模式）。
2. 文件/元数据白名单验证与 SHA-256 计算。
3. 通过固定 RPC 持久化一个 30 分钟上传意图和 draft 资料。
4. Node 将字节写入固定私有 Bucket；对象键由年月和随机 UUID 生成，不含文件名、标题或用户信息。
5. Node 加密对象定位符，再通过固定 RPC 完成文件元数据提交。
6. 只有第 5 步成功才返回“已持久化、待审核”。失败时不会写入内存冒充成功；元数据提交失败会尝试删除刚上传对象并记录安全失败阶段。
7. 运营人工确认版权和文件安全后才可发布。`downloadEnabled` 只控制下载入口，不能开启预览能力。

下载顺序固定为：服务端验证会话 → 重新计算有效会籍 → 资料已发布 → 版权已批准 → `downloadEnabled=true` → 文件状态 ready → 解密对象定位符 → Node 代理流。任一步失败都不会请求对象存储；CloudBase/数据库故障返回安全 503，不回落本机目录或内存资料。

## 未来最短操作（现在不要执行）

现在只需要把代码推送到私有 GitHub；不要创建 API Key、不要配置云托管、不要上传真实文件。

等真实管理员会话、微信会员身份、持久撤销存储和接口集成测试完成后：

1. 在当前独立空测试库按 `server/db/cloudbase-pg-console/resource-storage-manifest.json` 审核并依次执行 004、140、190、005、250、260、290。若 004 已单独完成且 190 全 true，可从 005 开始。290 每一项都必须为 true。
2. `250_create_private_resource_bucket.sql` 会建立固定的 `venture-private-resources` 私有 Bucket、25MB 上限和 MIME 白名单；不需要在控制台另建公开 Bucket。不要把 `public` 改成 true。
3. 完成空 Bucket 与匿名/普通登录角色的拒绝访问测试后，才在 CloudBase 控制台创建/使用仅供 Node 的服务端 API Key。不要发送到聊天、截图或 GitHub。
4. 只在云托管服务端 Secret/环境变量配置：私有存储开关、固定 Bucket ID、`service_role` API Key、32 字节对象定位符加密密钥、`node_proxy` 下载模式、`metadata_only` 预览模式和迁移版本 005。
5. 先用匿名合成 PDF 做上传、重启后仍存在、待审核不可见、发布可搜索、禁止下载、允许下载、退群后拒绝、对象存储故障 503 和备份恢复演练。全部通过后才接真实资料。

这条路线不要求标准版私有网络；也绝不能用数据库外网 IPv4、公开 Bucket、客户端直连 PostgREST/Storage API 或长期下载链接替代门禁。
