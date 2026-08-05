# 飞书知识库一次性迁入

## 目标

把指定飞书 Wiki 根目录下的历史资料一次性复制到本系统。迁入后，正文成为自有内容记录，附件进入私有对象存储；运营完成审核与分类后再发布。会员端不读取、不跳转也不暴露飞书地址。完成验收后可彻底断开来源并弃用飞书，不设计持续同步、增量同步或双向写回。

默认演示环境没有凭据，因此不会访问真实飞书页面，也不会伪造连接成功。根链接仅在发起预检时用于格式校验：必须为 HTTPS、域名属于 `feishu.cn` 或其子域名、路径为 `/wiki/{节点标识}`。查询参数与片段会被剥离；执行期只在服务端内存保留节点标识，不进入任务记录、API 响应或审计摘要。校验失败会区分链接格式、非 HTTPS、非可信域名、非 Wiki 路径和缺少节点标识。

## 我现在应该怎么操作

1. 在部署平台的私密环境变量中填写 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`，同时配置私有附件存储；保存后重启后端服务。不要把 Secret 填进后台网页或发送到聊天。
2. 在飞书侧确认应用拥有所需的最小只读 API 权限，并把目标 Wiki/知识库资源本身授予该应用读取。创建应用与授予目标资源读权是两件事。
3. 打开后台“资料与导入 → 一次性飞书迁入”，先看迁入前检查，再点“测试连接”。“连接成功”只证明应用身份可用，不证明目标 Wiki 已授权。
4. 粘贴目标 Wiki 根链接，创建安全预检任务；随后在该任务中点击“运行一次性迁入”。首次读取目录会验证目标 Wiki 读权，失败只显示安全错误分类。
5. 在知识库、名册、招聘/融资、活动、回放或隔离区逐项审核；确认迁入完成后彻底断开来源并撤销飞书授权。不做持续同步。

## 状态诊断

| 后台状态 | 含义 | 下一步 |
|---|---|---|
| 服务端未配置 | 当前 Node 进程未同时读取到 App ID 与 Secret | 在部署密钥环境配置并重启服务 |
| 服务端已配置 | 已检测到两项配置，但尚未成功测试 | 点击“测试连接” |
| 连接失败 / 凭据无效 | 飞书拒绝应用身份 | 核对应用配置是否属于同一自建应用，重新注入并重启 |
| 连接失败 / 网络异常 | 服务端无法访问飞书开放平台 | 检查部署网络、代理、防火墙和出站 HTTPS |
| 连接成功 | tenant 应用身份可用，但目标 Wiki 尚未验证 | 授予目标资源读权，再创建并运行任务 |
| 目标 Wiki 授权失败 | API 权限或具体知识库资源读权不足 | 在飞书侧补齐最小只读权限及目标资源授权 |
| 等待私有存储 | 附件无法安全落库，服务端主动阻止迁入 | 配置生产私有对象存储或本地私有目录并重启 |
| 迁入后审核中 | 自有内容已生成，不能重复运行同一任务 | 到对应审核队列处理，完成后断开来源 |

本地预览默认是演示/开发环境，通常不会读取真实部署平台 Secret，也不会虚构连接成功。若要在本机做真实联调，必须让启动 Node 服务的同一个私密环境显式注入配置并重启；请勿把值写入项目文件、终端共享记录或网页表单。

## 服务端私密配置

配置样例位于 `config/feishu.env.example`，只列变量名：

```text
FEISHU_APP_ID=
FEISHU_APP_SECRET=
PRIVATE_STORAGE_DIR=
FEISHU_MAX_ATTACHMENT_BYTES=
```

- 本机开发：在启动服务的私密环境中设置变量，让 Node 进程继承；不要把值写入项目文件、命令历史、普通网页或聊天。可使用操作系统密钥工具或只对当前开发机开放的私密启动配置。
- 生产部署：在部署平台的 Secret/密钥管理界面创建同名变量，限制读取者和环境，重启服务后生效。应用日志、错误追踪和配置导出必须屏蔽这些值。
- `PRIVATE_STORAGE_DIR` 只用于本机验证私有附件适配器；生产应替换为私有对象存储，并使用不透明对象键、短时签名、文件检查和保留/删除策略。
- 后台“测试连接”的请求体必须为空。前端提交 App ID、App Secret、token、Cookie 或其他参数会被拒绝。

服务端只向后台返回 `not_configured`、`configured`、`connection_success`、`connection_failed` 和安全错误分类，例如凭据无效、权限不足、资源不可见、限流或网络异常；不会返回原始响应、请求头、token、secret 或根链接。

## 两条真实授权路径

### 路径 A：飞书自建应用只读授权

1. 公司主体在飞书开放平台创建自建应用，只授予迁移所需的最小只读权限。
2. 按飞书控制台当时显示的权限名称，为应用开通 Wiki 节点读取、云文档内容读取及实际需要的云盘文件/素材下载等最小只读权限；不要授予写权限。
3. 把目标知识库或相应资源明确授予该应用读取。开放平台 API 权限和具体资源读权是两层要求，缺一不可。
4. 在本机私密环境或部署平台 Secret 管理中注入 App ID/App Secret；不要发到聊天，也不要填入普通后台网页。
5. 后台先点“测试连接”。连接成功只证明服务端应用身份可用，迁入执行仍会校验根节点是否可读。
6. Source adapter 取得 tenant access token，从已校验的 Wiki 节点开始列举目录树，读取文档正文和所需附件；附件立即写入私有存储，所有内容固定进入待审核区。
7. 运营审核、分类并确认自有内容可用后，点击“彻底断开来源”，随后撤销知识库读权并删除/轮换部署密钥。
8. 不配置 webhook、定时任务或后续同步。

本实现采用飞书官方自建应用 tenant access token、Wiki 节点、云文档正文/块和云盘素材/文件下载接口。具体权限名称、可用范围和 API 版本必须以执行时的飞书开放平台控制台及官方文档为准，不在代码中臆造固定权限名：

- [自建应用获取 tenant access token](https://open.feishu.cn/document/server-docs/api-call-guide/calling-process/get-?lang=zh-CN)
- [获取知识空间节点信息](https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/get_node?lang=zh-CN)
- [获取知识空间子节点列表](https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/list)
- [知识库常见问题与资源权限说明](https://open.feishu.cn/document/server-docs/docs/wiki-v2/wiki-qa)
- [获取云文档纯文本内容](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/raw_content?lang=zh-CN)
- [获取云文档所有块](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/list?lang=zh-CN)
- [下载素材](https://open.feishu.cn/document/server-docs/docs/drive-v1/media/download?lang=zh-CN) 与 [下载文件](https://open.feishu.cn/document/server-docs/docs/drive-v1/download/download)

### 路径 B：用户导出资料包

1. 用户从飞书导出获授权的 HTML、Markdown、PDF 与附件文件。
2. 通过后台的生产私有上传通道提交资料包；上传前执行文件类型、大小、病毒、压缩包路径穿越和恶意内容检查。
3. Export package adapter 解析目录结构，正文复制到自有内容记录，附件写入私有对象存储。
4. 迁入验收后删除原始导出包和临时解压文件，仅保留经审核的自有内容与必要审计摘要。

## 状态与路由

预检生成目录树和逐项工作项。所有可识别内容默认 `pending_review`，绝不自动公开：

| 来源类型 | 目标待办 |
|---|---|
| 使用说明、群聊精华、行业报告、书籍、数据源和工具 | 知识库审核 |
| 会员名册 | 独立公开名册/CRM 数据治理审核，不自动公开 |
| 招聘 | 招聘需求审核 |
| 融资资源对接 | 融资需求审核 |
| 活动通知 | 活动审核 |
| 线上回放 | 回放与附件审核 |
| 敏感、无法识别或不安全内容 | 隔离区，人工分类 |

报告统计总数、待审核、已迁入、跳过、异常、需人工分类和附件待处理。失败项可重试；来源断开后重试必须新建任务并重新授权或上传资料包。

## 自有存储与断开

- 正文落入自有业务记录；外部页面地址不是会员访问依赖。
- 附件使用私有对象存储键，下载必须经过权限检查和短时签名。
- 临时外部定位符只能加密保存并限期使用，不进入普通管理列表、会员 API 或日志。
- “彻底断开来源”会清除服务端授权引用、外部定位符和临时导出包；已迁入的自有内容继续保留。
- 断开行为写入审计，但审计只记录任务、数量和清除结果，不记录链接、token、标题正文或附件名。

## API 原型

- `GET /api/admin/feishu-connection/status`
- `GET /api/admin/feishu-migration-readiness`（安全检查清单、下一步、私有存储状态；不返回凭据或路径）
- `POST /api/admin/feishu-connection/test`（空请求体；不接收凭据或链接）
- `GET /api/admin/feishu-migrations`
- `POST /api/admin/feishu-migrations/preflight`
- `GET /api/admin/feishu-migrations/:id`
- `POST /api/admin/feishu-migrations/:id/start`
- `POST /api/admin/feishu-migrations/:id/retry-failures`
- `POST /api/admin/feishu-migrations/:id/disconnect`

没有服务端私密配置时，连接测试和 `start` 都返回“等待服务端配置”，不会尝试网络请求。测试使用可注入 mock 覆盖错误凭据、安全成功、Wiki 遍历、文档读取、附件私有落库和成员端不泄露；mock 成功不代表真实账号连接成功。
