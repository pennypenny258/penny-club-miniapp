# 会员首次绑定 RPC 未来包（004/008 基线）

## 当前状态

这一包是未来前向迁移规范，**当前 CloudBase 数据库不具备这些表和 RPC**。它不在自动 migration runner 中，本轮没有连接或执行 SQL。`FORMAL_MEMBER_BINDING_ROUTES_ENABLED=false` 和 `CLOUDBASE_MEMBER_BINDING_WRITES_ENABLED=false` 必须继续保持。

依赖只锁定到已记录的 canonical 004 和 008；不修改它们，也不依赖已延期的 009–011。这一包仍需在 CloudBase 支持的 SQL 执行通道中完成一次无敏感测试，不要直接粘贴到生产环境。

## 五个最小 RPC

1. `venture_member_binding_resolve_exact_match(jsonb)`：只用经服务端 HMAC 后的 App 范围、OpenID subject 和用户明确授权的手机匹配 token，返回脱敏会籍投影和短时不透明 match id。
2. `venture_member_binding_persist_candidate(jsonb)`：将无匹配、多匹配、冲突或唯一匹配的脱敏状态持久为候选；不写 CRM。
3. `venture_member_binding_list_pending(jsonb)`：返回人工待处理的脱敏队列；Node 必须先完成 008 后台会话与权限门禁。
4. `venture_member_binding_bind_and_recompute(jsonb)`：在一个事务内幂等写入 004 identity binding；自动路径必须唯一手机匹配且账号、CRM、大群、月份、最终判定都通过，异常路径必须消耗 008 短时操作授权。RPC 不改会籍事实，只要求 Node 随后重读 004 entitlement view，因此不会伪称“已重算 CRM”。
5. `venture_member_binding_reject_candidate(jsonb)`：使用 008 `member_import.review` 短时授权驳回，写入脱敏审计，幂等且不更改 CRM。

所有 RPC 都是 `SECURITY DEFINER`，固定 `search_path`，函数内再核对 `service_role`；表强制 RLS，PUBLIC/anon/authenticated 无表权限且无 RPC 执行权。浏览器和小程序不得获得 API Key、subject 原值、手机号或内部 member id。

## 严格离线检查

现在只运行：

```bash
npm run db:cloudbase-member-binding-rpc:check
npm test
npm run staging:check
```

未来执行前必须同时满足：

- 用官方支持、能显示完整 PostgreSQL 错误与事务结果的 SQL 通道，先在无敏感环境验证；不再用未经验证的 ExecutePGSql 包装器反复试错。
- 先核对 004/008 migration version 与 checksum，备份并记录回滚边界；任何一项不符立即停止。
- 执行 012 后先运行目录中的只读 890，所有项必须为 `true`，再记录版本并重跑 890。
- 用匿名 fixture 验证：无匹配、多匹配、过期/退群、唯一有效匹配、幂等重放、授权过期、网关失败；数据库错误必须返回脱敏 503，不得回退内存。
- 为 CRM 导入另行建立 `member_binding_match_tokens` 的受控生成通道。本包故意不提供第六个“任意写 token” RPC；在该通道完成前，精确匹配无法上线。
- 上述能力证据经只读验收签名后，才能生成 `member-binding-rpc-v1` manifest checksum、注入 server-only API Key，最后分别打开写入与正式路由。

任何时候都不应将 API Key、AppSecret、手机、OpenID、CRM 原表或执行结果粘贴到聊天、浏览器或小程序。
