# PostgreSQL migrations

- 按文件名前缀顺序运行，已应用版本及 SHA-256 写入 `venture_private.schema_migrations`。
- 迁移执行器持有事务级 advisory lock，并在任一错误时整体回滚。
- 已应用文件不可修改；修正必须新增更高版本的前向迁移。
- 当前迁移是新增型。回滚应用版本时保留表和数据；涉及删除列/表的破坏性 down migration 不自动提供，必须先备份、演练恢复并单独审批。
- `001_core_domains` 创建服务端私有事实域；`002_security` 撤销 PUBLIC 权限、启用 RLS、仅向既有 `venture_club_app` 角色授权，并将审计日志设为追加写。
- `003_cloudbase_gateway_read_views` 是前向迁移，只在 `public` 创建两张经过字段删减的只读视图；匿名和登录角色没有权限，CloudBase `service_role` 仅获得视图 SELECT。它不开放 CRM、付款、会员判定、报名、对象引用或审计事实。
- `004_wechat_identity_entitlement` 是待后续人工审核执行的前向迁移：私有域只保存带密钥的微信 subject 伪名，网关只获得最小会籍投影 SELECT。原始微信标识与 CRM/付款源记录不进入视图。未来按 `cloudbase-pg-console/wechat-identity-manifest.json` 依次人工执行 004、140 元数据记录、190 只读验证。
- 不要把 `venture_private` 加入 PostgREST 暴露列表。前端和小程序只能调用经过会籍门禁、RBAC 和字段白名单的 Node API；CloudBase 网关凭据只存在 Node 服务端。
- CloudBase PG 不使用标准私网直连角色时，空库控制台执行顺序与 `002` 安全执行变体见 `server/db/cloudbase-pg-console/manifest.json`。canonical `001/002/003` 校验和必须保持不变。
