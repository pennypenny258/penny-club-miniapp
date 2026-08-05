# 微信身份映射与会籍门禁：安全接入准备

当前状态是“边界和离线测试已准备，真实登录未上线”。代码没有新增可用的真实登录路由，没有连接 CloudBase 数据库，也没有把现有资料/活动 API 切到真实网关。匿名 staging 仍只能使用匿名演示数据。

## 服务端信任顺序

1. 小程序将 `wx.login` 得到的一次性 `code` 交给 Node 服务；小程序永远不持有 AppSecret。
2. Node 通过微信官方 `code2Session` 交换 `code`。`session_key` 不进入会话、不写数据库、不记录日志。
3. Node 对外部 subject 做带服务端密钥、带 AppID 域隔离的 HMAC，只用 64 位伪名哈希查询绑定。数据库不存原始微信标识。
4. CloudBase 后端网关只查询 `venture_member_access_entitlement`，返回内部会员 ID 和门禁必需字段；不返回 CRM/付款记录、原因码、群资料、手机号或联系人信息。
5. Node 重新计算账号、会籍窗口、CRM 核验、最近付款证据复核、当前在群和最终判定；任一项不满足即拒绝。
6. 通过后签发短期 AES-256-GCM 不透明会话。每个请求先验证会话及撤销状态，再重新查询会籍；网关异常统一 503，绝不回落匿名内存数据。

`x-demo-user` 和 cookie 只属于当前匿名演示机制。真实身份服务明确拒绝这两种来源，只接受服务端验证的 Bearer 会话。现有标准 API 尚未接线，避免混用演示和真实事实域。

## 新迁移（现在不要在云端执行）

`server/db/migrations/004_wechat_identity_entitlement.sql` 不修改已经执行的 `001/002/003`：

- `venture_private.external_identity_bindings` 只保存应用域哈希、subject 哈希、内部用户 ID、状态和审计时间；强制 RLS，拒绝 `PUBLIC`、`anon`、`authenticated`。
- `public.venture_member_access_entitlement` 仅授予 `service_role` SELECT，并排除原始身份、联系方式和源事实记录。
- `server/db/cloudbase-pg-console/140_record_wechat_identity_version.sql` 只在对象完整、校验和一致时记录 004 迁移元数据，不写业务行。
- `server/db/cloudbase-pg-console/190_verify_wechat_identity_readonly.sql` 只检查对象、RLS、PUBLIC 权限和迁移记录，不读业务行。

等受控身份绑定流程和持久化会话撤销存储设计完成后，再按 `wechat-identity-manifest.json` 在独立测试环境依次人工执行 004、140、190；190 任何结果不是全 true 都要停止。不能由运行时 `ExecutePGSql` 执行迁移。

## 将来的无敏感部署清单

现在不需要生成、填写或发送任何凭据。真正准备生产时，顺序如下：

1. 完成 004 代码评审、测试环境人工迁移和 190 验证。
2. 建立管理员受控的身份绑定/解绑与审计流程；不得把原始 openid 复制到普通表格。
3. 建立服务端持久化会话撤销存储，支持单会话撤销、账号停用和密钥轮换；内存存储不满足生产要求。
4. 到首次真实联调时，才在微信公众平台确认正式 AppID 并生成/查看 AppSecret。AppSecret 只由有权限管理员放入云托管服务端 Secret/环境变量，不能放进小程序、GitHub、Dockerfile、截图或聊天。
5. 在 CloudBase 云托管服务端配置变量类别：
   - 非敏感开关与标识：真实登录开关、外部已验证会话身份源、会话 issuer/audience/TTL、外部持久撤销存储标识。
   - 敏感值：微信 AppSecret、subject HMAC 32 字节密钥、会话加密 32 字节密钥、CloudBase 服务端 API Key。
   - 数据版本：`004_wechat_identity_entitlement`。
6. 用测试身份完成绑定、撤销、过期、退群、付款复核失效和网关故障演练。全部通过后，才新增真实登录端点并逐域接资料/活动目录。

当前真实网关启动保护仍然存在；真实身份路由、登录防重放/限流、撤销存储和审计写入完成前不能解除。

## 官方依据

- 微信小程序登录流程：https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html
- 微信服务端 `code2Session`：https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
- CloudBase PostgreSQL HTTP API：https://docs.cloudbase.net/http-api/pgdb/postgresql-restful-api
- CloudBase PostgreSQL 身份认证角色：https://docs.cloudbase.net/authentication-v2/auth/auth-pg
- CloudBase 服务端认证配置：https://docs.cloudbase.net/service/authentication
