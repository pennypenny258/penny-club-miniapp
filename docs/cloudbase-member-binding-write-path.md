# CloudBase 会员绑定受控写路径（离线准备）

## 官方能力结论

CloudBase PostgreSQL Data API 基于 PostgREST。官方文档明确支持：

- 表查询：`GET /v1/rdb/rest/:table`；
- 表插入/批量插入/upsert：`POST /v1/rdb/rest/:table`；
- 数据库函数：`POST /v1/rdb/rest/rpc/:function_name`；
- PG 模式用 JWT 映射 `anon`、`authenticated`、`service_role`。API Key 对应 `service_role`，具有 `BYPASSRLS`，严禁进入浏览器、小程序或普通响应。

官方参考：

- https://docs.cloudbase.net/http-api/pgdb/postgresql-restful-api
- https://docs.cloudbase.net/http-api/pgdb/insert-records
- https://docs.cloudbase.net/http-api/pgdb/rpc-call
- https://docs.cloudbase.net/authentication-v2/auth/auth-pg

## 为什么当前不直接写表

已应用的 004 只有私有 `external_identity_bindings` 表和公开的最小 entitlement 只读视图；008 提供后台会话/RBAC。它们没有 CRM 精确匹配、候选持久化、身份绑定幂等写入的数据库函数。

虽然官方 Data API 支持表 POST，但直接用 `service_role` 写私有表会绕过 RLS，且不能单次保证“候选状态检查 → 唯一冲突检查 → 幂等绑定 → 审计 → entitlement 重算”的事务边界。因此当前客户端明确 `directTableWrites=false`，没有任何表写 URL。

## 已实现的安全客户端

`cloudbase-member-binding-transport.js` 只接受一份经过部署后只读核验的能力清单。清单必须逐项证明：

- 五个逻辑操作各有独立、真实存在的 RPC；
- 仅 `service_role` 可执行，`PUBLIC`、`anon`、`authenticated` 均无执行权；
- identity binding 写入具备事务性和数据库侧唯一幂等键；
- 返回投影不含原始身份、手机号、CRM、付款或备注。

客户端不从环境变量接收 RPC 名称，避免运营者误填一个未部署函数。能力清单不存在、校验和不一致或任何权限证明缺失时拒绝构造。请求固定使用 HTTPS CloudBase gateway、POST、禁止重定向、超时与 64 KiB 响应上限，错误不回显 API Key、URL、请求正文或上游响应。

仓库现在包含未来 012 SQL 草案、五个绑定 RPC 和一个受控 token provisioning RPC，但它们**没有应用到 CloudBase**，也没有产生部署后能力清单。代码与测试只使用合成数据和 mock invoker，不连接 CloudBase。

## 最小凭据与当前开关

未来此路径只需要现有 CloudBase PG 服务端变量类别：环境 ID、上海区域、迁移基线、`server_runtime` 用途，以及一个 CloudBase **API Key（service_role）**。不需要数据库公网、`DATABASE_URL`、Publishable Key、用户 Access Token、腾讯云 SecretId/SecretKey 或 ExecutePGSql 管理凭据。

API Key 权限很高，必须只放 CloudBase 云托管服务端环境变量 `CLOUDBASE_PG_SERVER_API_KEY`，不得写 Git、前端、小程序、截图或聊天。当前不要创建或填写实际值。

以下开关必须继续保持：

```text
FORMAL_MEMBER_BINDING_ROUTES_ENABLED=false
CLOUDBASE_MEMBER_BINDING_WRITES_ENABLED=false
CLOUDBASE_MEMBER_BINDING_TRANSPORT=
CLOUDBASE_MEMBER_BINDING_CAPABILITY_SHA256=
CLOUDBASE_MEMBER_BINDING_RPC_MIGRATION_APPLIED=
CLOUDBASE_CRM_MATCH_TOKEN_WRITES_ENABLED=false
CLOUDBASE_CRM_MATCH_TOKEN_TRANSPORT=
CLOUDBASE_CRM_MATCH_TOKEN_CAPABILITY_SHA256=
```

## 将来启用前仍需完成

1. 在官方支持的隔离无敏感测试库人工执行未来 012，并用只读 890 核验六个 RPC、函数 ACL、PUBLIC/客户端角色拒绝、事务和幂等约束。当前不要执行。
2. 对 token provisioning 额外验证双人授权、active/previous key version、重放、冲突和脱敏响应；不得使用真实手机或 CRM。
3. 将核验后的函数名与证据固化为代码内能力清单，代码评审后配置其 SHA-256；函数名不能由环境变量临时输入。
4. 使用合成账号完成重复绑定、冲突、数据库故障、entitlement 失效和审计测试。
5. 最后才评估写 transport 开关；正式 HTTP 路由仍要单独、稍后开启。

当前 readiness 固定包含 `future012NotApplied`、`readonlyCapabilityManifestNotVerified` 和 `liveGatewayImplementationNotConfigured`，不能导入真实 CRM，也不能启用正式微信绑定。
