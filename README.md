# my_micor_linear

产品名称：Micro Linear

Micro Linear 是一个面向 100 人以内团队的 Linear 风格产品协作系统。它覆盖 Issue、团队工作流、Triage、Cycle、Project、Initiative、View、Inbox、搜索、通知、报表和管理设置，不包含任何 AI 功能。

> 本项目是独立实现，与 Linear 公司没有关联。当前交付状态见 [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)；[`docs/FEATURES.md`](docs/FEATURES.md) 是依据公开 Linear 文档整理的产品研究清单，不代表每一项均已实现。

## 本地启动

要求：Node.js 22.13+ 或 24+、npm 10+。应用使用 Node 内置 SQLite，数据默认保存在 `.data/micro-linear.db`。

```bash
npm install
npm run db:seed
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，使用演示账户：

```text
邮箱：demo@micro-linear.local
密码：demo12345
```

种子脚本只用于本地演示：空数据库会被初始化；已经包含演示数据时不做任何修改；其他非空数据库会被安全拒绝。只有明确要抹掉并重建本地演示库时，才使用 `npm run db:seed -- --reset`；`NODE_ENV=production` 下种子命令始终拒绝运行。健康检查和生产请求绝不会创建演示账户或已知凭证。

真实部署不需要种子数据：直接启动空数据库，然后在 `/signup` 创建首个工作区管理员。此后公开注册会自动关闭，新成员必须使用管理员生成的邀请链接加入；只有显式设置 `MICRO_LINEAR_ALLOW_PUBLIC_SIGNUP=1` 才会重新开放多工作区自助注册。登录页不会预填或展示演示凭证。

## 常用命令

```bash
npm run dev          # 开发服务器
npm run build        # 生产构建
npm start            # 启动生产服务器
npm run db:seed      # 初始化演示数据
npm run typecheck    # TypeScript strict 检查
npm run lint         # ESLint
npm test             # Vitest 单元测试
npm run test:e2e     # Playwright 浏览器测试
npm run db:init      # 仅迁移/检查数据库，不写演示数据
npm run check        # 完整质量门禁
```

## REST API v1

Micro Linear 提供面向内部自动化的 REST API，基础地址为 `/api/v1`。API Key 在工作区设置中创建，密钥只展示一次；调用时通过标准 Bearer Header 传递：

```bash
curl 'http://localhost:3000/api/v1/issues?limit=50' \
  -H 'Authorization: Bearer ml_demo_seed_token'
```

`ml_demo_seed_token` 仅是本地种子数据中的演示密钥，拥有 `issues:read`、`issues:write` 和 `projects:read`。生产环境请创建并妥善保管独立密钥，不要把它提交到代码仓库。

| Method | Path | Scope | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/issues` | `issues:read` | 列出可见 Issue |
| `GET` | `/api/v1/issues/:id` | `issues:read` | 按 ID 或 `ENG-123` 标识读取 Issue |
| `POST` | `/api/v1/issues` | `issues:write` | 创建 Issue |
| `PATCH` | `/api/v1/issues/:id` | `issues:read` + `issues:write` | 更新 Issue |
| `GET` | `/api/v1/projects` | `projects:read` | 列出可见 Project |
| `GET` | `/api/v1/teams` | `workspace:read` | 列出可见 Team |
| `GET` | `/api/v1/members` | `workspace:read` | 列出可见工作区成员 |

创建 Issue 时，Body 与现有 Issue 模型一致，`teamId` 和 `title` 必填；更新时直接提交需要改变的字段：

```bash
curl -X POST http://localhost:3000/api/v1/issues \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  --data '{"teamId":"team_eng","title":"Investigate checkout timeout","priority":2}'

curl -X PATCH http://localhost:3000/api/v1/issues/issue_eng_102 \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  --data '{"title":"Investigate payment timeout","assigneeId":"usr_maya"}'
```

成功响应使用 `{ "data": ... }`。四个列表端点都支持 `limit`（默认 50，范围 1–100）和不透明的 `cursor`；服务端使用 `limit + 1` 查询判断是否存在下一页，不会为简单列表构造完整工作区数据图：

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

`meta.count` 是本页条数；有下一页时，将 `meta.pageInfo.endCursor` 原样作为下一次请求的 `cursor`。Issue 按更新时间倒序，Project 按手工顺序和名称，Team/Member 按名称排序，所有排序都以 ID 作为最终稳定顺序。游标绑定资源类型和工作区，损坏、跨资源、跨工作区、空游标或非法 `limit` 会返回 400 `invalid_pagination`。

API Key 固定绑定创建它的用户和工作区，URL 或 Body 不能切换工作区；现有 RBAC、私有团队可见性、Guest 成员目录裁剪、成员停用状态和密钥过期时间仍会在服务端强制执行。

错误响应格式统一，并通过 `X-Request-Id` 响应头返回同一个请求 ID：

```json
{
  "error": {
    "code": "validation_error",
    "message": "Status does not belong to the issue team.",
    "requestId": "req_..."
  }
}
```

常见错误码为 `authentication_required` / `invalid_token`（401）、`insufficient_scope` / `forbidden`（403）、`not_found`（404）、`conflict`（409）、`invalid_json` / `invalid_pagination` / `validation_error`（400）和 `internal_error`（500）。所有 API 响应均带 `Cache-Control: no-store`；有效密钥的 `last_used_at` 会在鉴权时更新。

## 架构

- Next.js 16 App Router、React 19、TypeScript strict
- 模块化单体：认证、工作区、Issue、规划、视图、通知和集成保持清晰服务边界
- SQLite WAL：适合单实例、百人以内部署；所有关键批量写入使用事务
- 自定义安全会话：scrypt 密码哈希、仅存哈希的随机 Session Token、HttpOnly/SameSite Cookie
- RBAC + 团队权限：Admin、Member、Guest，私有团队在服务端裁剪
- SSE 实时失效通知：客户端收到最小事件后重新读取有权限的数据
- Activity、Audit、Outbox：业务变更、审计与后续 Webhook/后台任务共用一致事件链路
- Vitest + Playwright：纯领域规则、权限和核心浏览器流程

## 数据与备份

开发数据库位于 `.data/micro-linear.db`，附件位于 `.data/uploads`；可分别通过 `MICRO_LINEAR_DB_PATH` 和 `MICRO_LINEAR_UPLOAD_DIR` 修改。生产环境必须把两者放在持久化磁盘，并保持单个 SQLite 写入实例。升级自旧品牌版本时会自动读取原 `.data/orbit.db` 及旧 `ORBIT_*` 变量，避免迁移后打开空库。

执行在线备份：

```bash
npm run db:backup
npm run db:backups
```

备份使用 SQLite `VACUUM INTO` 获取一致性快照，不依赖系统安装 `sqlite3`。每次生成一个新的、拒绝覆盖的目录包，默认位于 `MICRO_LINEAR_BACKUP_DIR`（`.data/backups`），内容包括：

- `micro-linear.sqlite`：经过完整 `integrity_check` 和外键检查的数据库快照；
- `uploads/`：数据库快照中每条 `files.storage_key` 引用的附件；
- `manifest.json`：数据库/附件 SHA-256、大小、迁移版本和核心表计数。

单独执行线上库完整检查，或在隔离临时目录进行恢复演练：

```bash
npm run db:integrity
npm run db:restore-verify -- --backup .data/backups/micro-linear-backup-20260711T020000Z-abcd1234
```

`db:restore-verify` 会复制数据库和附件到系统临时目录，验证 manifest、哈希、SQLite 完整性、外键、迁移升级及每个附件引用，默认完成后删除临时目录。它不会覆盖 `MICRO_LINEAR_DB_PATH` 或 `MICRO_LINEAR_UPLOAD_DIR`。需要检查成功恢复出的临时文件时可加 `--keep-temporary`。

建议每天执行 `db:backup`、每周执行 `db:integrity`，并把完整备份目录同步到另一块磁盘或对象存储。正式恢复前：停止 Web 与后台任务；保留当前数据库和 uploads 副本；先通过恢复演练；再把备份内容复制到新的空路径并临时调整 `MICRO_LINEAR_DB_PATH` / `MICRO_LINEAR_UPLOAD_DIR` 验证启动。Webhook 加密密钥、认证 pepper 等环境变量不在备份包中，必须由密钥管理系统单独备份。

## 请求日志与排障

`/api/health`、`/api/actions` 和 REST API v1 会返回 `X-Request-Id`，并向进程标准输出/错误输出写一行一个 JSON 的结构化请求完成日志，包括 operation、method、path、status 和 durationMs。合法的上游 `X-Request-Id` 或 W3C `traceparent` 会被继承，便于从反向代理一路关联到应用日志；查询参数和请求 Body 不会写入请求日志。

健康检查使用轻量 `PRAGMA quick_check`，适合负载均衡器探活；深度数据库检查使用 `npm run db:integrity`。生产环境应采集 Node 进程 stdout/stderr，并按 `requestId`、`status >= 500` 和 `event=http.request.completed` 建立检索与告警。

## 后台任务

重复 Issue、Cycle 到期/提醒和 Outbox Webhook 默认由 Web 进程内的单实例调度器处理，启动后会立即运行，之后默认每 5 秒执行一次。可通过 `MICRO_LINEAR_BACKGROUND_JOBS_INTERVAL_MS` 调整为 1–300 秒。

以下一次性执行器仍可用于手工排障：

```bash
npm run jobs:run
npm run jobs:run -- --help
```

如果希望改用系统 cron，先设置 `MICRO_LINEAR_BACKGROUND_JOBS_DISABLED=1`，再用系统锁避免同一实例重叠执行。例如 Linux cron：

```cron
* * * * * cd /srv/micro-linear && flock -n /tmp/micro-linear-jobs.lock npm run jobs:run >> /var/log/micro-linear-jobs.log 2>&1
```

执行器本身也会用数据库锁令牌协调并发，失败的 Webhook 按指数退避重试；不可恢复或达到上限的投递会保留 delivery/outbox 错误记录，并使该次 CLI 返回非零状态。Webhook 默认只投递到解析为公网地址的 HTTPS URL，且不跟随重定向。仅本地开发可设置 `MICRO_LINEAR_WEBHOOK_ALLOW_INSECURE_LOCALHOST=1`。

生产环境必须设置并长期保存 `MICRO_LINEAR_WEBHOOK_ENCRYPTION_KEY`。它用于加密 Webhook 签名密钥；恢复备份时也必须恢复同一个值，否则已有签名密钥无法解密。

## 环境变量

复制 `.env.example` 为 `.env.local`。开发环境可以不设置 pepper；生产环境必须使用独立随机值，并在轮换前安排会话失效策略。

`MICRO_LINEAR_DEMO_MODE=1` 只会在 `next dev` 下允许空库自动载入演示数据，生产模式始终忽略它。建议日常也显式执行 `npm run db:seed`，不要在真实数据环境启用演示模式。

```bash
cp .env.example .env.local
```

`npm start` 会先执行安全预检：`APP_URL` 必须是合法公开 Origin（非本机必须 HTTPS），`AUTH_PASSWORD_PEPPER`、`AUTH_TOKEN_PEPPER` 和 `MICRO_LINEAR_WEBHOOK_ENCRYPTION_KEY` 必须分别使用至少 32 个字符的独立随机值，并且不能启用演示模式。可分别使用 `openssl rand -base64 48` 生成。预检不通过时生产进程会拒绝启动。

### 旧版本兼容

从旧品牌版本升级时无需立即改动存量数据：应用会继续读取旧 `ORBIT_*` 环境变量、数据库默认路径、Session Cookie、Webhook 加密密文和 v1 备份包；Webhook 投递会同时发送新旧签名 Header，已有 `orb_` API Key 也保持有效。新创建的配置和凭证只使用 Micro Linear 命名。

## 部署说明

SQLite 和内存 SSE 事件总线要求应用运行在有持久化磁盘的长驻 Node.js 实例上，不适合把数据库放在无状态 Serverless 临时文件系统中。100 人内推荐：

1. 单台 Node.js 进程或容器；
2. 挂载持久化卷保存 `.data/`；
3. Nginx/Caddy 终止 TLS，并关闭 SSE 响应缓冲；
4. 定时执行数据库在线备份；
5. 如未来需要多实例，再把存储适配到 PostgreSQL，并将事件总线替换为共享通道。

生产安装可以使用 `npm ci --omit=dev`；运行数据库运维和后台任务所需的 `tsx` 已列入运行时依赖。反向代理还应把请求体上限设置为约 26 MB（附件）或更小，并以独立系统用户、受限文件权限运行应用。

仓库同时提供单机 Docker Compose 方案：

```bash
install -m 600 deploy/micro-linear.env.example deploy/micro-linear.env
# 修改 APP_URL 和三个独立随机密钥后：
docker compose up -d --build
```

Compose 会把数据库、附件和备份统一保存在持久卷，并以非 root 用户运行；容器在 Web 服务启动前先执行安全预检和数据库迁移。端口默认只绑定宿主机 `127.0.0.1:3000`，应由同机反向代理提供 TLS。首次访问 `/signup` 创建管理员后，公开注册会自动关闭。后台任务仍应由宿主机 cron 每分钟执行 `docker compose exec -T micro-linear npm run jobs:run`；备份可用相同方式执行 `npm run db:backup`，并应把备份目录定期同步到卷外或异机存储。

## 功能边界

明确排除：AI Triage、自然语言筛选、自动摘要、Agent、AI Release Notes、自动编码等依赖模型推理的能力。

本次已经交付固定规则自动化、Cycle 滚动、重复 Issue、站内提醒、归档、API Token、Webhook 和 CSV 导入导出。GitHub/GitLab、Slack/Teams、邮件入口等外部适配器不包含在当前自托管基线中；完整状态与边界以 [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) 为准。
