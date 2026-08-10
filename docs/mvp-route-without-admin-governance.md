# 001–008 基线上的 CRM + Agent MVP 路线

## 决定

009 管理员治理迁移及其 640/690 执行包立即延期。它提供首位系统管理员自举、双人角色授予/撤销和治理审计查询，属于正式治理增强，不是 CRM 与需求撮合 MVP 的业务前置。未获得 CloudBase 官方支持的可验证 DDL 执行路径前，不再让用户通过 SQL 编辑器重试 009，也不登记 `009_admin_governance`。

两个生产环境已经成功完成的 001–008 保持原样，不删除、不重跑、不回滚。生产服务继续处于 bootstrap 锁定态，不导入真实 CRM、不启用真实网关写入。

## 依赖结论

| 能力 | 已有最低基础 | 是否依赖 009 | 当前结论 |
| --- | --- | --- | --- |
| CRM Excel/XLSX 上传、字段映射、脱敏预检、冲突工作台 | 本地代码 | 否 | 可继续离线完善；仍为零写入演练 |
| 受控导入批次、行级复核、补偿/物化 | 006、007 | 否 | 数据结构已准备；正式路由仍需 008 会话与网关接线 |
| 正式后台会话和运营/审核/RBAC | 008 | 否 | 结构已准备；外部已验证身份和首位运营账号尚未安全配置 |
| CRM 主档 011 | 006–008 足以设计 | 当前执行包人为要求 009 | 现有 011/740 不得执行；需另做经官方通道验证的 MVP 前向包 |
| Agent 需求、申请、分发事实 | 001 | 否 | 可先做 004 会员身份门禁后的服务端仓库接线 |
| 微信 subject / 会籍只读门禁 | 004 | 否 | Agent 和会员读路径的正式前置 |
| 首位系统管理员自举、双人角色变更、治理审计 RPC | 009 | 是 | 全部延期，不进入 MVP |

## 下一阶段严格顺序

1. **冻结数据库**：把 001–008 作为当前生产 schema 基线；不执行 009、640、690、010、011、740 或 790。
2. **代码先行且离线验证**：CloudBase gateway 的最低已应用版本已从 009 收敛为 008；真实 runtime 启动锁仍保留，当前只提供经过 allowlist 的可注入仓库契约。数据库异常统一 503，绝不回退 memory demo。
3. **先接 Agent 最小域**：已增加 `demands`、`demand_applications`、`agent_dispatches` 的服务端契约，但尚未挂载正式 HTTP 路由。004 会籍门禁先于任何会员查询/提交；所有审核和分发先经过 008 正式后台会话的 `demand.review` 权限。模型保持关闭，不自动发布、不自动发送、不返回联系人。
4. **保留 CRM 本地演练**：用户可在本地后台继续做真实表的只读预检、映射、冲突修正和批次确认演练，但页面必须持续显示“未写入生产库”。
5. **重做 CRM MVP 前向包**：未来新包只依赖已确认的 006–008，优先使用表、RLS、最小服务端仓库，不包含 009 管理员治理 RPC；必须先在受支持的 CloudBase DMC、官方单语句执行方式或可复现 PostgreSQL 环境验证，不能再让用户试错。
6. **配置正式身份后再开放写入**：先完成微信/后台外部身份、008 会话存储和一个受控预置运营账号；再用脱敏小批次验收 CRM 写入、幂等、审计和补偿。任何一项缺失继续 fail closed。
7. **009 最后处理**：MVP 稳定后，再与 CloudBase 官方确认受支持的 migration/DDL 通道，单独设计和验证管理员治理增强。

## 当前必须保持关闭

```text
DEPLOYMENT_PROFILE=cloudbase_production_bootstrap
DATA_REPOSITORY=production_bootstrap_disabled
FORMAL_ADMIN_AUTH_ENABLED=false
FORMAL_AGENT_ROUTES_ENABLED=false
ADMIN_GOVERNANCE_ENABLED=false
GOVERNED_MEMBER_IMPORTS_ENABLED=false
GOVERNED_MATERIALIZATION_ENABLED=false
CLOUDBASE_CATALOG_READS_ENABLED=false
```

不要把 `CLOUDBASE_PG_MIGRATIONS_APPLIED` 虚报成 009，也不要执行现有 011/740 来绕过依赖。当前最有价值的开发任务是“008 基线的 Agent 仓库 + CRM MVP 新前向包设计”，不需要用户继续操作 SQL。

## 已完成的第一阶段代码边界

- `StagedAgentGatewayRepository` 只允许已命名的公开机会读取、需求待审入队、申请待审入队、人工审核记录和人工分发记录；不接受任意 URL、表名、SQL 或 RPC 名称。
- `AgentMvpService` 强制先调用 004 真实会员门禁，再允许机会读取、需求提交或对接申请；后台决定强制先调用 008 正式会话授权。
- `private_match` 不进入公开机会列表；所有返回固定为 `contactDisclosed: false`，申请同意前仍由运营代转。
- 仓库或身份服务异常时安全失败，不回显上游错误，不切换到 memory/local。
- 本阶段未启用正式路由、未启用 CloudBase、未运行 SQL，也没有 CRM 写方法。生产继续使用 `production_bootstrap_disabled`，直到正式身份、网关操作实现和逐路由验收全部完成。
- 正式 HTTP 命名空间现已挂载为 `/api/formal-agent/*`，但默认返回 `FORMAL_AGENT_ROUTES_DISABLED`，不会落入既有 `/api/opportunities` 等匿名演示路由。只有生产 `cloudbase_gateway`、迁移基线精确为 008、004 微信身份、`operator_confirmed_crm` 人工绑定模式与 008 后台会话均显式启用并完整注入服务后，进程才允许创建正式处理器。`wx.login` 不被当作昵称、微信号、群昵称、手机号或群成员状态来源。
- 五条正式路由分别对应：公开机会列表、需求待审提交、对接申请待审提交、后台人工审核、后台人工分发。没有 CRM 路由；未识别的正式路径直接 404，不会转交 demo handler。
