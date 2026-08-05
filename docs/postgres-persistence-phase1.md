# PostgreSQL 持久化第一阶段：安全边界与迁移准备

当前阶段**没有连接或写入任何 CloudBase 数据库**，也没有把现有 Node API 宣称为已持久化。匿名 CloudBase staging 继续使用 `memory_demo`，容器重启后演示操作会丢失；这仍是预期行为。CloudBase PG 网关的第二阶段准备见 `cloudbase-postgres-gateway-phase2.md`。

## 为什么暂不直接切换

现有 MVP 的 API 直接操作同步内存集合。只添加连接串、但不把每个读写路径逐域改造成事务仓库，会产生“页面成功、实际没有持久化”或跨域权限泄漏。为此，第一阶段采用失效关闭：

- 未设置 `DATA_REPOSITORY` 时固定为 `memory_demo`。
- `NODE_ENV=production` 禁止使用 `memory_demo`。
- 提供 `DATABASE_URL` 但未显式选择 `postgres` 会拒绝启动，不会静默忽略。
- 选择 `postgres` 后必须同时通过生产模式、TLS、私有 schema、最小权限应用角色和迁移版本校验。
- 即使配置完整，第一阶段仍以 `POSTGRES_RUNTIME_PHASE1_NOT_ACTIVATED` 拒绝真实业务 API 启动；必须完成第二阶段逐域仓库接线和集成测试后才能解除。
- `cloudbase_staging_demo` / `DEMO_DATA_ONLY=true` 明确禁止数据库真实数据模式。

## 数据与访问边界

迁移只创建 `venture_private`，不在 `public` 建业务表。`002_security` 会撤销 `PUBLIC` 权限、启用 RLS、仅向预先创建的 `venture_club_app` 最小权限角色授权，并禁止应用角色更新或删除审计日志。它不向 PostgREST 的匿名/登录客户端角色授权。

CloudBase PG 模式支持 PostgREST 与表级 GRANT/RLS，但本项目的内部 CRM、付款证据、会籍判定、私有资源引用、RBAC 和审计必须经过 Node 服务端门禁。小程序或浏览器不得直连 `venture_private`，也不得把它加入 PostgREST 暴露 schema。

附件本体仍应进入私有对象存储；数据库只保存加密的不透明对象键。身份标识、付款原始信息、需求敏感详情、会议链接和来源定位符使用密文/受控引用字段；公开名册表只含经同意和审核的公开字段，不含联系方式。

## 迁移范围与回滚意识

`001_core_domains.sql` 覆盖用户内部引用、CRM、付款证据、会籍判定、公开名册、资料更新、在职核验元数据、资源与导入、活动报名、匿名需求/申请/Agent 分发、RBAC、幂等键和审计。`002_security.sql` 负责权限、RLS 和审计不可变边界。

执行器使用事务 advisory lock、迁移版本和 SHA-256；任一步失败会回滚。已执行文件不可修改，修正必须新增前向迁移。第一阶段不提供自动破坏性 down migration；应用回滚时先保留数据结构，涉及删除必须经过备份、恢复演练和审批。

## 配置变量类别（不要把实际值发到聊天或提交 Git）

未来生产云托管服务需要：

- `DATA_REPOSITORY=postgres`；
- `DATABASE_URL`：由 CloudBase 服务端安全注入的标准 PostgreSQL 连接信息；
- `DATABASE_SSL_MODE=verify-full`；
- `DATABASE_SCHEMA=venture_private`；
- `DATABASE_APP_ROLE=venture_club_app`：非所有者、非迁移角色的长期应用身份；
- `DATABASE_MIGRATIONS_APPLIED=002_security`；
- `DATABASE_POOL_MAX`、`DATABASE_STATEMENT_TIMEOUT_MS`。

模板见 `config/postgres.production.env.example`。迁移任务使用单独的 `config/postgres.migration.env.example`；迁移身份绝不能配置到长期云托管版本。

CloudBase 控制台当前具体提供内网连接、服务身份注入还是管理/PostgREST 接口，无法在无账号和无凭据条件下可靠确认。用户只需在控制台自行确认这些**类别**：数据库名、内网主机/端口或服务端连接方式、应用身份、迁移身份、TLS CA/验证要求、云托管与数据库网络可达性。不要复制实际值到聊天。

## 第二阶段前的最小操作

现在不需要在 `public` 创建表，也不要给小程序 PostgREST 权限。进入第二阶段时：

1. 在 CloudBase 控制台确认云托管与 PostgreSQL 的服务端私网/服务身份接入方式；优先同环境、同 VPC 或平台服务身份，不开启数据库公网访问。
2. 通过控制台受控 SQL 工具或同 VPC 一次性迁移任务，创建短时迁移身份和长期最小权限 `venture_club_app` 身份；凭据只进入平台密钥注入。
3. 先做空库备份/恢复点，在非生产副本运行迁移计划；`npm run db:migrations:plan` 只在本地列出版本和校验和，不连接数据库。
4. 第二阶段接入受维护的 PostgreSQL 驱动，并从一次性迁移任务调用 `runMigrations`；不要让 Web 服务启动时自动迁移。
5. 验证迁移版本、PUBLIC 无权限、RLS、应用权限与审计不可改，再逐域接线 API。
6. 集成测试通过后，才在新的生产服务版本填写应用变量并小流量验证；迁移凭据立即撤销。

如果需要腾讯云管理 API 凭据，不要创建长期个人密钥并粘贴到聊天。优先使用 CloudBase 控制台、平台服务身份或受控一次性任务；确需 API 时使用最小权限短时凭据，并由用户在腾讯云侧直接配置。
