# Webhook 接收协议

Micro Linear 会把已订阅的工作区事件以 HTTP POST 发送到管理员配置的 HTTPS 端点。生产接收端应把每次请求视为“至少一次”投递：同一事件可能重复到达，不同事件也不保证严格有序。

## 请求

请求使用 `Content-Type: application/json`，主要 Header 如下：

| Header | 说明 |
| --- | --- |
| `X-Micro-Linear-Event` | 事件类型，例如 `issue.updated` |
| `X-Micro-Linear-Delivery` | 稳定投递键，格式为 `<webhookId>:<originalEventId>` |
| `Idempotency-Key` | 与 `X-Micro-Linear-Delivery` 相同，便于通用中间件去重 |
| `X-Micro-Linear-Signature` | `sha256=<hex>`，见下方签名校验 |

Body 是以下结构的 JSON：

```json
{
  "id": "outbox_...",
  "type": "issue.updated",
  "createdAt": "2026-07-17T01:00:00.000Z",
  "workspaceId": "ws_...",
  "resource": {
    "type": "issue",
    "id": "issue_..."
  },
  "data": {}
}
```

`id` 是原事件 ID。自动重试会逐字节复用第一次保存的请求 Body。管理员手动重放也会复用原始 Body、原事件 ID、签名输入和幂等键，只会建立新的内部重试任务；因此接收端可以用 `Idempotency-Key` 阻止重复副作用。

## 签名校验

创建 Webhook 或轮换密钥时，管理界面只显示一次 `whsec_...` 签名密钥。签名计算方式为：

```text
hex_hmac_sha256(signing_secret, raw_request_body_bytes)
```

服务端发送：

```text
X-Micro-Linear-Signature: sha256=<64 位小写十六进制摘要>
```

接收端应遵循以下顺序：

1. 在 JSON、中间件或字符编码转换前保留原始 Body 字节。
2. 使用签名密钥计算 HMAC-SHA256。
3. 确认 Header 以 `sha256=` 开头，并解码 64 位十六进制摘要。
4. 使用常量时间比较函数校验收到的摘要与计算结果。
5. 校验成功后再解析 JSON，并按 `Idempotency-Key` 原子记录是否已处理。

不要把普通字符串比较、重新序列化后的 JSON 或 `secret_hash` 用作签名输入。轮换密钥会立即使旧密钥失效，应先部署能读取新密钥的接收端，再在管理界面执行轮换。

## 成功、重试与终止

- 任意 `2xx` 响应视为成功。
- `408`、`409`、`425`、`429` 和 `5xx` 会按指数退避重试。
- 合法的 `Retry-After` 秒数或 HTTP 日期会优先用于上述可重试响应，但仍受最大退避时间限制。
- 网络错误、DNS 临时错误和请求超时会重试。
- 其他 `4xx`、不安全的目标 URL、停用的目标 Webhook 或缺失签名密钥会终止该次投递。
- 默认最多尝试 8 次；投递记录会保存每次 attempt、HTTP 状态、受限长度的错误摘要和下一次计划时间。

接收端应尽快返回响应，把耗时业务放入自己的持久队列。即使已做租约保护，进程故障与网络边界仍决定了 Webhook 无法承诺“恰好一次”；幂等处理是接收端协议的一部分。

## 手动重放

工作区管理员可以在 Webhook 的“投递记录”中重放最新的最终失败记录。以下情况不能重放：

- 投递仍在排队或自动重试；
- 投递已经成功；
- 同一原事件已有更新的重放；
- Webhook 已停用，或签名密钥不可用；
- 原事件仍在处理，或必要的事件记录已不可恢复。

重放只发送到原来的目标 Webhook，不会广播到工作区中的其他订阅端点。重放排队、执行和结果都保留在投递历史与审计日志中。

## 端点安全要求

生产 Webhook 必须使用不含用户名、密码或 URL fragment 的 HTTPS 地址。每次投递前会拒绝解析为环回、私网、链路本地或其他非公网地址的主机，请求也不会跟随重定向。本地开发可显式设置 `MICRO_LINEAR_WEBHOOK_ALLOW_INSECURE_LOCALHOST=1`；不要在生产环境启用该选项。
