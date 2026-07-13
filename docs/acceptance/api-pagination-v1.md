# API pagination v1 验收记录

- 日期：2026-07-13
- 分支：`feat/api-pagination-v1`
- 远程：`git@github.com:0xWeakSheep/my_micor_linear.git`

## 本版本范围

- 为 Issue、Project、Team、Member 四个 REST 列表增加游标分页。
- `limit` 默认 50、最大 100；使用 `limit + 1` 查询判断是否存在下一页。
- 游标使用版本化、不透明的 base64url 载荷，并绑定资源类型和工作区。
- 空、损坏、重复、跨资源、跨工作区或结构错误的游标返回 400 `invalid_pagination`。
- 列表响应保留 `meta.count` 与 `meta.workspaceId`，并增加 `meta.pageInfo`。
- Issue 按 `updated_at DESC, id ASC` 直接查询，保留私有团队、回收站、Label 和订阅者的原可见性规则。
- Project 按 `sort_order, name COLLATE NOCASE, id` 直接查询；多团队 Project 只返回可见团队，不可见的主团队会置空。
- Team 按 `name COLLATE NOCASE, id` 直接查询；管理员不会绕过私有团队成员要求。
- Admin/Member 的 Member 列表按 `name COLLATE NOCASE, membership id` 直接查询；Guest 保留完整的受限成员可见集合后再分页，避免目录泄露。
- README 已补充分页请求、响应、排序、错误码和 PATCH 双作用域要求。
- 完整门禁发现构建会在线下载 Google 字体；已改为系统字体栈，使生产构建不依赖外部字体网络。

## 契约摘要

```text
GET /api/v1/issues?limit=50&cursor=<opaque>
GET /api/v1/projects?limit=50&cursor=<opaque>
GET /api/v1/teams?limit=50&cursor=<opaque>
GET /api/v1/members?limit=50&cursor=<opaque>
```

```json
{
  "data": [],
  "meta": {
    "count": 0,
    "workspaceId": "ws_example",
    "pageInfo": {
      "limit": 50,
      "hasNextPage": false,
      "endCursor": null
    }
  }
}
```

`count` 表示本页条数。调用方只在 `hasNextPage` 为 `true` 时继续传递 `endCursor`。Issue 的更新时间是可变排序键，因此连续翻页提供稳定键集边界，但不承诺跨并发更新的快照一致性；这符合当前单实例、百人以内的产品规模。

## 验证结果

- `npm run check`：通过。
  - TypeScript：通过。
  - ESLint：通过。
  - Vitest：37 个测试文件、180 项测试全部通过。
  - Next.js 16.2.10 生产构建：通过，且不再请求 Google Fonts。
- `PLAYWRIGHT_BASE_URL=http://localhost:3100 PLAYWRIGHT_WEB_SERVER_COMMAND='npm run dev -- -p 3100' npm run test:e2e`：5 项通过，3 项为按设备设计的预期跳过。
- `npm run db:integrity`：SQLite integrity 为 `ok`，外键违规为 0，迁移 1–4 有效。

## 后续版本边界

- 补齐 Project 与 Webhook REST CRUD，或移除当前没有对应端点的写作用域。
- 增加 Webhook 投递历史、手动重放、签名协议说明和 DNS 绑定防护。
- 继续扩展工作区快照导入，覆盖规划、文档、附件、模板和视图对象。
- 增加停机状态下的原子恢复命令和更完整的备份耐久性检查。
