# 页面与接口拆分

## 微信小程序

| 页面 | 主要能力 |
|---|---|
| 动态（默认 Tab） | 安全搜索、活动/资料/公开机会时间线、收藏与活动登记 |
| 资料库（Tab） | 五个移动分栏、权限受控列表、运营下载开关 |
| Agents（Tab） | 投资/融资/并购/招聘/招商匿名机会、文本匹配请求、申请对接；语音明确待配置 |
| 我的（Tab） | 演示登录占位、会籍、本人续费报价、内部档案、公开资料审核、在职核验、需求通知、收藏与退出 |
| 活动（动态内进入） | 报名、会前限时查看会议链接、会后资料 |
| 我的公开名册 | 编辑公开字段、可见性、提交审核、查看更新状态 |
| 在职验证 | 选择名片图片/PDF、提交内部 CRM 核验、查看流程状态 |

## 运营后台

一级导航收敛为工作台、会员、资料与导入、活动、需求与撮合、设置与审计六个模块；具体队列通过模块内二级视图和全局待办进入。能力仍包括会员双状态与内部 CRM、公开名册与资料更新、在职核验、付款证据、最终会籍、续费、知识迁移与导入、活动报名通知与回放、需求审核与撮合、审计和发布检查。完整映射见 `admin-information-architecture.md`。

## MVP API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/me` | 当前身份与会籍 |
| GET | `/api/member-capabilities` | 微信登录/支付、录音/ASR、私有下载的安全配置状态 |
| GET | `/api/feed` | 仅聚合安全可见的动态、活动、已发布资料和公开机会；支持 `query` |
| GET | `/api/resources` | 有权限的知识库 |
| POST | `/api/resources/:id/download` | 下载开关及会籍校验；未配置私有存储时不返回定位符 |
| GET/POST/DELETE | `/api/favorites` | 当前会员的资料与活动收藏 |
| GET | `/api/opportunities` | 已人工审核的匿名公开机会 |
| POST | `/api/agent-match-requests` | 创建文本匹配请求，进入人工审核，不返回私密匹配 |
| POST | `/api/agent-voice-sessions` | 语音上传/ASR 安全边界；未配置时明确失败 |
| GET | `/api/members` | 无联系方式的有效会员名册 |
| POST | `/api/member-connections` | 申请会员对接 |
| GET | `/api/activities` | 活动列表 |
| POST | `/api/activities/:id/register` | 报名 |
| GET | `/api/activities/:id/meeting-link` | 服务端门禁后返回特邀链接 |
| GET | `/api/demands` | 已发布匿名需求 |
| POST | `/api/demands/:id/apply` | 申请对接 |
| GET | `/api/admin/dashboard` | 后台总览（演示管理员） |
| GET | `/api/admin/session` | 当前后台角色、权限说明及演示认证状态；不返回凭据 |
| GET | `/api/admin/operations-readiness` | 上线准备矩阵与演示/生产环境边界 |
| GET | `/api/admin/:collection` | 后台资源列表 |
| PATCH | `/api/admin/members/:id/group-status` | 更新群内状态并记录审计 |
| PATCH | `/api/admin/crm-verifications/:id` | 运营维护内部 CRM 核验/到期日/群状态并重新生成会籍判定；不修改公开名册 |
| POST | `/api/admin/payment-evidence/manual` | 受控人工补录付款证据；不接受手机号、订单号或付款凭据 |
| PATCH | `/api/admin/payment-evidence/:id/review` | 复核有效/退款/排除；不单独改变会籍 |
| PATCH | `/api/admin/renewal-offers/:id` | 维护标准价、专属价、优惠理由和适用规则 |
| GET | `/api/admin/import-templates/*.{xlsx,csv}` | 下载 CRM、自愿公开名册、微信小店、商户号小票和手动转账 Excel / CSV 模板 |
| GET | `/api/admin/local-imports` | 电脑导入能力、批次和安全审核元数据；不返回文件名、路径或存储键 |
| POST | `/api/admin/local-imports/upload` | 多文件白名单上传并私有保存；全部默认待审核 |
| POST | `/api/admin/local-imports/metadata` | 创建无文件受控资料条目，下载固定关闭并进入待补附件队列 |
| PATCH | `/api/admin/local-import-items/:id` | 修改标题、五分栏、来源说明、下载开关和分类确认状态 |
| POST | `/api/admin/local-import-items/:id/review` | 人工确认版权/安全后发布，或跳过条目 |
| GET | `/api/admin/feishu-connection/status` | 仅返回未配置/已配置/连接成功/连接失败及安全错误分类 |
| GET | `/api/admin/feishu-migration-readiness` | 返回迁入前安全检查、下一步与私有存储布尔状态；不返回 Secret、token、根链接或路径 |
| POST | `/api/admin/feishu-connection/test` | 使用服务端私密配置测试连接；请求体必须为空，不接收凭据、链接或 token |
| POST | `/api/admin/feishu-migrations/preflight` | 一次性飞书迁入预检；根链接和凭据不回显、不记日志 |
| GET | `/api/admin/feishu-migrations/:id` | 目录树、逐项状态和迁入报告 |
| POST | `/api/admin/feishu-migrations/:id/start` | 验证配置与根节点后执行官方只读迁入；所有内容默认待审核 |
| POST | `/api/admin/feishu-migrations/:id/retry-failures` | 重试失败项 |
| POST | `/api/admin/feishu-migrations/:id/disconnect` | 清除外部来源引用并保留自有内容 |
| POST | `/api/admin/imports/:kind/preview` | `.xlsx` / CSV 工作表、映射、安全检查和逐行异常；不返回原始敏感值 |
| POST | `/api/admin/imports/internal-crm/preview` | 内部 CRM 模板预检；只创建私有待复核批次，不改变最终会籍 |
| PATCH | `/api/admin/import-items/:id` | 修正允许字段并重新校验 |
| POST | `/api/admin/import-items/:id/publish` | 将合格资料上架相应知识库分类 |
| POST | `/api/admin/imports/wechat-shop-orders/preview` | 三类付款 `.xlsx` / CSV 汇总预检；商户号支持多文件同批安全汇总，按文件隔离异常；各来源只识别自己的最简线索，不返回文件名或逐行敏感值 |
| POST | `/api/admin/imports/voluntary-directory/preview` | 自愿公开名册独立预检 |
| POST | `/api/admin/import-items/:id/submit-directory-review` | 在明确同意后提交公开名册人工审核 |
| PATCH | `/api/admin/directory-profiles/:id/review` | 独立审核公开名册；不影响 CRM 会籍 |
| POST | `/api/my/public-profile-updates` | 保存独立公开资料更新，不直接覆盖已发布档案 |
| PATCH | `/api/admin/public-profile-updates/:id/review` | 开始审核、发布或退回补充 |
| POST | `/api/my/employment-verifications` | 演示仅登记安全元数据；不保存真实文件内容 |
| GET | `/api/my/renewal-offer` | 仅返回当前会员自己的续费方案和支付配置状态 |
| GET/PATCH | `/api/my/internal-profile` | 维护当前会员内部档案白名单，不改变公开名册 |
| GET/PATCH | `/api/my/connection-notifications/:id` | 查看并处理对接通知；同意前后均不直接返回联系方式 |
| POST | `/api/logout` | 演示会话清理；生产待微信登录态接入 |
| PATCH | `/api/admin/employment-verifications/:id/review` | 更新 CRM 在职核验子状态，不改变会籍/公开资料 |
| PATCH | `/api/admin/demands/:id/human-review` | 人工最终审核 |
| PATCH | `/api/admin/applications/:id/agent-dispatch` | Agent/运营二次筛选 |
| PATCH | `/api/admin/resources/:id/review` | 资料审核发布/归档与权限复核 |
| PATCH | `/api/admin/activities/:id/status` | 开放报名、结束或取消；取消生成通知任务 |
| POST | `/api/admin/notification-jobs/:id/retry` | 将异常通知加入内部重试队列 |
| POST | `/api/admin/bulk-actions/preview` | 批量动作预检，不修改数据 |
| POST | `/api/admin/bulk-actions/execute` | 受权限、再次确认、幂等和 100 条上限保护的批量执行 |

生产补充：`POST /auth/wechat`、支付下单/回调、导入预检/提交、需求提交与多级审核、定向披露、文件签名下载、订阅消息、RBAC 管理接口。
