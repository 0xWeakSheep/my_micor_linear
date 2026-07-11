# Linear Clone 功能范围与验收清单

> 本文是产品研究与后续演进清单，不是当前版本的完成度声明。当前代码实际交付内容、验证结果和明确边界以 [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) 为准；未勾选项不应被理解为已经验收。
>
> 调研基线：Linear 官方文档，核对日期 2026-07-11。
> 产品规模：单工作区约 100 人以内，不针对高并发或超大规模部署优化。
> 目标：复刻 Linear 的非 AI 基础体验，并用可执行、可验证的清单推进实现。

## 1. 范围原则

- 产品以 Web 为首要客户端，优先保证桌面端效率，同时提供可用的响应式移动布局。
- 功能完整性优先于企业级扩展能力；单体应用、单数据库和轻量后台任务足以满足目标规模。
- 所有权限必须在服务端校验，不能仅依赖前端隐藏入口。
- 所有核心实体使用稳定 ID；Issue 额外使用人类可读的 `<TEAM_KEY>-<NUMBER>` 标识。
- 所有关键写操作应进入活动记录，通知、Webhook、周期任务必须可重试并保持幂等。
- 下文所有实现项初始均为未完成状态；只有在对应验收条件被自动化测试或人工验证证明后才能勾选。

## 2. 明确排除的 AI 能力

以下能力不属于当前实现范围：

- Linear Agent 和 Agent Skills。
- Triage Intelligence，包括智能负责人、标签、团队、项目和重复项建议。
- AI Filter / 自然语言筛选。
- 自动生成 Issue、评论线程、Project Update 或 Initiative Update 摘要。
- AI 生成 Release Notes。
- Coding Sessions、自动编码、自动创建 PR、Code Intelligence。
- 任何依赖 LLM 的文本改写、拆解、优先级判断、搜索或预测。

仍然属于范围的自动化能力：固定条件规则、周期滚动、重复任务、定时提醒、自动归档、Git 状态同步、Webhook 和可配置通知。这些功能不依赖 AI。

## 3. 官方功能矩阵

| 领域 | 基础能力 | 计划阶段 | 官方文档 |
| --- | --- | --- | --- |
| 工作区、团队与权限 | 邀请、成员状态、角色、公开/私有团队、团队设置 | Phase 1 | [Teams](https://linear.app/docs/teams)、[Members and roles](https://linear.app/docs/members-roles)、[Private teams](https://linear.app/docs/private-teams) |
| Issue 生命周期 | 创建、编辑、状态、负责人、优先级、标签、估算、截止日期、归档与恢复 | Phase 2 | [Create issues](https://linear.app/docs/creating-issues)、[Issue status](https://linear.app/docs/configuring-workflows)、[Priority](https://linear.app/docs/priority)、[Estimates](https://linear.app/docs/estimates)、[Due dates](https://linear.app/docs/due-dates) |
| Issue 结构与复用 | 父子 Issue、关系、模板、重复任务 | Phase 2 | [Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)、[Issue relations](https://linear.app/docs/issue-relations)、[Issue templates](https://linear.app/docs/issue-templates) |
| 协作与编辑器 | Markdown、附件、评论、线程、提及、Reaction、文档、活动记录 | Phase 2 | [Editor](https://linear.app/docs/editor)、[Comments and reactions](https://linear.app/docs/comment-on-issues)、[Issue documents](https://linear.app/docs/issue-documents) |
| 视图与效率 | 列表、看板、筛选、排序、分组、搜索、批量操作、自定义视图、快捷键 | Phase 3 | [Board layout](https://linear.app/docs/board-layout)、[Display options](https://linear.app/docs/display-options)、[Filters](https://linear.app/docs/filters)、[Custom Views](https://linear.app/docs/custom-views)、[Search](https://linear.app/docs/search)、[Select issues](https://linear.app/docs/select-issues) |
| Triage | 收件队列、接受、拒绝、标记重复、Snooze、责任人、固定规则 | Phase 3 | [Triage](https://linear.app/docs/triage) |
| Cycles | 周期配置、自动创建、任务滚动、容量、进度与速度 | Phase 4 | [Cycles](https://linear.app/docs/use-cycles) |
| Projects | 多团队项目、属性、里程碑、文档、模板、依赖、Timeline、健康更新 | Phase 4 | [Projects](https://linear.app/docs/projects)、[Project milestones](https://linear.app/docs/project-milestones)、[Project dependencies](https://linear.app/docs/project-dependencies)、[Project updates](https://linear.app/docs/initiative-and-project-updates) |
| Initiatives / Roadmap | 目标、项目聚合、层级、健康汇总、时间线 | Phase 4 | [Initiatives](https://linear.app/docs/initiatives)、[Timeline](https://linear.app/docs/timeline) |
| 个人工作台与通知 | My Issues、Inbox、订阅、提醒、Snooze、邮件偏好 | Phase 5 | [My issues](https://linear.app/docs/my-issues)、[Inbox](https://linear.app/docs/inbox)、[Notifications](https://linear.app/docs/notifications) |
| 报表 | Issue 数量、Effort、Cycle/Project 进度、维度分组、图表和 CSV | Phase 5 | [Insights](https://linear.app/docs/insights)、[Project overview](https://linear.app/docs/project-overview) |
| 集成与数据迁移 | API Token、Webhook、CSV、GitHub/GitLab、Slack、邮件入口 | Phase 5 | [API and Webhooks](https://linear.app/docs/api-and-webhooks)、[GitHub](https://linear.app/docs/github-integration)、[GitLab](https://linear.app/docs/gitlab)、[Slack](https://linear.app/docs/slack)、[Importer](https://linear.app/docs/import-issues)、[Exporting Data](https://linear.app/docs/exporting-data) |
| 实时体验 | 多客户端实时同步、乐观更新、失败重试、快捷操作 | 全阶段 | [Get the app / Real-time sync](https://linear.app/docs/get-the-app)、[Concepts](https://linear.app/docs/conceptual-model) |

## 4. 分阶段实现与验收

### Phase 0：应用基础与质量底座

目标：建立后续所有业务能力依赖的数据、权限、实时通信和测试基础。

#### 实现清单

- [ ] 建立可本地运行的一键启动流程，并提供示例环境变量。
- [ ] 建立关系型数据库 schema、迁移机制和种子数据。
- [ ] 为核心实体提供 UUID，并建立创建、更新时间和软删除字段。
- [ ] 建立统一的服务端认证上下文和授权中间层。
- [ ] 建立事务边界、输入校验、统一错误格式和审计事件接口。
- [ ] 建立 WebSocket 或 SSE 实时事件通道。
- [ ] 建立后台任务执行器，用于重复任务、周期切换、提醒和归档。
- [ ] 建立文件上传、下载和对象级权限校验能力。
- [ ] 建立单元测试、API 集成测试和浏览器 E2E 测试框架。
- [ ] 建立可观测性基础：结构化日志、请求 ID、错误捕获和健康检查。

#### 验收清单

- [ ] 全新环境可以按照 README 在一次命令内完成依赖安装、迁移、种子数据和启动。
- [ ] 未登录请求、无权限请求和已删除对象访问均返回一致且正确的错误。
- [ ] 两个浏览器会话中的测试实体变更可在 2 秒内同步，无需刷新。
- [ ] 后台任务重复执行不会生成重复数据或重复通知。
- [ ] 事务中的任一步失败时，不会留下半完成的业务数据。

### Phase 1：账号、工作区、团队与权限

目标：形成安全的多人协作边界。

#### 实现清单

- [ ] 支持邮箱登录；可采用密码或 Magic Link，但必须有安全会话和退出能力。
- [ ] 支持创建工作区，并保存名称、URL slug、默认时区和基础偏好。
- [ ] 支持通过邮箱邀请成员以及 Pending、Active、Suspended 状态。
- [ ] 支持 Admin、Member、Guest 三种基础角色。
- [ ] 支持成员列表、搜索、角色修改、暂停和恢复。
- [ ] 支持创建、编辑、排序、归档和恢复团队。
- [ ] 支持团队名称、唯一 Key、图标、颜色和时区。
- [ ] 支持公开团队和私有团队。
- [ ] 支持加入、离开、邀请团队成员和团队负责人。
- [ ] 支持团队 Home，展示置顶资源和常用入口。
- [ ] 支持工作区和团队级设置权限。

#### 验收清单

- [ ] Admin 可以邀请、暂停、恢复用户并修改角色。
- [ ] Member 不能访问工作区管理接口或提升自己的角色。
- [ ] Guest 只能访问明确加入的团队及其 Issue、Project 和文档。
- [ ] 非私有团队成员无法通过 UI、API、搜索、通知或附件 URL 获取私有团队数据。
- [ ] 团队 Key 在工作区内唯一，修改团队名称不会破坏已有 Issue 链接。
- [ ] 归档团队为只读或不可新建内容，恢复后历史数据完整。

### Phase 2：Issue、工作流与协作

目标：完成可独立使用的 Issue Tracker 核心闭环。

#### 实现清单：Issue 核心

- [ ] 创建 Issue 时要求团队、标题和状态，并生成递增的 `<TEAM_KEY>-<NUMBER>`。
- [ ] 支持编辑标题和 Markdown/富文本描述，并自动保存草稿。
- [ ] 支持单一负责人和快速指派自己。
- [ ] 支持 No priority、Low、Medium、High、Urgent 五级优先级。
- [ ] 支持团队级状态配置和固定状态类别：Backlog、Unstarted、Started、Completed、Canceled、Duplicate。
- [ ] 支持每个团队配置默认状态、状态名称、颜色、描述和类别内顺序。
- [ ] 支持团队级 Label、工作区级 Label、Label Group 和互斥子标签。
- [ ] 支持团队启用估算，并提供 Linear、Fibonacci、Exponential、T-Shirt 量表。
- [ ] 支持 Issue Due Date、临期和逾期视觉状态。
- [ ] 支持 Issue 在团队、Cycle、Project 和 Milestone 间移动。
- [ ] 支持复制、删除、恢复、自动关闭和自动归档。
- [ ] 支持多选 Issue 并批量更新属性。
- [ ] 为所有属性变更写入 Activity，记录操作者、时间、旧值和新值。

#### 实现清单：结构与复用

- [ ] 支持 Parent/Sub-issue，并允许子 Issue 使用不同团队和负责人。
- [ ] 支持 related、blocked by、blocking 和 duplicate 关系。
- [ ] 标记 duplicate 时保留主 Issue 链接并切换到系统 Duplicate 状态。
- [ ] 支持工作区级和团队级 Issue Template。
- [ ] 模板可预填标题、描述、状态、优先级、负责人、Project、Label、Estimate 和子 Issue。
- [ ] 支持把 Issue 配置为重复任务，并设置首次日期、时区和重复规则。
- [ ] 支持从 Issue、评论或选中文本创建子 Issue。

#### 实现清单：编辑器与协作

- [ ] 编辑器支持标题、粗体、斜体、删除线、链接、引用、代码、代码块、列表、任务列表和表格。
- [ ] 支持拖拽、粘贴或文件选择器上传附件。
- [ ] 支持 `@` 提及用户、Issue、Project 和文档。
- [ ] 支持评论的创建、编辑、删除和永久链接。
- [ ] 支持评论线程、回复和 Resolve/Reopen。
- [ ] 支持对描述、评论和更新添加 Emoji Reaction。
- [ ] 支持 Issue 订阅、退订和订阅者列表。
- [ ] 支持工作区、团队、Project 和 Issue 级文档与外部链接。
- [ ] 支持文档自动保存、评论、提及、订阅和历史版本恢复。

#### 验收清单

- [ ] Issue 创建、修改、完成、取消、删除和恢复流程均可从 UI 完成并持久化。
- [ ] 并发编辑时不会静默丢失最新数据；冲突至少有版本校验或明确覆盖策略。
- [ ] 父子关系和阻塞关系在双方详情中一致显示，删除关系后双方同步更新。
- [ ] Duplicate Issue 不再出现在普通 Active 列表，但可从主 Issue 和搜索访问。
- [ ] 模板和重复任务生成的数据与配置一致，后台任务重试不会重复创建。
- [ ] Mention、评论和负责人变化会生成正确的订阅及通知事件。
- [ ] 无权限用户无法通过附件直链或引用预览获取受限内容。
- [ ] Activity 能还原一次完整 Issue 生命周期中的关键操作。

### Phase 3：视图、搜索、快捷操作与 Triage

目标：达到 Linear 日常操作的效率和信息组织体验。

#### 实现清单：默认视图与布局

- [ ] 为每个团队提供 All Issues、Active、Backlog 和 Archive 默认页。
- [ ] 提供 List 和 Board 两种布局并保存用户偏好。
- [ ] Board 默认按状态分组，支持拖拽改变状态和组内顺序。
- [ ] 支持按状态、负责人、Project、Priority、Cycle、Label、Parent 和 Team 分组。
- [ ] 支持手动、优先级、创建时间、更新时间和截止日期排序。
- [ ] 支持选择要展示的 Issue 属性并保存视图默认值。
- [ ] 支持隐藏空分组、折叠分组和 Board 列。
- [ ] 支持多选、范围选择、全选、拖动和批量操作工具栏。

#### 实现清单：筛选、视图和搜索

- [ ] 支持按核心 Issue 属性筛选，并允许多个筛选条件组合。
- [ ] 支持嵌套 AND/OR 高级筛选，但不实现 AI Filter。
- [ ] 筛选状态反映在 URL 中并可复制分享。
- [ ] 支持把筛选后的 Issue 或 Project 集合保存为 Custom View。
- [ ] 支持个人视图、团队共享视图、工作区共享视图和视图负责人。
- [ ] 支持收藏 Issue、Project、Cycle、View、Document 和 Initiative。
- [ ] 支持收藏夹分组和排序。
- [ ] 支持按 Issue ID、标题、描述和评论全文搜索。
- [ ] 支持在当前列表、看板和 Inbox 中快速筛选标题或 ID。
- [ ] 支持搜索 Issue、Project、Document、Team、User、Label 和 Favorite。

#### 实现清单：命令与键盘

- [ ] 提供上下文相关的 `Cmd/Ctrl + K` 命令面板。
- [ ] 支持 `C` 创建 Issue、`/` 搜索、`F` 筛选、`X` 选择、`Esc` 返回或清空选择。
- [ ] 支持键盘在列表和看板间移动焦点。
- [ ] 支持从命令面板修改 Issue 和 Project 核心属性。
- [ ] 支持 Undo 最近一次可逆的本地操作。
- [ ] 提供可搜索的快捷键帮助面板。

#### 实现清单：Triage

- [ ] 支持按团队启用或禁用 Triage。
- [ ] 来自外部团队、集成或 Triage 页面创建的 Issue 默认进入 Triage。
- [ ] 支持 Accept，并移入团队默认状态。
- [ ] 支持 Decline，并移入 Canceled 类别状态。
- [ ] 支持 Duplicate，并关联主 Issue。
- [ ] 支持 Snooze 到指定时间或新活动发生时重新出现。
- [ ] 支持配置 Triage 责任人和通知模式。
- [ ] 支持非 AI Triage Rules，按顺序匹配条件并设置团队、状态、负责人、Label、Project 和 Priority。

#### 验收清单

- [ ] 同一组 Issue 在 List 和 Board 中结果一致，视图切换不会丢失筛选、排序和分组。
- [ ] 拖动卡片后状态、排序、Activity 和另一个客户端实时同步。
- [ ] 高级筛选的 AND/OR 结果通过固定数据集测试验证。
- [ ] 共享 Custom View 对有权限用户可见，对私有团队数据继续执行权限裁剪。
- [ ] 全文搜索能命中标题、描述和评论，精确 Issue ID 可直接打开。
- [ ] 鼠标和键盘均可完成创建、筛选、选择、批量更新和打开 Issue 的完整流程。
- [ ] Triage 的 Accept、Decline、Duplicate 和 Snooze 四条路径均有 E2E 测试。
- [ ] 多条 Triage Rule 冲突时按明确顺序执行并有可读的执行记录。

### Phase 4：Cycles、Projects、Initiatives 与 Roadmap

目标：完成从短周期执行到公司级规划的层次化工作管理。

#### 实现清单：Cycles

- [ ] 支持按团队启用 Cycle。
- [ ] 支持配置 1–8 周时长、开始日、时区、Cooldown 和未来周期数量。
- [ ] 自动创建 Current、Upcoming 和后续 Cycle。
- [ ] 支持调整未来 Cycle 日期和立即开始下一 Cycle。
- [ ] 支持 Issue 加入和移出 Cycle。
- [ ] 支持周期结束时未完成 Issue 自动滚入下一周期。
- [ ] 支持 Started/Completed Issue 自动加入当前 Cycle 的可选规则。
- [ ] 展示 Issue 数、Estimate 总量、完成率、范围变化和成员分布。
- [ ] 使用最近三个已完成 Cycle 计算简单容量和速度。
- [ ] 支持查看当前、未来和历史 Cycle。

#### 实现清单：Projects

- [ ] 支持创建单团队或多团队 Project。
- [ ] 支持 Project 名称、Icon、Summary、Description、Lead、Members、Priority、Status、Labels、Start Date 和 Target Date。
- [ ] 支持自定义 Project Status，并使用 Backlog、Planned、In Progress、Completed、Canceled 类别。
- [ ] 支持 Issue 加入 Project，并保证一个 Issue 同时最多属于一个 Project。
- [ ] 提供 Project Overview、Issues、Resources 和 Updates 页面。
- [ ] 支持 Project 文档和外部资源链接。
- [ ] 支持 Milestone 名称、描述、日期、顺序和完成率。
- [ ] 支持 Issue 关联一个 Project Milestone。
- [ ] 支持 Project Template 预置属性、Milestone 和 Issue。
- [ ] 支持 Project 间 Blocking/Blocked by 的 end-to-start 依赖。
- [ ] 支持 Project List、Board 和 Timeline。
- [ ] Timeline 支持周、月、季度、年缩放以及日期拖拽。
- [ ] 展示 Project 进度、范围和完成 Issue 趋势；不实现 AI 预测。
- [ ] 支持 On track、At risk、Off track 健康更新。
- [ ] 支持 Project Update 历史、评论、Reaction 和提醒计划。

#### 实现清单：Initiatives

- [ ] 支持工作区启用或禁用 Initiatives。
- [ ] 支持 Initiative 名称、描述、状态、优先级、Label、Owner、Target Date 和 Resources。
- [ ] 支持把多个 Project 加入 Initiative。
- [ ] 支持 Parent/Sub-initiative 层级。
- [ ] 支持 Initiative List 和 Timeline。
- [ ] 汇总 Project 完成率、最新健康状态和最新更新。
- [ ] 支持 Initiative Update、评论、Reaction、历史和提醒计划。
- [ ] 对无权限用户隐藏 Initiative 中私有团队 Project 的名称和数据。

#### 验收清单

- [ ] 按团队时区模拟跨日后，Cycle 创建、关闭和滚动结果正确且幂等。
- [ ] Cycle 关闭后已完成、取消、Backlog 和未完成 Issue 的去向符合配置。
- [ ] Project 跨多个团队时，每个用户只能看到有权限团队的 Issue。
- [ ] Milestone 完成率与其关联 Issue 的 Completed 状态实时一致。
- [ ] Project 依赖在详情和 Timeline 双向显示，删除后同步消失。
- [ ] Project Update 和 Initiative Update 可追踪历史并通知订阅者。
- [ ] Initiative 汇总值可从关联 Project 和 Issue 数据重新计算得到。
- [ ] 从 Initiative 到 Project、Milestone、Issue 的导航形成完整可用链路。

### Phase 5：个人工作台、通知、报表、API 与集成

目标：完成个人效率、跨系统协作和数据可迁移性。

#### 实现清单：My Issues 与 Inbox

- [ ] My Issues 提供 Assigned、Created、Subscribed 和 Activity 标签。
- [ ] Assigned 视图按 Urgent、Blocked、Current Cycle、Other Active、Triage、Backlog 等聚合展示。
- [ ] 创建 Issue、被指派或被提及时自动订阅。
- [ ] 支持手动订阅、退订和管理订阅者。
- [ ] Inbox 展示 Mention、Comment、Assignment、Status、Relation、Due Date 和 Reminder 等事件。
- [ ] 支持 Inbox 已读/未读、删除、批量已读和搜索。
- [ ] 支持 Snooze Inbox 通知。
- [ ] 支持为 Issue、Document、Project 和 Initiative 设置、修改和取消 Reminder。
- [ ] 支持用户按事件类型配置站内和邮件通知。
- [ ] 支持邮件即时发送和摘要模式，未配置 SMTP 时安全降级为站内通知。

#### 实现清单：报表

- [ ] 支持从当前 View 的过滤结果生成 Insight。
- [ ] 支持 Issue Count 和 Estimate Effort 指标。
- [ ] 支持 Team、Status、Assignee、Priority、Label、Project、Cycle 和时间维度。
- [ ] 提供柱状图、趋势图、Burn-up/Cumulative Flow 和数据表。
- [ ] 支持点击图表维度下钻到对应 Issue 列表。
- [ ] 支持分享 Insight 链接和导出 CSV。
- [ ] 提供 Cycle 和 Project 的预置进度报表。

#### 实现清单：API、Webhook 与迁移

- [ ] 提供带权限范围和团队范围的 Personal API Token。
- [ ] 提供核心实体的查询和写入 API；协议可使用 REST 或 GraphQL。
- [ ] API 写入与 Web UI 使用相同授权、校验和 Activity 逻辑。
- [ ] 支持 Issue、Comment、Attachment、Document、Project、Project Update、Cycle、Label 和 User Webhook。
- [ ] Webhook 包含事件类型、当前数据、变更前值和稳定事件 ID。
- [ ] 支持签名校验、重试、投递日志和手动重放。
- [ ] 支持 CSV 导入 Issue，并映射用户、状态、Label、Estimate、Due Date、Project 和关系。
- [ ] 支持工作区、当前 View、Project 和 Initiative CSV 导出。
- [ ] 支持导入预检、错误报告和可回滚的批次记录。

#### 实现清单：Git 与消息入口

- [ ] GitHub 首版支持安装或 Token 配置以及 Repository 绑定。
- [ ] 通过 Issue ID、分支名或 Magic Word 关联 PR 和 Commit。
- [ ] 在 Issue 中显示 PR 链接、状态、作者、Review 和 CI 状态。
- [ ] 支持按 PR Draft、Open、Review、Ready、Merged 事件更新 Issue 状态。
- [ ] 支持为不同目标分支配置不同状态规则。
- [ ] GitLab 复用相同的数据模型和 Webhook 流程。
- [ ] Slack 首版支持从消息创建 Issue、公开对象链接预览和个人/团队通知。
- [ ] 支持团队或模板专属邮件地址创建 Issue，并附带原邮件链接和附件。

#### 验收清单

- [ ] 两名用户对同一 Issue 的订阅状态相互独立，通知只发送给应接收者。
- [ ] Snooze 和 Reminder 在目标时间恢复，取消后不再发送。
- [ ] 关闭邮件通道不会影响站内 Inbox，邮件失败可重试且不重复发送。
- [ ] Insight 指标可通过数据库查询独立复算，筛选后图表和表格总数一致。
- [ ] API Token 无法越权读取私有团队或执行未授予的写操作。
- [ ] 重复发送同一个 Webhook 事件不会重复推进 Issue 状态。
- [ ] CSV 导入后核心字段和关系正确，导出后可再次导入且无结构性丢失。
- [ ] GitHub 测试仓库中的 PR 从创建到合并可按配置推动 Issue 工作流。
- [ ] Slack 和邮件入口创建的 Issue 正确进入目标团队、模板或 Triage。

### Phase 6：非 AI 的完整性增强

这些功能属于当前 Linear 的非 AI 产品能力，但不是完成基础 Issue/Project 工作流的前置条件。基础阶段验收全部通过后再实现。

#### Customer Requests

- [ ] 支持 Customer 名称、Domain、Logo、Revenue、Tier、Size 和状态。
- [ ] 支持把一条 Customer Request 关联到 Issue 或 Project。
- [ ] 支持 Customer 页面以及按请求数量、收入、Tier 和 Size 筛选。
- [ ] 支持从 Slack、邮件或客服集成保留请求来源链接。
- [ ] 验收：同一客户的所有请求可汇总，私有团队权限不会通过客户页泄露。

来源：[Customer Requests](https://linear.app/docs/customer-requests)

#### SLA

- [ ] 支持按 Issue 属性配置有顺序的 SLA 添加和移除规则。
- [ ] 支持小时、自然日和工作日时长。
- [ ] 支持 Low risk、Medium risk、High risk、Breached、Achieved 和 Failed 状态。
- [ ] 支持临近和违反 SLA 通知。
- [ ] 保证 SLA 与 Due Date 互斥。
- [ ] 验收：可用模拟时钟证明 SLA 计算、规则顺序和通知时间正确。

来源：[SLAs](https://linear.app/docs/sla)

#### Releases

- [ ] 支持 Continuous 和 Scheduled Release Pipeline。
- [ ] 支持 Pipeline、Release、Stage、Commit SHA、Environment 和 Issue 关联。
- [ ] 支持 CI Access Key 和幂等的 Release 上报 API。
- [ ] 支持根据 Release Stage 或完成事件更新 Issue 状态。
- [ ] 支持人工编写 Release Notes 和按时间展示 Changelog。
- [ ] 不实现 AI 生成 Release Notes。
- [ ] 验收：测试流水线可连续上报 Release，并正确关联 Commit 中出现的 Issue ID。

来源：[Releases](https://linear.app/docs/releases)

#### Dashboards

- [ ] 支持把多个 Insight 放到一个 Dashboard。
- [ ] 支持图表、指标卡和表格组件。
- [ ] 支持 Dashboard 级和组件级筛选。
- [ ] 支持个人、团队和工作区 Dashboard。
- [ ] 验收：Dashboard 中的每个指标均可下钻到来源数据，权限裁剪正确。

来源：[Dashboards](https://linear.app/docs/dashboards)

## 5. 全局完成标准

只有满足以下全部条件，才能认为“非 AI 的 Linear 基础复刻”完成：

- [ ] Phase 0 至 Phase 5 的所有实现和验收项均通过。
- [ ] 核心用户旅程具有 E2E 覆盖：邀请成员 → 创建团队 → 创建 Issue → 评论与指派 → 进入 Cycle/Project → 完成 → 查看通知和报表。
- [ ] 私有团队、Guest、附件、搜索、导出、API 和 Webhook 均完成越权测试。
- [ ] 两个并发客户端中的核心写操作在 2 秒内同步。
- [ ] 使用 100 个用户、50,000 条 Issue、20 个同时在线会话进行基础容量验证。
- [ ] 常用列表和详情 API 的 P95 响应时间低于 500ms；全文搜索在测试数据集上低于 1 秒。
- [ ] 后台任务、通知、Webhook、导入和 Git 事件均经过失败重试及幂等测试。
- [ ] 数据库可备份和恢复，恢复演练后实体关系、附件引用和权限不丢失。
- [ ] 无任何基础业务流程依赖 LLM、AI 服务或 AI 额度。
- [ ] README 包含启动、配置、迁移、备份、测试和部署说明。

## 6. 官方资料索引

- [Linear Docs 首页](https://linear.app/docs)
- [Teams](https://linear.app/docs/teams)
- [Create issues](https://linear.app/docs/creating-issues)
- [Issue status](https://linear.app/docs/configuring-workflows)
- [Issue relations](https://linear.app/docs/issue-relations)
- [Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)
- [Issue templates](https://linear.app/docs/issue-templates)
- [Editor](https://linear.app/docs/editor)
- [Comments and reactions](https://linear.app/docs/comment-on-issues)
- [Custom Views](https://linear.app/docs/custom-views)
- [Filters](https://linear.app/docs/filters)
- [Search](https://linear.app/docs/search)
- [Triage](https://linear.app/docs/triage)
- [Cycles](https://linear.app/docs/use-cycles)
- [Projects](https://linear.app/docs/projects)
- [Project overview](https://linear.app/docs/project-overview)
- [Project milestones](https://linear.app/docs/project-milestones)
- [Project dependencies](https://linear.app/docs/project-dependencies)
- [Project templates](https://linear.app/docs/project-templates)
- [Initiatives](https://linear.app/docs/initiatives)
- [Timeline](https://linear.app/docs/timeline)
- [Inbox](https://linear.app/docs/inbox)
- [Notifications](https://linear.app/docs/notifications)
- [Insights](https://linear.app/docs/insights)
- [API and Webhooks](https://linear.app/docs/api-and-webhooks)
- [Importer](https://linear.app/docs/import-issues)
- [Exporting Data](https://linear.app/docs/exporting-data)
