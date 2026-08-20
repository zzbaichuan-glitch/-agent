# 知澜（InfoMemory Agent）

面向飞书和桌面工作流的企业信息记忆 Agent。目标是让成员找到正确、最新、自己有权查看的信息，并回到原始证据，而不是建立另一个依赖人工整理的文件盘。

## 项目命名

- 产品展示名：**知澜**。
- 英文产品名：**InfoMemory Agent**。
- npm/代码标识：`infomemory-agent`。
- 推荐 GitHub 仓库名：`infomemory-agent`。
- 推荐本地目录名：`D:\infomemory-agent`。

GitHub 仓库已更名为 [`infomemory-agent`](https://github.com/zzbaichuan-glitch/infomemory-agent)，默认分支为 `main`。项目文件已移动到 `D:\infomemory-agent`；旧目录 `D:\信息管理agent` 只剩当前工作区锁定的临时依赖残留，释放工作区后可清理。

## 当前里程碑

`codex/mvp-foundation` 分支实现了第一个可运行的安全垂直切片：

- 文本资产入库、SHA-256 安全内容去重和幂等键。
- API Key、Bearer Token、密码和数据库 URL 密码在持久化前脱敏。
- 租户隔离、租户可见和上传者可见两种基础访问范围。
- 确定性的关键词证据搜索和稳定引用 ID。
- OpenAI-compatible `/chat/completions` 适配器。
- 模型关闭、超时、失败或答案无引用时自动降级为证据列表。
- 飞书 URL verification、事件 Token 验证、文本事件标准化和重复事件去重。
- 从飞书文本中识别明确或模糊的会议时间，创建用户私有的日程提醒候选；模糊时间会标记为待确认。
- 飞书租户 access token 缓存、机器人主动文本通知、加密事件 payload 解密和提醒投递去重。
- SQLite 本地存储、HTTP API、类型检查、单元测试和冒烟测试脚本。

尚未实现：生产身份认证、飞书 OAuth/权限同步、云文档同步、向量检索、桌面 UI、OCR、系统级通知/闹钟调度、完整审计和生产数据库。这些能力不能从当前健康检查中被误判为已完成。当前版本可以在飞书中给用户发送主动文本通知，但正式上线前仍需部署 HTTPS、完成应用授权和生产身份接入。

## 安全提醒

曾通过聊天发送的 API Key 应立即撤销和轮换。不要把任何真实 Key 写入源码、README、Git 提交、命令参数或日志。

项目默认 `LLM_ENABLED=false`。轮换后，只把新 Key 放到被 Git 忽略的 `.env.local`：

```dotenv
LLM_ENABLED=true
LLM_BASE_URL=https://llm-gw.bupt.edu.cn/v1
LLM_API_KEY=<rotated-key>
LLM_MODEL=<model-id-supported-by-the-gateway>
```

模型名称必须根据网关实际支持列表填写。本项目不会猜测一个模型名并把它作为生产默认值。

飞书接入配置放在项目根目录的 `.env.local`（该文件被 Git 忽略）：

```dotenv
FEISHU_NOTIFICATIONS_ENABLED=true
FEISHU_VERIFICATION_TOKEN=<verification-token>
FEISHU_APP_ID=<cli_xxx>
FEISHU_APP_SECRET=<app-secret>
FEISHU_API_BASE_URL=https://open.feishu.cn
FEISHU_API_TIMEOUT_MS=10000
FEISHU_ENCRYPT_KEY=<optional-encrypt-key>
REMINDER_POLL_INTERVAL_MS=15000
```

只有在飞书应用已经授权发送消息权限后，才把 `FEISHU_NOTIFICATIONS_ENABLED` 设为 `true`。不要把 `App Secret` 或 Encrypt Key 写入 Git、命令行参数或聊天记录。

## 环境要求

- Windows 10/11 或兼容 PowerShell 环境。
- Node.js 24+。
- npm 11+。
- 当前切片不依赖 Docker。

## 安装调用链

用户输入：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

完整调用链：

```text
用户 PowerShell
└─ scripts/install.ps1
   └─ npm install --cache .npm-cache --registry https://registry.npmjs.org
      ├─ 安装根开发依赖：TypeScript、Vitest、tsx
      ├─ 安装 packages/core 依赖：Zod
      └─ 安装 apps/api 依赖：Fastify、dotenv、Zod、@infomemory/core
```

项目内 `.npm-cache` 已被 Git 忽略，用于避开部分 Windows 环境的全局 npm 缓存权限冲突。

## 开发运行调用链

用户输入：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1
```

完整调用链：

```text
用户 PowerShell
└─ scripts/dev.ps1
   └─ npm run dev --workspace @infomemory/api
      ├─ apps/api predev
      │  └─ npm run build --workspace @infomemory/core
      │     └─ tsc -p packages/core/tsconfig.json
      └─ apps/api dev
         └─ tsx watch apps/api/src/server.ts
            ├─ 加载 .env.local / .env
            ├─ 初始化 SQLite
            └─ 监听 127.0.0.1:3000
```

## 构建后运行调用链

用户输入：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

完整调用链：

```text
用户 PowerShell
└─ scripts/start.ps1
   └─ npm run start --workspace @infomemory/api
      ├─ apps/api prestart
      │  ├─ tsc -p packages/core/tsconfig.json
      │  └─ tsc -p apps/api/tsconfig.json
      └─ apps/api start
         └─ node apps/api/dist/server.js
```

## 测试调用链

用户输入：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

完整调用链：

```text
用户 PowerShell
└─ scripts/test.ps1
   └─ npm run test
      ├─ packages/core: vitest run
      │  ├─ 脱敏测试
      │  ├─ 资产/权限测试
      │  └─ 搜索、引用回答和 LLM 客户端测试
      └─ apps/api
         ├─ pretest → tsc -p packages/core/tsconfig.json
         └─ vitest run → HTTP API 与飞书回调测试
```

## 全量验证调用链

用户输入：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

完整调用链：

```text
用户 PowerShell
└─ scripts/verify.ps1
   ├─ npm run typecheck
   │  ├─ tsc --noEmit -p packages/core/tsconfig.json
   │  └─ tsc --noEmit -p apps/api/tsconfig.json
   ├─ npm run test
   │  └─ 见“测试调用链”
   └─ npm run build
      ├─ tsc -p packages/core/tsconfig.json
      └─ tsc -p apps/api/tsconfig.json
```

## HTTP 冒烟测试调用链

先在一个终端启动服务，再在第二个终端输入：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke.ps1
```

完整调用链：

```text
用户 PowerShell
└─ scripts/smoke.ps1
   ├─ Invoke-RestMethod GET /health
   ├─ Invoke-RestMethod POST /v1/assets
   ├─ Invoke-RestMethod POST /v1/search
   └─ Invoke-RestMethod POST /v1/answers
```

冒烟脚本提交一个包含示例密码的文本，预期 `secretFindingCount=1`，搜索返回证据，并因默认关闭 LLM 而返回 `evidence_only / llm_disabled`。

## API

除健康检查和飞书回调外，当前开发 API 使用以下临时请求头模拟访问上下文：

```text
x-tenant-id: <tenant-id>
x-user-id: <user-id>
```

这不是生产认证。接入飞书 OAuth 后，服务端必须从已验证身份生成访问上下文，不能信任客户端自报的请求头。

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET | `/health` | 健康状态与真实能力列表 |
| POST | `/v1/assets` | 文本资产入库；要求 `idempotency-key` |
| GET | `/v1/assets` | 列出当前访问上下文可见资产 |
| POST | `/v1/search` | 关键词证据搜索 |
| POST | `/v1/answers` | 有引用约束的回答或证据降级 |
| GET | `/v1/reminders` | 列出当前用户的私有会议提醒，可按状态和到期时间过滤 |
| GET | `/v1/reminders/due` | 列出当前时刻前需要触发的已确认提醒 |
| POST | `/v1/reminders/:id/status` | 确认、完成或取消提醒 |
| POST | `/v1/connectors/feishu/events` | 飞书验证与事件回调 |

## 飞书回调基础

当前可以把飞书事件订阅 URL 指向：

```text
https://<public-host>/v1/connectors/feishu/events
```

需要配置 `FEISHU_VERIFICATION_TOKEN`。服务端支持 `url_verification`、`im.message.receive_v1` 文本消息和 Encrypt Key 加密 payload；只保存机器人收到的事件，默认按发送者个人可见。图片、文件、历史消息拉取、OAuth 和源权限同步尚未实现。

当文本包含“明天 14:30 开会”这类明确时间时，回调会创建 `scheduled` 提醒；“下午要开会”这类信息会创建 `needs_confirmation` 提醒，默认使用下午 15:00 作为候选时间并提前 60 分钟提醒。

将 `FEISHU_NOTIFICATIONS_ENABLED=true` 并配置 `FEISHU_APP_ID`、`FEISHU_APP_SECRET` 后，服务会：

1. 收到可识别的会议消息后，给发送者发送一条确认或待确认文本消息。
2. 每 `REMINDER_POLL_INTERVAL_MS` 检查到期提醒。
3. 通过飞书机器人发送到期提醒。
4. 在 SQLite 中记录投递状态；成功投递不会重复发送，临时失败会释放租约并重试。

## 飞书测试企业接入步骤

推荐先使用测试企业或测试群，不要直接接入正式工作群。

1. 在飞书开放平台创建“企业自建应用”，启用机器人能力。
2. 在事件订阅中启用 `im.message.receive_v1`，把事件订阅地址填为 `https://<public-host>/v1/connectors/feishu/events`。
3. 在权限管理中授予机器人接收消息和以应用身份发送消息的最小权限；具体权限名称以当前飞书控制台显示为准。
4. 生成并保存 `App ID`、`App Secret` 和 `Verification Token`。如果在事件订阅中启用了 Encrypt Key，同时保存 `Encrypt Key`。
5. 将这些值写入本机项目根目录的 `.env.local`，不要发到聊天、提交到 Git 或写进启动命令参数。
6. 启动服务并完成飞书的 URL verification。飞书后台验证通过后，把机器人加入测试群。
7. 在测试群发送“明天 14:30 开会讨论上线方案”，预期收到一条确认消息；到了提醒时间，后台 worker 会再发一条到期提醒。

当前服务仍使用开发身份头保护产品 API；飞书事件本身从已验证事件 payload 推导租户和用户。正式公网部署前必须补充 OAuth/session 身份边界、HTTPS、请求限流、审计和密钥轮换。

开发环境不应把未认证的本地服务直接暴露到公网。正式接入前仍需补充 HTTPS、请求限流、生产身份和完整审计。

## 文档

- [产品需求文档](docs/plans/2026-08-19-information-memory-agent-prd.md)
- [MVP 实施计划](docs/plans/2026-08-19-mvp-foundation-implementation.md)
- [MVP 基础架构](docs/architecture/mvp-foundation.md)
