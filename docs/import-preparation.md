# 内部试用与资料迁移准备

飞书弃用前的正式整库迁入使用后台“一次性飞书迁入”任务，可选择自建应用只读授权或用户导出的 HTML/Markdown/PDF/附件包；不做持续同步。完整流程见 `feishu-one-time-migration.md`。本页 Excel / CSV 模板保留为离线清单补录与修正工具。

## 可直接提供给运营的模板

- `templates/feishu-knowledge-import.csv`：飞书十类目录迁移清单。
- `templates/historical-member-orders.csv`：非小店历史付款/会籍人工核验空白模板。
- `templates/wechat-shop-order-evidence.csv`：微信小店付款证据空白模板。
- `templates/wechat-merchant-receipt-evidence.csv`：微信经营账户/商户号支付小票空白模板。
- `templates/manual-transfer-evidence.csv`：个人手动转账维护空白模板。
- `templates/voluntary-directory-import.csv`：自愿公开名册空白模板。
- `templates/internal-crm-verification.csv`：内部 CRM 规范化核验空白模板。

知识资料模板只包含虚构示例；涉及会员与付款的模板仅有表头。正式试用前请复制一份，在受控环境填入经授权的数据；不要通过聊天工具发送原始会员表或订单表。

## 飞书资料字段

| 字段 | 说明 |
|---|---|
| title / summary | 标题与摘要，必填 |
| source_directory | 十类来源代码，见下表 |
| type | 目标产品类型 |
| tags | 多标签用 `|` 分隔 |
| access_level | `active_member / selected_member / admin_only` |
| source_url / attachment_ref | 至少一个；链接必须为 HTTPS，附件只填引用标识，不填本机秘密路径 |
| published_at | `YYYY-MM-DD` 或有效 ISO 日期 |
| migration_status | `pending / ready / skip` |

十类代码及去向：

| source_directory | type | 去向 |
|---|---|---|
| usage_guide | usage_guide | 知识库 |
| member_directory | member_directory | 会员模块，仅 `admin_only` |
| fundraising_connections | fundraising | 需求中心 |
| recruitment | recruitment | 需求中心 |
| activity_notices | activity_center | 活动中心 |
| meeting_replays | meeting_replay | 知识库 |
| group_digests | group_digest | 知识库 |
| industry_reports | industry_report | 知识库 |
| books | book | 知识库 |
| data_files_tools | data_source 或 tool | 知识库 |

会员名册、融资对接、招聘和活动通知不会被直接上架知识库；预检会给出路由提示，后续需进入对应业务模块审核。联系方式不得放入 title、summary、tags 或公开链接。

## 非小店历史核验字段

空白模板保留 `phone`、`wechat_operator_note`、`historical_price_cents`、`membership_start`、`membership_end`、`group_status`、`import_batch` 等受控字段。由于这些记录可能混合付款、CRM 和人工判断，旧版自动预检接口已停用；正式版应通过受控人工补录和双人复核进入付款证据，不直接创建会籍。

任何导入都应拒绝不必要的 openid/unionid、密钥、银行卡、身份证、地址、订单号等字段及 CSV 公式；原始个人和支付字段不能进入日志或报告。

微信小店整表导出只读取四类信息：收件人姓名、订单发货时间、收件人手机号、商品价格。订单发货时间作为入群时间的主要线索；任一字段缺失只把该行标为待人工核对，不阻断整批。订单编号、地址、留言、商品名、下单时间、订单状态、实付/收款及其他列均自动忽略。若导出中存在退款/售后列，只生成“可能退款”汇总计数，不回显原值。

运营者可在预检卡片维护“A1轮股东价格 / A2轮股东价格”的精确价格规则。价格命中只生成身份候选；未配置或未命中时进入人工归类，不能自动激活会籍。商户号小票与手动转账分别使用自己的姓名、发生时间、手机号和金额四类最简字段，不受微信小店字段约束。

若现有 CSV 使用中文或旧系统表头，可在 API 请求的 `mapping` 中传入“原表头 → 标准字段”映射，例如：`{"手机号":"phone","到期日":"membership_end"}`。即使映射到合法字段，原始敏感表头也不会被掩盖或放行。

未来持久化导入不沿用匿名 demo 的内存批次。CRM、付款证据与自愿公开名册分别进入私有批次；联系方式/匹配信息和备注只保留服务端哈希或加密载荷。完整安全边界、未来迁移顺序和真实数据准入条件见 `docs/governed-member-import-persistence.md`。

## 运营流程

1. 启动原型，进入后台“飞书资料导入”或“历史会员订单导入”。
2. 下载模板或直接修改页面内的虚构示例，运行预检。
3. 查看批次、CSV 行号、可理解的错误和路由提醒。
4. 在异常项 JSON 中修正允许字段并复检；额外/高风险字段不能通过修正接口写入。
5. 校验通过且 `migration_status=ready` 的知识库资料可点击“上架知识库”。其他目录保留为待进入业务模块的迁移项。
6. 正式数据迁移前仍需数据库、RBAC、加密、备份和回滚；本原型数据仅在内存中，重启即清空。

## API

- `GET /api/admin/import-templates/knowledge.csv`
- `GET /api/admin/import-templates/member-orders.csv`（仅空白参考，自动预检已停用）
- `GET /api/admin/import-templates/wechat-shop-orders.csv`
- `GET /api/admin/import-templates/wechat-merchant-receipts.csv`
- `GET /api/admin/import-templates/manual-transfers.csv`
- `GET /api/admin/import-templates/voluntary-directory.csv`
- `POST /api/admin/imports/knowledge/preview`
- `POST /api/admin/imports/wechat-shop-orders/preview`

微信经营账户 / 商户号支付小票支持一次选择或拖放多个 `.xlsx` / `.csv`，同批最多 10 个文件，单文件仍为 10MB / 10,000 行，整批为 30MB / 30,000 行。预检按“文件 1、文件 2……”显示安全摘要，不返回文件名、姓名、手机号、金额、订单号或备注；某个文件异常时会单独标注，其他合格文件仍保留在整批汇总中。微信小店和手动转账继续各用自己的字段规则与单文件入口，不受商户号批处理规则影响。

三类付款记录在后台 **会员 → 会员 CRM 库（首选）→ 导入付款记录** 中选择来源并预检，可直接上传 `.xlsx` 或 UTF-8 `.csv`。请求以 `paymentSource` 区分 `wechat_shop_order / wechat_merchant_receipt / manual_transfer`，三者都只生成匹配线索。CRM 与自愿公开名册也使用同一套 Excel 安全预检。

付款预检只返回识别到的安全字段类别、读取行数、可匹配/待人工核对、价格待归类、A1/A2 候选和可能退款等汇总计数；不会返回逐行订单、完整原始表头、姓名、手机号、价格、订单号、地址或备注正文。

Excel 安全边界：常规订单整表无需拆分；单文件安全硬上限为 10MB、10,000 行、64 列，解压后最多 64MB，默认读取第一个有内容的可见工作表。拒绝旧版 `.xls`、宏文件、加密/密码保护、外部链接、隐藏批注、危险公式和异常解压体积。安全公式只读取工作簿已保存的缓存值，服务端不执行公式。预检响应显示“已读取 N 行、异常 M 行”、工作表和标准字段映射，不回显手机号、微信、订单号、金额或备注正文。超过硬上限时按导出月份或时间段分批即可。
- `POST /api/admin/imports/voluntary-directory/preview`
- `PATCH /api/admin/import-items/:id`
- `POST /api/admin/import-items/:id/publish`
- `GET /api/admin/import-batches`
- `GET /api/admin/import-items`
