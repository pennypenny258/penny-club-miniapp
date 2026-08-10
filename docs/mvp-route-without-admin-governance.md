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
2. **代码先行且离线验证**：把 CloudBase gateway 的最低已应用版本从 009 收敛为 008，但只开放经过 allowlist 的 MVP 仓库；数据库异常必须 503，绝不回退 memory demo。
3. **先接 Agent 最小域**：仅接 `demands`、`demand_applications`、`agent_dispatches` 的服务端投影；004 会籍门禁先于查询，所有发布和定向发送仍由 008 已验证后台会话人工确认。模型保持关闭，联系人不直接返回。
4. **保留 CRM 本地演练**：用户可在本地后台继续做真实表的只读预检、映射、冲突修正和批次确认演练，但页面必须持续显示“未写入生产库”。
5. **重做 CRM MVP 前向包**：未来新包只依赖已确认的 006–008，优先使用表、RLS、最小服务端仓库，不包含 009 管理员治理 RPC；必须先在受支持的 CloudBase DMC、官方单语句执行方式或可复现 PostgreSQL 环境验证，不能再让用户试错。
6. **配置正式身份后再开放写入**：先完成微信/后台外部身份、008 会话存储和一个受控预置运营账号；再用脱敏小批次验收 CRM 写入、幂等、审计和补偿。任何一项缺失继续 fail closed。
7. **009 最后处理**：MVP 稳定后，再与 CloudBase 官方确认受支持的 migration/DDL 通道，单独设计和验证管理员治理增强。

## 当前必须保持关闭

```text
DEPLOYMENT_PROFILE=cloudbase_production_bootstrap
DATA_REPOSITORY=production_bootstrap_disabled
FORMAL_ADMIN_AUTH_ENABLED=false
ADMIN_GOVERNANCE_ENABLED=false
GOVERNED_MEMBER_IMPORTS_ENABLED=false
GOVERNED_MATERIALIZATION_ENABLED=false
CLOUDBASE_CATALOG_READS_ENABLED=false
```

不要把 `CLOUDBASE_PG_MIGRATIONS_APPLIED` 虚报成 009，也不要执行现有 011/740 来绕过依赖。当前最有价值的开发任务是“008 基线的 Agent 仓库 + CRM MVP 新前向包设计”，不需要用户继续操作 SQL。
