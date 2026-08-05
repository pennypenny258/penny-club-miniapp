# CloudBase PostgreSQL 后端网关：第二阶段安全准备

本阶段只完成离线契约、配置预检、两张只读视图和模拟测试。它**没有连接或写入 CloudBase**，也没有把任何业务 API 切到真实数据。当前 `cloudbase_staging_demo` 必须继续匿名演示；任何 CloudBase PG 变量或凭据都会被 staging 预检拒绝。

## 官方能力与本项目边界

CloudBase PostgreSQL Data API 基于 PostgREST，请求格式为 `https://{envId}.api.tcloudbasegateway.com/v1/rdb/rest/{table}`，使用 `Authorization: Bearer <token>`。官方说明 API Key 对应 `service_role`，仅供服务端使用且会绕过 RLS，绝不能进入浏览器、小程序或 App：

- PostgreSQL HTTP API：https://docs.cloudbase.net/http-api/pgdb/postgresql-restful-api
- PG 身份认证与三角色：https://docs.cloudbase.net/authentication-v2/auth/auth-pg
- AccessToken / API Key：https://docs.cloudbase.net/http-api/basic/access-token

因此本项目不让前端直连 PostgREST。Node 服务继续完成管理员 RBAC、会员有效性、资料发布状态、下载权限、敏感字段删减和审计；网关层只是可替换的数据仓库传输。

`ExecutePGSql` 或管理员 SQL API 不属于运行时仓库。它只能作为审批后的迁移/管理通道，不能接受业务请求、不能由浏览器调用，也不能把管理员 Token 配到长期 Web 服务。官方接口说明：https://docs.cloudbase.net/http-api/pgdb/exec-pgsql

## 已实现的失效关闭边界

- `DATA_REPOSITORY=cloudbase_gateway` 必须被显式选择；缺任一变量即拒绝启动，不会降级到 `memory_demo`。
- 仅允许上海国内网关域名，由经过格式验证的环境 ID 派生，不接受任意 URL，避免把服务端凭据发送到错误主机。
- 传输层只允许 `GET` 两个固定视图：`venture_resources_published`、`venture_activities_public`；调用方不能传任意表名、路径或 SQL。
- 固定字段白名单、最多 100 条、超时、最大响应体、禁止重定向；错误不回显网关响应体或凭据。
- `003_cloudbase_gateway_read_views.sql` 只暴露已发布且版权审核通过的资料元数据，以及不含会议链接的活动元数据。它撤销 `PUBLIC`、`anon`、`authenticated` 权限，只给 `service_role` 视图 SELECT。
- `venture_private` 仍不暴露；CRM、付款、会籍判定、注册、私有对象键、来源引用、会议链接和审计日志均不在视图中。
- `assertRuntimeRepositoryReady` 仍以 `CLOUDBASE_GATEWAY_RUNTIME_NOT_ACTIVATED` 阻断真实启动；在逐域 API 契约和集成测试完成前不能解除。
- `GatewayCatalogReadService` 已定义资料目录和活动目录的独立只读契约，但没有接入现有 `/api/resources`、`/api/activities`。它要求真实服务端身份解析、会籍有效检查和显式功能开关，并保证门禁在网关请求之前执行；上游失败统一返回安全 503，不回落演示内存。

## 未来服务端变量类别

空模板位于 `config/cloudbase-postgres-gateway.production.env.example`。目前不要填写任何实际值。

- `DATA_REPOSITORY=cloudbase_gateway`
- `CLOUDBASE_PG_ENV_ID`：环境标识；只在云托管服务端设置。
- `CLOUDBASE_PG_REGION=ap-shanghai`
- `CLOUDBASE_PG_MIGRATIONS_APPLIED=003_cloudbase_gateway_read_views`
- `CLOUDBASE_PG_CREDENTIAL_PURPOSE=server_runtime`
- `CLOUDBASE_PG_SERVER_API_KEY`：敏感的后端 API Key。
- `CLOUDBASE_PG_TIMEOUT_MS`、`CLOUDBASE_PG_MAX_RESPONSE_BYTES`：出站限制。
- `CLOUDBASE_CATALOG_READS_ENABLED=false`：真实微信身份映射完成前必须保持关闭。
- `MEMBER_IDENTITY_PROVIDER`：未来只能使用经验证的服务端会话身份源，不能使用演示请求头。

不要同时设置 `DATABASE_URL`；这会被拒绝，避免同一事实域混用直连与网关。

## 将来用户只需做什么

目前无需操作。准备真实生产环境且代码完成逐域接线后：

1. 先按 `cloudbase-pg-empty-database-migration.md` 在独立空测试环境完成迁移和只读验证。已应用迁移不可修改。
2. 在 CloudBase 控制台“环境配置 → API Key 管理”创建一个仅供 Node 后端的 API Key。官方角色模型下它是 `service_role`，权限很强，当前没有更窄的服务端数据库角色 Token；必须限制在云托管服务端环境变量、限制控制台访问人员，并制定轮换/吊销流程。
3. 只在云托管新生产版本的服务端环境变量中填写上述类别。不要放入 GitHub、Dockerfile、浏览器、小程序、日志、截图或聊天。
4. 先用匿名数据/空库做契约测试，验证 `anon` 和 `authenticated` 无法访问两个视图、Node 未登录/非会员/RBAC 拒绝仍有效、响应没有敏感列。
5. 只有完整集成测试通过后，才逐域解除启动阻断。首批建议只接资料与活动公开读取；写入、CRM、付款、会员判定和文件对象继续保持禁用，避免混合事实源。

如果无法接受长期 `service_role` API Key 的权限范围，应停止该路线，不开启数据库外网；改用单独的后端服务/云函数封装更窄的操作，再为 Node 建立受控服务身份契约。
