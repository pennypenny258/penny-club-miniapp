# PostgreSQL migrations

- 按文件名前缀顺序运行，已应用版本及 SHA-256 写入 `venture_private.schema_migrations`。
- 迁移执行器持有事务级 advisory lock，并在任一错误时整体回滚。
- 已应用文件不可修改；修正必须新增更高版本的前向迁移。
- 当前迁移是新增型。回滚应用版本时保留表和数据；涉及删除列/表的破坏性 down migration 不自动提供，必须先备份、演练恢复并单独审批。
- `001_core_domains` 创建服务端私有事实域；`002_security` 撤销 PUBLIC 权限、启用 RLS、仅向既有 `venture_club_app` 角色授权，并将审计日志设为追加写。
- `003_cloudbase_gateway_read_views` 是前向迁移，只在 `public` 创建两张经过字段删减的只读视图；匿名和登录角色没有权限，CloudBase `service_role` 仅获得视图 SELECT。它不开放 CRM、付款、会员判定、报名、对象引用或审计事实。
- `004_wechat_identity_entitlement` 是待后续人工审核执行的前向迁移：私有域只保存带密钥的微信 subject 伪名，网关只获得最小会籍投影 SELECT。原始微信标识与 CRM/付款源记录不进入视图。未来按 `cloudbase-pg-console/wechat-identity-manifest.json` 依次人工执行 004、140 元数据记录、190 只读验证。
- `005_resource_private_storage` 为资料上传意图、加密对象引用、人工审核和固定服务端 RPC 建立持久化边界；不保存原文件名、裸对象键或公开 URL。CloudBase 专用私有 Bucket 与最终验证按 `cloudbase-pg-console/resource-storage-manifest.json` 执行，当前匿名 staging 不执行。
- `006_governed_member_import` 为 CRM、付款证据、自愿名册分别建立私有批次、加密行载荷、候选匹配、人工复核和会籍重算队列；它不把任何域自动同步到公开名册，也不启用真实后台/API。未来只按 `cloudbase-pg-console/governed-import-manifest.json` 人工执行。
- `007_governed_materialization` 为匹配复核后的 CRM、付款、名册建立职责分离、幂等事务、显式补偿和脱敏审计；名册先隐藏物化，只有独立审批才可见。它仍不启用真实后台/API，未来只按 `cloudbase-pg-console/materialization-manifest.json` 人工执行。
- `008_admin_session_rbac` 准备正式后台的外部身份哈希绑定、随机 Bearer 会话、服务端 RBAC、近期再认证与高风险操作幂等授权。它不创建身份绑定、不分配角色、不接浏览器路由，未来只按 `cloudbase-pg-console/admin-auth-manifest.json` 人工执行。
- `009_admin_governance` 准备默认空的一次性首位系统管理员引导、双人角色授予/撤销、撤销后的会话与未用授权即时失效，以及固定白名单脱敏审计查询。它不预置管理员、不启用路由，未来只按 `cloudbase-pg-console/admin-governance-manifest.json` 人工执行。
- `010_split_resource_sections` 是尚未执行的前向兼容迁移：明确的行业报告映射为“研究报告”，明确的群聊整理映射为“群聊精华”；无法凭既有类型判断的旧合并项会回到待分类草稿、关闭下载且清空发布时间，不会继续对会员公开。运行前仍需单独审核 CloudBase Console 执行包。
- 不要把 `venture_private` 加入 PostgREST 暴露列表。前端和小程序只能调用经过会籍门禁、RBAC 和字段白名单的 Node API；CloudBase 网关凭据只存在 Node 服务端。
- CloudBase PG 不使用标准私网直连角色时，空库控制台执行顺序与 `002` 安全执行变体见 `server/db/cloudbase-pg-console/manifest.json`。canonical `001/002/003` 校验和必须保持不变。
