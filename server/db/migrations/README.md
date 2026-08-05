# PostgreSQL migrations

- 按文件名前缀顺序运行，已应用版本及 SHA-256 写入 `venture_private.schema_migrations`。
- 迁移执行器持有事务级 advisory lock，并在任一错误时整体回滚。
- 已应用文件不可修改；修正必须新增更高版本的前向迁移。
- 当前迁移是新增型。回滚应用版本时保留表和数据；涉及删除列/表的破坏性 down migration 不自动提供，必须先备份、演练恢复并单独审批。
- `001_core_domains` 创建服务端私有事实域；`002_security` 撤销 PUBLIC 权限、启用 RLS、仅向既有 `venture_club_app` 角色授权，并将审计日志设为追加写。
- 不要把此 schema 加入 PostgREST 暴露列表。前端和小程序只能调用经过会籍门禁、RBAC 和字段白名单的 Node API。
