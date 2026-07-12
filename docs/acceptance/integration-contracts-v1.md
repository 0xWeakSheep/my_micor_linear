# Integration contracts v1 验收记录

- 日期：2026-07-12
- 分支：`fix/integration-contracts-v1`
- 远程：`git@github.com:0xWeakSheep/my_micor_linear.git`

## 本版本范围

- README 补充仓库标题 `my_micor_linear`。
- 修复 `issue.deleted` 订阅事件与实际 Outbox 事件不一致的问题。
- Webhook 密钥解密失败按退避策略记录和重试，达到上限后终止。
- 前后端共用 Webhook 事件目录；保存前校验 HTTPS 端点；旧 Webhook 明示签名密钥状态。
- 应用启动时自动运行非重叠后台任务，保留手工执行器和外部 cron 模式。
- 修复私有项目文档、Issue 项目关联和工作区导入的私有资源越权路径。
- REST Issue 写入发布 SSE 失效事件；PATCH 要求读写作用域并拒绝空更新。
- REST JSON 写入校验媒体类型，并对无 `Content-Length` 的请求执行流式字节限制。
- 通用动作接口的 500 响应不再返回数据库内部错误。
- 重复 Cycle 编号返回明确冲突。
- 工作区 JSON 显式校验新旧 v1 版本和内层实体结构；来源编号作为 alias 保证重试幂等。
- 设置页改用专用导入、导出路由，并显示跳过项与警告。
- 备份完整性检查要求核心表和有效迁移历史；列表会识别缺失或大小异常的文件。
- Playwright 支持独立测试端口，避免复用其他项目的本地服务。

## 验证结果

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run test`：36 个测试文件、170 个测试全部通过。
- `npm run build`：Next.js 16.2.10 生产构建通过。
- `PLAYWRIGHT_BASE_URL=http://localhost:3100 PLAYWRIGHT_WEB_SERVER_COMMAND='npm run dev -- -p 3100' npm run test:e2e`：5 项通过，3 项为按设备设计的预期跳过。
- `npm run db:integrity`：SQLite integrity、外键和 4 个迁移均通过。

## 后续版本边界

- 为 REST 列表增加稳定游标分页和直接资源查询，避免构造完整 Bootstrap 数据图。
- 补齐 Project 与 Webhook REST CRUD，或移除当前不可用的写作用域。
- 增加 Webhook 投递历史、手动重放、签名协议说明和 DNS 绑定防护。
- 继续扩展工作区快照导入，覆盖 Initiative、Document、Milestone、附件、模板和视图等对象。
- 增加停机状态下的原子恢复命令和更完整的备份耐久性检查。
