# Micro Linear 当前实现状态

更新时间：2026-07-11。本文描述当前仓库中已经实现的功能与交付边界，适用于单实例、100 人以内的自托管团队。

## 已交付的核心闭环

- 账号与权限：首位管理员注册、密码登录/修改、邀请加入、会话注销、Admin/Member/Guest、成员停用、公开/私有团队及服务端对象权限。
- Issue：创建与编辑、团队工作流、负责人、优先级、估算、截止日期、Label、Cycle、Project、Milestone、跨团队移动、父子任务、关系、订阅、归档、回收站和 Triage。
- 协作：Markdown 描述、受保护附件、评论与回复、编辑/删除、Resolve/Reopen、Reaction、提及通知和活动时间线。
- 复用与自动化：工作区/团队模板、模板子任务、重复 Issue、Cycle 自动滚动及到期站内提醒、Triage Snooze 唤醒。
- 规划：Cycle、Project、Milestone、Project Update、Initiative、Roadmap/时间线和基础 Insights。
- 工作台：My Issues、Inbox、通知偏好、全局搜索、自定义 View、列表/看板、筛选/排序、响应式侧栏和常用快捷键。
- 文档：工作区共享文档的创建、Markdown 编辑、搜索、删除权限及 Issue/Project 关联。
- 管理与集成：工作区/团队/成员设置、API Key 与作用域、REST API v1、签名 Webhook、CSV 导入导出、审计日志、Activity、Outbox 和 SSE 失效同步。
- 运维：SQLite WAL、迁移、健康检查、结构化请求日志、后台任务执行器、在线备份、完整性检查、隔离恢复演练、生产环境安全预检和单机 Docker Compose。

## 当前边界

以下内容不在本次交付中，不能视为已实现：

- 所有 AI 能力，包括自然语言筛选、智能 Triage、自动摘要、Agent、自动编码和 AI Release Notes。
- GitHub/GitLab 双向状态同步、Slack/Teams 消息适配器、邮件收件入口与邮件通知。
- Linear 企业版能力，例如 SSO/SAML/SCIM、高级审计导出、细粒度自定义角色、多地域及多实例高可用。
- Customer Requests、SLA 管理、Release 管理及可自由配置的高级 Dashboard。
- 文档版本历史、文档内联评论，以及 Project/Initiative Update 的完整评论与 Reaction 体系。
- 原生桌面/移动客户端和离线编辑；当前交付为响应式 Web 应用。

## 规模与部署假设

- 单个 Node.js 应用实例、单个 SQLite 写入实例、单个持久化数据卷。
- 目标规模为一个工作区最多 100 名成员；成员邀请与接受流程会在服务端执行上限检查。
- SSE 使用进程内事件总线，因此不能直接横向扩展多个 Web 实例。若未来需要多实例，应迁移到 PostgreSQL，并使用共享消息通道。
- 后台任务由外部 cron 每分钟调用一次；应用自身不包含常驻调度器。

## 验证口径

交付前执行以下门禁：

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

`docs/FEATURES.md` 保留为后续产品演进的研究矩阵，其中未勾选条目不代表当前版本缺陷，也不代表已经交付。
