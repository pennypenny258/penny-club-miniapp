# 微信身份映射与会籍门禁：安全接入准备

当前状态是“边界和离线测试已准备，真实登录未上线”。代码没有新增可用的真实登录路由，没有连接 CloudBase 数据库，也没有把现有资料/活动 API 切到真实网关。匿名 staging 仍只能使用匿名演示数据。

代码已挂载独立的 `/api/formal-member-binding/*` HTTP 命名空间和小程序首次验证页，但 `FORMAL_MEMBER_BINDING_ROUTES_ENABLED=false`、小程序 `formalBindingEnabled=false`。因此当前本机、staging 和生产 bootstrap 都不会发起真实 `wx.login` / 手机号绑定请求。服务端关闭时固定返回 503，不会落入 demo 路由。

## 服务端信任顺序

1. 小程序将 `wx.login` 得到的一次性 `code` 交给 Node 服务；小程序永远不持有 AppSecret。
2. Node 通过微信官方 `code2Session` 交换 `code`。`session_key` 不进入会话、不写数据库、不记录日志。
3. `wx.login` / `code2Session` 只建立小程序域身份 subject；它不会返回可直接用于 CRM 的微信昵称、微信号、群昵称或群成员状态。即使上游/客户端夹带这些字段，服务端也必须忽略。
4. 手机号只允许在用户明确点击 `getPhoneNumber` 能力后，由 Node 使用一次性 code 向微信服务端验证；手机号不是登录默认返回值，也不是必须绑定条件。
5. 微信号、微信群昵称由会员主动填写或运营导入，只作为辅助匹配线索。个人微信群是否仍在大群没有可依赖的小程序 API，继续由 CRM 人工维护，并作为最终硬门禁。
6. Node 对外部 subject 做带服务端密钥、带 AppID 域隔离的 HMAC，只用 64 位伪名哈希和用户主动授权、服务端验证的手机号匹配 CRM；数据库不存原始 openid。
7. 正常路径在且仅在以下条件全部成立时自动写入绑定：手机号已由用户授权并经服务端验证、匹配结果恰好一个、CRM 账号有效、当前 `in_group`、会籍月份有效、字段完整无矛盾、无风险标记且 004 最小会籍投影可放行。该动作只写身份绑定并重算 entitlement，不修改 CRM 或会籍事实，也不直接签发会话；用户需重新登录。
8. 无匹配、多匹配、手机号缺失、CRM 缺项/矛盾、非在群、月份无效、账号停用、风险标记或重算不通过，全部进入人工复核队列。客户端不能提交内部 member ID，只能引用服务端生成的候选令牌。
9. CloudBase 后端网关只查询 `venture_member_access_entitlement`，返回内部会员 ID 和门禁必需字段；不返回 CRM/付款记录、原因码、群资料、手机号或联系人信息。
10. Node 重新计算账号、会籍窗口、CRM 核验、最近付款证据复核、CRM 中的当前在群状态和最终判定；任一项不满足即拒绝。
11. 通过后签发短期 AES-256-GCM 不透明会话。每个请求先验证会话及撤销状态，再重新查询会籍；网关异常统一 503，绝不回落匿名内存数据。

## 微信官方服务端供应器（代码已准备，运行时未启用）

Node 端现有两个固定白名单调用：

- `wx.login` 的一次性 code 仅由服务端提交到微信官方 `code2Session`；返回只保留 app-scoped OpenID，立即丢弃 `session_key`、UnionID 条件值以及任何夹带的资料字段。
- 用户明确点击 `getPhoneNumber` 后，小程序只提交一次性手机号 code。Node 先以 AppID/AppSecret 获取服务端 access token，再调用微信官方手机号接口；返回手机号只在进程内交给不可逆匹配令牌器，不返回浏览器、小程序或普通日志。

供应器固定 HTTPS origin、端点白名单、禁止重定向、默认 5 秒超时与 16 KiB 响应上限，并将 HTTP、超时、无效 JSON、微信错误码统一映射为不含 URL、AppSecret、access token、手机号或上游正文的安全错误。所有测试使用注入的假 `fetch`，不会访问微信网络。

当前没有把供应器注入正式路由。`WECHAT_LOGIN_ENABLED=false` 与 `FORMAL_MEMBER_BINDING_ROUTES_ENABLED=false` 必须继续保持，直到下面的仓储缺口全部完成。

## 已准备的正式 HTTP 与小程序流程（当前关闭）

- `POST /api/formal-member-binding/start`：接收一次性登录 code 和可选的用户主动手机号授权 code；拒绝客户端 member ID。
- `POST /api/formal-member-binding/session`：绑定完成后使用新的 `wx.login` code 换取短期不透明会话。
- `GET /api/formal-member-binding/admin/candidates`：008 已验证后台查看脱敏异常队列。
- `PATCH .../confirm` 与 `PATCH .../reject`：使用候选令牌、幂等键与 008 权限处理异常；不写 CRM。
- 小程序首次页只在未来 production profile 同时设置 `identityMode=formal_member_binding` 与 `formalBindingEnabled=true` 时进入。当前 local/staging 均为 false；未启用时页面明确提示且不会调用微信能力。

`x-demo-user` 和 cookie 只属于当前匿名演示机制。真实身份服务明确拒绝这两种来源，只接受服务端验证的 Bearer 会话。现有标准 API 尚未接线，避免混用演示和真实事实域。

## 新迁移（现在不要在云端执行）

`server/db/migrations/004_wechat_identity_entitlement.sql` 不修改已经执行的 `001/002/003`：

- `venture_private.external_identity_bindings` 只保存应用域哈希、subject 哈希、内部用户 ID、状态和审计时间；强制 RLS，拒绝 `PUBLIC`、`anon`、`authenticated`。
- `public.venture_member_access_entitlement` 仅授予 `service_role` SELECT，并排除原始身份、联系方式和源事实记录。
- `server/db/cloudbase-pg-console/140_record_wechat_identity_version.sql` 只在对象完整、校验和一致时记录 004 迁移元数据，不写业务行。
- `server/db/cloudbase-pg-console/190_verify_wechat_identity_readonly.sql` 只检查对象、RLS、PUBLIC 权限和迁移记录，不读业务行。

等受控身份绑定流程和持久化会话撤销存储设计完成后，再按 `wechat-identity-manifest.json` 在独立测试环境依次人工执行 004、140、190；190 任何结果不是全 true 都要停止。不能由运行时 `ExecutePGSql` 执行迁移。

## 004 / 008 最小仓储边界

当前已能离线验证的最小读取能力：

- 004：`CloudBaseGatewayRepository.resolveMemberEntitlement(subjectHash)` 只读 `venture_member_access_entitlement` 安全视图。
- 008：`CloudBaseAdminSessionRepository.resolveSession` 与 `reserveAction` 提供正式后台会话和人工复核授权边界。

离线代码现已提供可 mock 的固定操作 adapter 合约，按顺序执行：最小 CRM 精确匹配投影 → 持久化脱敏候选 → 幂等写入 identity binding → 重新读取 004 entitlement。重复确认使用稳定幂等哈希；绑定成功但 entitlement 读取失败时返回安全 503，重试不会重复绑定。该合约只接收 subject/match 哈希、候选 ID 和安全布尔投影，不接收或返回手机号、OpenID、姓名、付款、备注或 CRM 原始行。

但是，004/008 本身没有提供这些操作的 CloudBase 持久化端点，也没有会员会话持久撤销。当前 adapter 的 transport 只能注入/mock，没有真实 URL、RPC 或数据库实现。以后必须通过服务端专用、固定 allowlist 且经 CloudBase 官方路径验证的实现补齐；不能让小程序直连表、不能复用 demo 内存数据，也不能扩大为 CRM 通用写接口。

本阶段的 `inspectMemberIdentityIntegration` 会始终报告 `activated=false` 和 `liveGatewayImplementationNotConfigured`。即使全部离线合约已注入，也不会误称正式绑定可以上线。

CloudBase 官方受控写路径的研究结论、API Key 边界和“经部署验证的 RPC 能力清单”客户端见 `docs/cloudbase-member-binding-write-path.md`。当前不直接写表、不使用 ExecutePGSql 作为运行时通道，也没有提交或假设 004/008 中不存在的 RPC。

## CloudBase 生产变量（现在不要填写）

未来只在 CloudBase 云托管服务的服务端环境变量中配置：

- 非敏感：`WECHAT_MINIPROGRAM_APP_ID`、`WECHAT_API_TIMEOUT_MS=5000`、`WECHAT_API_MAX_RESPONSE_BYTES=16384`、`WECHAT_ACCESS_TOKEN_REFRESH_SKEW_SECONDS=120`、会话 issuer/audience/TTL。
- Secret：`WECHAT_MINIPROGRAM_APP_SECRET`、`WECHAT_IDENTITY_SUBJECT_HMAC_KEY`、`MEMBER_SESSION_ENCRYPTION_KEY`。Secret 只能在云托管控制台设置，不能进入 Git、构建参数、小程序、截图或聊天。
- 启用与依赖：`MEMBER_SESSION_REVOCATION_STORE=external_persistent`、`MEMBER_IDENTITY_PROVIDER=external_verified_session`、`MEMBER_BINDING_MODE=crm_exact_match_or_operator_review`。只有 004/008 验证、上述仓储缺口和全链路匿名验收完成后，才依次开启真实登录、正式绑定路由和正式小程序 profile。

配置解析器会在 production、CloudBase gateway、非 demo、密钥完整、32 字节 keyed-hash/session 密钥和受控网络参数全部满足前拒绝构造真实身份供应器；不会回落到本地或匿名模式。

## 将来的无敏感部署清单

现在不需要生成、填写或发送任何凭据。真正准备生产时，顺序如下：

1. 完成 004 代码评审、测试环境人工迁移和 190 验证。
2. 建立 `openid 哈希 + 用户授权手机号 → CRM 候选 → 唯一安全匹配自动绑定 / 异常人工复核` 的身份绑定/解绑与审计流程；不得把原始 openid 复制到普通表格。微信号、群昵称和群状态不能标记为“微信 API 已验证”。
3. 建立服务端持久化会话撤销存储，支持单会话撤销、账号停用和密钥轮换；内存存储不满足生产要求。
4. 到首次真实联调时，才在微信公众平台确认正式 AppID 并生成/查看 AppSecret。AppSecret 只由有权限管理员放入云托管服务端 Secret/环境变量，不能放进小程序、GitHub、Dockerfile、截图或聊天。
5. 在 CloudBase 云托管服务端配置变量类别：
   - 非敏感开关与标识：真实登录开关、外部已验证会话身份源、会话 issuer/audience/TTL、外部持久撤销存储标识。
   - 敏感值：微信 AppSecret、subject HMAC 32 字节密钥、会话加密 32 字节密钥、CloudBase 服务端 API Key。
   - 数据版本：`004_wechat_identity_entitlement`。
6. 用测试身份完成唯一匹配自动绑定、异常人工队列、会话签发/撤销/过期、退群、月份失效和网关故障演练。全部通过后，才把 `FORMAL_MEMBER_BINDING_ROUTES_ENABLED` 与小程序 production profile 逐项打开。

当前真实网关启动保护仍然存在；真实身份路由、登录防重放/限流、撤销存储和审计写入完成前不能解除。

## 官方依据

- 微信小程序登录流程：https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html
- 微信服务端 `code2Session`：https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
- 微信手机号快速验证组件（必须由用户触发）：https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html
- 微信头像昵称填写能力：https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/userProfile.html
- CloudBase PostgreSQL HTTP API：https://docs.cloudbase.net/http-api/pgdb/postgresql-restful-api
- CloudBase PostgreSQL 身份认证角色：https://docs.cloudbase.net/authentication-v2/auth/auth-pg
- CloudBase 服务端认证配置：https://docs.cloudbase.net/service/authentication
