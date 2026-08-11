# CRM 精确匹配 token：受控生成与密钥轮换

## 当前能力边界

当前只完成离线合约和 mock 测试，未实施 CloudBase 写入仓库，未挂 HTTP 路由，也未生成或读取任何真实密钥。未来 012 包仍未应用；`CRM_MATCH_TOKEN_MIGRATION_APPLIED=012_member_binding_rpc_008_baseline` 只是未来启用前的显式校验类别，不是当前应该填写的变量。

受控服务只接受“已人工复核并物化的 CRM 记录”，并强制：

- 执行人具有 `member_import.materialize.execute`；独立复核人具有 `member_import.review`，两者不能是同一人。
- 手机号只在 Node 进程内短暂规范化，用 32 字节服务端 HMAC key 和域隔离字符生成 64 位 token；不返回、不记日志、不写入明文。
- 持久化合约只允许写 `member_binding_match_tokens`，输入仅有内部 member id、key version、token hash、CRM 记录版本哈希、审核授权和幂等哈希。不得更改 CRM、付款、会籍或公开名册。
- 小程序和浏览器不得调用该通道，不得获得 key version、token hash 或内部 member id。

## 轮换边界

未来仅在 CloudBase 云托管服务端设置下列变量类别，值不得写入 Git、聊天、截图或前端：

- `CRM_MATCH_TOKEN_ACTIVE_KEY_VERSION`
- `CRM_MATCH_TOKEN_ACTIVE_HMAC_KEY`
- `CRM_MATCH_TOKEN_PREVIOUS_KEY_VERSION` / `CRM_MATCH_TOKEN_PREVIOUS_HMAC_KEY`（轮换窗口期成对使用）

安全顺序是：新 key 作 active、旧 key 作 previous 进入双写窗口 → 用脱敏计数确认所有受控 CRM 行已生成新代 token → 首次绑定 tokenizer 切换到新 active 并验证唯一匹配 → 等待旧会话/批次窗口结束 → 撤销旧 key version 的 token → 最后移除 previous key。不得先删旧 key，也不得同时保留两个以上历史 key。

目前不要填写上述变量，不要执行 012，不要开启 `FORMAL_MEMBER_BINDING_ROUTES_ENABLED` 或 `CLOUDBASE_MEMBER_BINDING_WRITES_ENABLED`。下一个前置是设计并验证只接收上述脱敏投影的 CloudBase RPC/仓库，仍需先在无敏感环境验证。
