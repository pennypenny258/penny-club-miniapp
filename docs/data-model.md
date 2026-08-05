# 数据模型

## 会员移动体验补充实体

- `resource.mobileSection`：将既有资料类型映射到 `replays`、`reports_digest`、`books`、`files_templates`、`benefits` 五个移动分栏，不替代后台原始分类。
- `resource.downloadEnabled`：运营逐项控制下载入口；开启后仍必须经过有效会籍与私有文件签名校验。
- `resource.tags`：最多 10 个规范化关键词；只有 `published` 资料的标签可进入会员端资料库和动态搜索。
- `resource.viewEnabled`：已发布资料默认可打开受控阅读入口；与下载开关分离。`preview_not_configured` 表示可查看安全元数据，但文件在线预览/转码尚未接入。
- `member_favorite`：仅关联当前会员与已发布资料/活动，不复制受保护内容。
- `agent_match_request`：保存会员文本需求、输入方式、AI 配置状态、人工审核状态；普通会员响应不包含私密匹配结果或联系人。
- `internal_member_profile`：公司/城市/需求偏好与手机号登记状态，属于内部域，不自动同步公开名册。
- `member_connection`：对接申请与被申请者决定；同意只授权受控介绍，不由普通会员接口直接返回联系方式。

正式建表准备见 `server/db/migrations/`；旧的 public schema 草案已停用，安全边界与启用条件见 [PostgreSQL 持久化第一阶段](postgres-persistence-phase1.md)。核心关系如下：

| 实体 | 用途 | 关键字段 |
|---|---|---|
| users | 微信身份 | unionid/openid（加密/唯一）、昵称、状态 |
| member_profiles / crm_verifications | 内部 CRM 核验 | 受控身份引用、到期日、群状态、运营核验；绝不进入会员端 |
| public_directory_profiles | 自愿公开名册 | 公开显示名、职业资料、独立同意、人工审核、撤回状态；无公开联系方式 |
| public_profile_updates | 会员自助更新快照 | 建议公开字段、提交/审核/发布/退回状态、发布目标 |
| employment_verifications | 在职材料核验 | 私有存储键、类型/大小、加密说明、保留/删除及内部审核状态 |
| memberships | 会籍 | 起止日、有效/过期/暂停、群内状态、来源 |
| renewal_offers | 个性续费方案 | 标准价、专属价、原因、适用规则、有效期 |
| orders | 历史/续费订单 | 手机号快照、价格、到期日快照、支付状态、幂等号 |
| payment_evidence | 付款证据 | 小店/人工/二次付款来源、状态、退款、产品规则、人工复核 |
| membership_decisions | 最终会籍判定 | CRM、付款、到期日、群状态、理由码与审核人 |
| import_batches | 资料/订单导入批次 | 类型、字段映射、有效/异常行、结果摘要、回滚标识 |
| import_items | 逐行迁移工作项 | CSV 行号、规范化数据、错误/警告、修正与上架状态 |
| local_import_batches / local_import_items | 电脑资料导入 | 批次摘要、五分栏、标题、来源说明、下载开关、分类确认、附件是否已私有保存、安全复核与待审核状态；路径和存储键不进入安全响应 |
| one_time_source_migrations | 一次性来源迁入任务 | 来源方式、范围、分类策略、连接安全状态、等待授权/导出包、报告、断开状态；持续同步固定为否；不保存凭据或根链接 |
| one_time_source_migration_items | 逐项迁入状态 | 自有内容目标、私有附件不透明引用、待审核/跳过/异常/分类/重试；临时来源定位符只在私有执行边界使用并在断开后清除 |
| resources | 知识库 | 类型、权限级别、存储键、发布状态 |
| activities | 活动 | 线上/线下/混合、报名期、会议链接开放窗 |
| registrations | 报名 | 活动、会员、状态、通知状态 |
| notification_jobs | 自动通知 | 报名、变更、会前、会后归档四类触发任务 |
| demands | 招聘/融资/并购需求 | 匿名内容、披露级别、审核状态、敏感数据引用 |
| demand_applications | 对接申请 | 申请理由、筛选状态、需求方确认、披露记录 |
| disclosure_grants | 定向披露授权 | 字段白名单、授权人、对象、到期与撤回 |
| member_connection_requests | 会员对接 | 申请人、目标会员、理由、目标方决定 |
| ai_reviews | AI 初筛结果 | 模型/版本、风险项、建议、原始结果、人工结论 |
| audit_logs | 审计 | 操作者、动作、对象、变更摘要、IP、时间 |

## 状态规则

- 当前运营门禁以大群状态为准：账号未禁用且仍在大群可保持当前访问；标签到期但尚未通知续费时进入“待续费跟进 / 仍暂时有效”，不自动失效。CRM、OCR 标签和三类付款线索用于补全与复核，不能单独激活会籍。
- CRM 核验状态与公开名册状态是独立维度，订单/CRM 不得自动创建公开资料。
- 微信小店订单、微信经营账户/商户号支付小票和个人手动转账都只是付款线索；取消、全额退款、待支付排除，部分退款人工复核，任何线索都不能单独激活会籍。
- 续费成功：对当前未过期会员从原到期日顺延；已过期会员从支付成功日开始。
- 披露级别：`anonymous / company / transaction / contact` 逐级提升；联系方式必须是定向授权，绝不出现在公开卡片。
- 需求发布：AI 仅作初筛，`human_review_status` 的人工终审才决定能否发布；申请进入 Agent/运营二次筛选后，仍需需求方确认披露。
- 活动通知：报名成功、活动变更、会前提醒、会后归档均生成独立可重试任务；通知失败不改变报名事实。
- 知识类型：`usage_guide / industry_report / group_digest / meeting_replay / book / data_source / tool`，线上回放可关联原活动。
- 删除优先软删除或下架；高风险字段加密，审计日志不可由普通管理员修改。

完整规则见 `data-governance-and-matching.md`。
