# 会员自助名册更新与在职核验

## 公开资料更新

会员可在“小程序 → 我的 → 我的公开名册”维护：公开显示名、公开机构/职位、城市、行业/赛道、兴趣方向、阶段、专业领域、简介、合作偏好和可见/隐藏状态。

手机号、微信、邮箱、地址及其他联系方式不属于允许字段；公开文本若疑似包含联系方式会被拒绝，会员间联系仍走申请对接。

每次提交创建独立 `public_profile_update`，不会覆盖当前已发布档案：

```text
submitted → pending_review → published
                         └→ returned_for_revision
```

- `submitted`：会员已提交；旧版公开资料保持不变。
- `pending_review`：运营正在核验冒用、营销和失实风险。
- `published`：审核通过后一次性发布新快照；`visibility=hidden` 时从公开列表隐藏。
- `returned_for_revision`：会员查看原因码后重新提交新版本，原记录不可改写。

运营后台的“公开资料更新审核”队列只处理公开档案，不修改 CRM、付款证据或最终会籍。

## 在职名片内部核验

会员可选择 JPEG、PNG 或 PDF 并填写可选说明。在职材料进入独立 `employment_verification` 队列；会员端只可见流程状态，不能获取内部 CRM 结论备注或文件地址。

演示环境不保存文件内容、原文件名、临时路径、说明正文或审核备注正文，只记录不可识别的类型、大小分级和状态。请勿在演示环境选择真实名片或填写可识别信息。

运营核验状态：`submitted → pending_review → verified / returned_for_revision / rejected`。结论只更新 CRM 的“在职材料核验”子状态及审计，明确记录 `membershipChanged=false` 与 `publicProfileChanged=false`；不会自动改写公开资料、会籍到期日、群状态或付款证据。

## 生产文件安全基线

正式上传必须在真实账号环境补齐：

1. 服务端签发短时、单用途上传凭证，文件进入私有对象存储；禁止永久公网 URL。
2. 服务端复核 MIME、扩展名和文件魔数，限制允许类型及大小；当前原型基线为 JPEG/PNG/PDF、最大 5MB，正式值需用户确认。
3. 上传完成先进入隔离区，执行病毒/恶意内容扫描；通过后才可进入内部 CRM 审核。
4. 对象存储加密，下载使用短时签名 URL；每次查看和下载进入审计，普通管理员不可批量导出。
5. 文件名、路径、签名 URL、说明正文和图片内容不得进入日志、普通列表、搜索索引、公开接口或分析报表。
6. 设置保留期限、到期自动删除、会员撤回/账号注销删除及备份同步删除机制，并记录删除证明。
7. RBAC 限定在职核验专属角色；高风险查看可采用二次确认或双人审批。

## API

- `GET /api/my/public-profile`
- `POST /api/my/public-profile-updates`
- `GET /api/my/employment-verifications`
- `POST /api/my/employment-verifications`
- `GET /api/admin/public-profile-updates`
- `PATCH /api/admin/public-profile-updates/:id/review`
- `GET /api/admin/employment-verifications`
- `PATCH /api/admin/employment-verifications/:id/review`
