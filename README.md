# 创投会员社群微信小程序 MVP

面向约 2000 名付费会员的移动端微信小程序与运营后台原型。当前版本不依赖数据库或外部账号，内置演示数据，可验证会员门禁、知识库权限、需求申请、活动报名与会议链接时间窗；飞书一次性迁入已具备服务端只读连接边界，无服务端私密配置时不会伪造连接成功。

## 立即运行

要求 Node.js 18+：

```bash
npm run dev
```

然后打开：

- 会员端浏览器预览：http://localhost:3000/member/
- 运营后台：http://localhost:3000/admin/
- 健康检查：http://localhost:3000/api/health
- 小程序 API 演示身份：请求头 `x-demo-user: active`（也可用 `expired`、`guest`）

微信开发者工具导入 `miniprogram/`。本地调试时开启“不校验合法域名”，API 默认指向本机 `http://localhost:3000`；真机联调需 HTTPS 合法域名。

macOS 非技术用户也可直接双击 `start-preview.command` 启动并打开两个入口，双击 `stop-preview.command` 关闭。

本机测试飞书只读连接时，双击 `configure-feishu-local.command` 创建并编辑受保护的 `.env.local`，保存后双击 `restart-preview.command`。不要把 Secret 填入后台网页。完整步骤与当前内存服务/本地存储边界见 [本机飞书配置与重启指南](docs/local-feishu-configuration.md)。

## 当前可运行能力

- 五种可切换演示身份及会籍有效性门禁（有效、临期、过期、待核验、冻结）
- 四个移动优先底部入口：动态、资料库、Agents、我的
- 安全搜索与动态聚合、五个资料分栏、下载开关和资料/活动收藏
- 从电脑多文件导入资料的首选流程：白名单、私有保存、五分栏、待审核、下载开关与无文件条目
- 飞书使用说明、回放、精华、报告、书籍、数据源和工具的可选迁移落位
- 飞书服务端连接状态、只读连接测试、Wiki/文档/附件读取适配器与私有附件落库边界
- 活动报名；腾讯会议链接仅对“已报名 + 有效会员 + 时间窗内”返回
- 城市沙龙、半年/年度聚会及报名/变更/会前/会后通知任务
- 投资/融资/并购/招聘/招商匿名机会、文本匹配请求与受控对接申请
- AI 初筛、人工终审、Agent 二次分发和发布者分级披露骨架
- 运营后台总览、会员/需求/活动/资料列表
- 所有写操作生成审计日志
- 领域服务测试覆盖核心权限规则

这是一套可验证业务流程的第一阶段原型。微信真实登录、微信支付、对象存储、短信/订阅通知、AI 服务和腾讯会议账号均保留适配接口，尚未使用或臆造任何凭据。飞书 App ID 与 App Secret 只允许由服务端环境或部署平台密钥注入，绝不能通过后台网页或聊天提交。

## 匿名演示数据

原型内置适量的全流程虚构数据，用于视觉评审和运营演练。人物均使用演示代号，组织均标注为虚构；付款记录只展示规则档位与审核状态。演示数据不含手机号、微信号、真实订单号、地址、付款凭据、会议特邀链接、名片内容或可识别附件。详细覆盖见 [匿名演示数据说明](docs/anonymous-demo-data.md)。

## 文档

- [技术架构](docs/architecture.md)
- [数据模型](docs/data-model.md)
- [页面与接口](docs/pages-and-api.md)
- [会员端移动体验需求对照](docs/member-mobile-ux-crosswalk.md)
- [开发任务清单](docs/backlog.md)
- [外部依赖与待确认项](docs/external-dependencies.md)
- [完整需求覆盖与飞书迁移映射](docs/requirements-coverage.md)
- [微信小程序开发与发布规范](docs/development-and-release-standards.md)
- [内部试用与资料迁移准备](docs/import-preparation.md)
- [数据治理与会员匹配规则](docs/data-governance-and-matching.md)
- [本地工作簿字段映射（不含数据）](docs/workbook-field-mapping.md)
- [会员自助名册更新与在职核验](docs/member-self-service-and-employment-verification.md)
- [匿名演示数据说明](docs/anonymous-demo-data.md)
- [运营后台信息架构](docs/admin-information-architecture.md)
- [运营后台上线准备报告](docs/admin-launch-readiness.md)
- [飞书知识库一次性迁入](docs/feishu-one-time-migration.md)
- [本机飞书配置与重启指南](docs/local-feishu-configuration.md)
- [从电脑导入资料](docs/local-material-import.md)
- [CloudBase 云托管匿名测试环境部署](docs/cloudbase-staging-deployment.md)
