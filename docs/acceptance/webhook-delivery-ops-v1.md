# Webhook delivery ops v1 验收记录

- 日期：2026-07-17
- 分支：`feat/webhook-delivery-ops-v1`
- 远程：`git@github.com:0xWeakSheep/my_micor_linear.git`

## 本版本范围

- 新增管理员可访问的 Webhook 投递历史接口，使用绑定工作区与 Webhook 的不透明游标，默认 20 条、最大 50 条。
- 投递历史明确区分排队、重试、成功和最终失败；不返回请求 Body 或成功响应正文，失败摘要限制为 1024 字符。
- 设置页新增投递记录对话框，覆盖首屏加载、错误恢复、空态、分页去重、进行中轮询、请求中止、失败原因和手动重放。
- 手动重放只允许最新的最终失败记录，由服务端重新验证管理员权限、Webhook 状态、签名密钥、原事件状态和更新重放冲突。
- 重放逐字节复用根投递请求 Body、原事件 ID、签名输入和稳定幂等键，只投递到原目标 Webhook。
- 迁移 5–7 增加投递操作字段、活跃重放唯一约束和不可变原事件身份；历史重放链会归一化并拒绝环或冲突身份。
- Webhook worker 改为逐事件领取并使用唯一租约 token；所有 delivery 与 outbox 结果写入都经过 fencing，失租 worker 不能覆盖接管结果。
- 后台结果增加失租计数，并只统计本轮实际记录的成功、重试和终态失败，避免多 Webhook 重试时重复计数。
- 补充接收协议、HMAC-SHA256 原始字节签名、重试状态、`Retry-After`、幂等处理和手动重放说明。

## 关键提交

- `ece63e9`：投递历史查询。
- `5146341`–`4bc0b62`：安全重放、链归一化与不可变原事件身份。
- `e114ee9`：Webhook 设置编辑校验。
- `3c78ab0`：Webhook 接收协议。
- `ce056ea`：投递历史路由权限回归。
- `fb0663c`：worker 租约 fencing。
- `95a898e`：投递历史管理界面。
- `8e23556`：失租可观测性与准确结果统计。

## 验证结果

- `npm run check`：通过。
  - TypeScript 与 ESLint：通过。
  - Vitest：42 个测试文件、219 项测试全部通过。
  - Next.js 16.2.10 生产构建：通过。
- `PLAYWRIGHT_BASE_URL=http://localhost:3100 PLAYWRIGHT_WEB_SERVER_COMMAND='npm run dev -- -p 3100' npm run test:e2e`：5 项通过，3 项为按设备设计的预期跳过；包含拖动 Issue 改变状态并在刷新后保持。
- `npm run db:integrity`：SQLite integrity 为 `ok`，外键违规为 0，迁移 1–7 有效。
- 本地页面实测：管理员进入“API 与 Webhooks”后可打开投递记录；首屏返回 20 条，游标继续加载 3 条，无浏览器控制台错误。
- 并发回归：旧 worker 请求悬挂并失租后，新 worker 接管并写入 202；旧 worker 后续返回 503 时无法覆盖接管结果。

## 交付边界

- Webhook 是至少一次投递。请求已经发出但响应未知时，接管 worker 仍可能重复发送；接收端必须按稳定 `Idempotency-Key` 原子去重。
- 发送前会解析域名并拒绝私网、环回和链路本地地址，但 DNS 校验与实际连接之间仍存在解析变化窗口。面向不受信任租户开放前，应使用固定解析结果的网络客户端或出口代理进一步消除 DNS rebinding 风险。
- 当前事件目录覆盖 Issue、Comment、Project、Project Update 和 Member 的已实现事件，不宣称已经覆盖附件、文档、Cycle、Label 等全部研究矩阵事件。
- 投递历史是管理员运维能力，不提供请求 Body 回显或成功响应正文浏览，避免设置页成为敏感数据导出通道。
