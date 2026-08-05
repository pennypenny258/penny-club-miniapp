# CloudBase PG 空测试库首次迁移（非技术操作清单）

这份清单只适用于**全新的、没有业务表和真实资料的测试环境**。当前不要创建 API Key，不要填写云托管环境变量，不要开启数据库外网，也不要把密码、证书、Token、连接串、SQL 执行截图或任何真实资料发到聊天。

CloudBase 官方说明 PG 模式支持在“数据库 → SQL 编辑器”执行建表、RLS 与 GRANT；运行身份采用 `anon`、`authenticated`、`service_role`。本项目不用运行时 `ExecutePGSql`：

- 官方快速体验：https://docs.cloudbase.net/database/configuration/db/postgresql/quickstart
- PG 身份与权限模型：https://docs.cloudbase.net/authentication-v2/auth/auth-pg
- SQL 管理接口边界：https://docs.cloudbase.net/http-api/pgdb/exec-pgsql

## 执行前

1. 先在 GitHub Desktop 推送本次提交，确保 GitHub 中能看到 `server/db/cloudbase-pg-console/`。
2. 打开 CloudBase 控制台，确认顶部当前环境确实是那个**空的 PostgreSQL 测试环境**，不是未来生产环境。
3. 进入“数据库 → PostgreSQL → SQL 编辑器”（控制台名称可能显示为“数据库管理 → SQL 编辑器”）。
4. 如果控制台提供备份或恢复点，先创建一次空环境恢复点。没有该入口时，不要用非空环境试跑；这套脚本不提供自动删表回滚。
5. 先执行 `server/db/cloudbase-pg-console/000_preflight_readonly.sql`。正常结果必须是：schema 为 `false`、两个冲突数量为 `0`、迁移记录表为 `false`。任何一项不同都立即停止，不执行后续文件。

## 严格按顺序执行

每次只复制一个完整文件到 SQL 编辑器，确认成功后再进行下一步：

1. `server/db/migrations/001_core_domains.sql`
2. `server/db/cloudbase-pg-console/002_security_cloudbase_gateway.sql`
3. `server/db/migrations/003_cloudbase_gateway_read_views.sql`
4. `server/db/cloudbase-pg-console/040_record_versions.sql`
5. `server/db/cloudbase-pg-console/090_verify_readonly.sql`

最后一个文件是只读验证。返回的每一行都必须是 `passed=true`；它只检查表、RLS、授权、视图列、审计触发器和迁移版本，不读取任何业务行。

## 任一步报错时

- 立即停止，不要跳过，不要继续运行后面的文件。
- 不要自行执行 `DROP`、关闭 RLS、给 `anon/authenticated` 增加权限、改成 `PUBLIC`，也不要开启外网绕过问题。
- 只记录错误代码和出错文件名；不要发送控制台凭据、完整 Token、证书、连接串或包含真实数据的结果。
- 由于目标应为空测试环境，出现部分成功时优先保留现场供审查；确认无真实数据后，可由用户在控制台使用平台的环境重建/恢复能力重新开始。不要在不确定时手工清表。

## 迁移完成后仍然不要做什么

即使全部 `passed=true`，当前也不要创建 API Key、不要设置 `CLOUDBASE_PG_SERVER_API_KEY`，不要更新云托管服务。迁移成功只代表空库结构和权限已就绪，不代表微信身份、会员映射或生产 API 已上线。

下一阶段应先完成真实微信登录到内部会员记录的服务端映射与集成测试。只有门禁测试通过后，才在 CloudBase 控制台创建仅供 Node 后端的 API Key、以服务端环境变量注入，并将 `CLOUDBASE_CATALOG_READS_ENABLED` 从 `false` 改为 `true`。Key 不得进入 GitHub、Dockerfile、浏览器或小程序。
