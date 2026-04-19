# 赤兔 (Chitu) 系统架构

本文档描述赤兔 Agent 系统的完整架构，包括数据模型、核心流程、工具系统、事件协议、认证、MCP 集成等。

## 目录

- [系统概览](#系统概览)
- [数据模型](#数据模型)
- [核心流程：Agent Loop](#核心流程agent-loop)
- [传输层：WebSocket + JSON-RPC](#传输层websocket--json-rpc)
- [事件协议](#事件协议)
- [工具系统](#工具系统)
- [上下文构建](#上下文构建)
- [上下文压缩](#上下文压缩)
- [多模态支持](#多模态支持)
- [多 Agent 协作](#多-agent-协作)
- [认证系统](#认证系统)
- [用户与组织](#用户与组织)
- [用量追踪与计费](#用量追踪与计费)
- [数据持久化](#数据持久化)
- [文件监听](#文件监听)
- [MCP 集成](#mcp-集成)
- [代码语义索引](#代码语义索引)
- [沙盒执行](#沙盒执行)
- [监控与可观测性](#监控与可观测性)
- [配置系统](#配置系统)
- [Review 模式](#review-模式)
- [CLI 模式](#cli-模式)
- [VS Code 扩展](#vs-code-扩展)
- [Docker 部署](#docker-部署)

---

## 系统概览

赤兔是一个教育型 AI Agent 系统，架构对齐 OpenAI Codex。系统由 4 层组成：

```
┌─────────────────────────────────────────────────┐
│  Transport Layer                                │
│  WebSocket/JSON-RPC  |  CLI (readline)          │
├─────────────────────────────────────────────────┤
│  Message Processor                              │
│  JSON-RPC ↔ ThreadManager 翻译层               │
│  事件广播 → JSON-RPC 通知                       │
├─────────────────────────────────────────────────┤
│  Thread Manager                                 │
│  Thread/Turn/Item 生命周期管理                   │
│  Agent Loop 调度 + 事件发射                     │
├─────────────────────────────────────────────────┤
│  Agent Loop (核心)                              │
│  while(true) { LLM → tool_calls → execute }    │
│  上下文构建 → 工具注册 → 流式输出              │
└─────────────────────────────────────────────────┘
```

数据流：

```
用户消息 → JSON-RPC turn/start → MessageProcessor
  → ThreadManager.runTurn() → Agent Loop
    → LLM API (GLM-5) → 工具执行 → ...
    → 事件流 (AppEvent) → MessageProcessor 广播
      → JSON-RPC 通知 → WebSocket → 前端渲染
```

---

## 数据模型

### Thread（线程/对话）

一个 Thread 代表一次完整的对话，包含多轮 Turn。

```typescript
interface Thread {
  id: string                    // UUID
  title: string                 // 对话标题（首条消息自动设置）
  status: 'created' | 'active' | 'idle' | 'archived'
  items: Item[]                 // 对话中所有 Item
  currentPlan?: PlanStep[]      // 当前执行计划
  ownerId?: string              // M19: 所属用户
  orgId?: string                // M19: 所属组织
  createdAt: number
  updatedAt: number
}
```

### Turn（轮次）

一轮 Turn 代表一次用户输入到 Agent 完成回复的过程。Turn 内部可能包含多次 LLM 调用和工具执行。

```typescript
interface Turn {
  id: string
  threadId: string
  status: 'in_progress' | 'completed' | 'interrupted' | 'failed'
  startedAt: number
  completedAt?: number
}
```

### Item（操作项）

Item 是 Turn 中的每一步操作。

```typescript
type ItemType = 'user_message' | 'assistant_message' | 'tool_call' | 'tool_result'

interface Item {
  id: string
  type: ItemType
  status: 'started' | 'completed'
  content: string
  toolName?: string             // tool_call/tool_result 时有值
  toolArgs?: Record<string, unknown>
  toolCallId?: string
  isError?: boolean
  exitCode?: number
  images?: string[]             // M21: 多模态图片
  startedAt: number
  completedAt?: number
}
```

### 数据关系

```
Thread 1──N Turn（概念上的，Turn 状态不持久化到 Thread 对象）
Thread 1──N Item（持久化在 Thread.items 数组中）
Turn 过程中产生的 Item 追加到 Thread.items
```

---

## 核心流程：Agent Loop

`src/agent/loop.ts` 中的 `runAgentLoop()` 是整个系统的心脏。

### 流程

```
1. 构建初始上下文（buildInitialMessages）
   ├── system-role: 系统提示（Codex gpt_5_1_prompt.md 对齐）
   ├── user-role: AGENTS.md 片段
   ├── user-role: Skills 匹配注入
   ├── user-role: Memories 注入
   ├── user-role: 里程碑上下文
   ├── user-role: 环境上下文（完整或 delta）
   └── user-role: 用户实际输入

2. 多模态替换（如果有图片）
   └── 替换最后一条 user 消息的 content 为 ContentPart[]

3. while 循环（最多 10000 次）
   ├── 检查取消信号（AbortSignal）
   ├── 注入文件变更通知（FileChangeBuffer）
   ├── 上下文压缩检查（>80K token 时压缩）
   ├── 调用 LLM（chatStream，带 5 次重试）
   │   ├── 流式 delta → onStreamDelta 回调
   │   └── 返回 content + tool_calls
   ├── 无 tool_calls → 返回最终回复
   └── 有 tool_calls → 逐个执行工具
       ├── pre_tool_use hook（可拦截/修改）
       ├── 审批检查（高风险命令需用户确认）
       ├── 执行工具
       ├── post_tool_use hook（可修改输出）
       └── 结果加入对话历史，继续循环
```

### 关键设计决策

- **最大迭代 10000 次**：防止无限循环，足够处理复杂任务
- **LLM 5 次重试**：LLM API 失败时指数退避（2s/4s/8s），失败后注入错误到上下文让 Agent 感知
- **流式输出**：使用 SSE (Server-Sent Events)，每 token 推送 `item/delta` 事件
- **工具输出截断**：`truncateOutput()` 限制工具结果长度，防止上下文膨胀

---

## 传输层：WebSocket + JSON-RPC

### JSON-RPC 2.0 协议

所有客户端（Web UI、VS Code 扩展）通过 JSON-RPC 2.0 与后端通信。

**请求格式：**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "turn/start",
  "params": { "threadId": "...", "message": "..." }
}
```

**响应格式：**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "threadId": "...", "status": "started" }
}
```

**通知格式（服务端推送）：**
```json
{
  "jsonrpc": "2.0",
  "method": "item/delta",
  "params": { "itemId": "...", "delta": "你" }
}
```

### 方法列表（30+）

| 方法 | 说明 |
|------|------|
| `initialize` | 握手，返回协议版本和服务器信息 |
| `thread/create` | 创建新对话 |
| `thread/list` | 列出所有对话 |
| `thread/resume` | 恢复已有对话 |
| `thread/archive` | 归档对话 |
| `thread/delete` | 删除对话 |
| `thread/rename` | 重命名对话 |
| `thread/fork` | 从当前对话派生新对话 |
| `turn/start` | 开始一轮对话（异步，立即返回） |
| `turn/interrupt` | 中断当前轮次 |
| `approval/respond` | 响应审批请求 |
| `auth/register` | 用户注册 |
| `auth/login` | 用户登录 |
| `auth/me` | 获取当前用户信息 |
| `auth/users` | 列出所有用户（管理员） |
| `org/create` | 创建组织 |
| `org/list` | 列出用户所属组织 |
| `org/invite` | 邀请成员加入组织 |
| `org/members` | 列出组织成员 |
| `org/role` | 获取用户在组织中的角色 |
| `usage/get` | 查询用量 |
| `quota/check` | 检查配额 |
| `quota/set` | 设置配额 |
| `quota/get` | 获取配额配置 |
| `quota/plans` | 列出可用套餐 |

### HTTP 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/metrics` | GET | Prometheus 指标 |
| `/status` | GET | 运行状态 |
| `/dashboard` | GET | 聚合数据（指标+里程碑+事件+分析） |
| `/upload/image` | POST | 图片上传 |
| `/chitu-data/uploads/*` | GET | 静态文件服务 |

---

## 事件协议

`AppEvent` 对齐 Codex 协议，由 ThreadManager 发射，MessageProcessor 转为 JSON-RPC 通知广播。

```
thread/started        → 对话创建时
turn/started          → 轮次开始时
item/started          → Item 开始（消息/工具调用）
item/delta            → 流式增量（LLM 逐 token 输出）
item/completed        → Item 完成
turn/completed        → 轮次结束
approval/requested    → 需要用户审批（高风险命令）
plan/updated          → 计划更新（update_plan / milestone_plan）
```

事件广播流程：
1. ThreadManager 在关键操作点调用 `this.emit(event)`
2. MessageProcessor 通过 `onEvent()` 回调接收
3. 转为 JSON-RPC 通知，广播给所有已连接的 WebSocket 客户端
4. 非高频事件同时写入 JSONL rollout 文件（审计/回放用）

---

## 工具系统

### Tool 接口

```typescript
interface Tool {
  name: string
  description: string
  parameters: Record<string, unknown>  // JSON Schema
  execute(args: Record<string, unknown>): Promise<ToolResult>
  needsApproval?(args: Record<string, unknown>): boolean
  sandboxEnabled?: boolean
}
```

### Plugin 架构

工具通过 Plugin（`src/tools/plugin-types.ts`）组织：

```typescript
interface Plugin {
  name: string
  version: string
  category: string
  tools: Tool[]
  onLoad?(): Promise<void>
  onUnload?(): Promise<void>
  onError?(error: Error): void
}
```

`PluginLoader` 管理插件注册、依赖排序（拓扑排序）和生命周期。

### 内置工具

| 工具 | 类别 | 说明 |
|------|------|------|
| `exec` | Shell | 执行 shell 命令（支持沙盒） |
| `read_file` | File | 读取文件内容 |
| `write_file` | File | 创建/覆盖文件 |
| `edit_file` | File | 精确替换文件内容 |
| `apply_patch` | File | 应用 patch（模糊匹配） |
| `update_plan` | Planning | 更新任务计划 |
| `git_status` | Git | Git 工作树状态 |
| `git_diff` | Git | 显示差异 |
| `git_blame` | Git | 显示行级修改历史 |
| `git_log` | Git | 显示提交日志 |
| `git_checkpoint` | Git | 创建 git commit 检查点 |
| `git_rollback` | Git | 回退到之前的检查点 |
| `ghost_commit` | Git | 创建临时快照（git stash） |
| `ghost_rollback` | Git | 恢复到临时快照 |
| `milestone_plan` | Milestone | 里程碑计划管理 |
| `code_search` | Indexer | 代码符号搜索 |

### 审批流程

命令分三级（`src/tools/policy.ts`）：
- **read** — 只读命令（cat, ls, grep, git status 等），自动通过
- **write** — 写入命令（mkdir, npm install 等），自动通过
- **dangerous** — 危险命令（rm -rf, DROP TABLE 等），需用户确认

确认流程：Agent Loop 调用 `onApprovalNeeded()` → MessageProcessor 推送 `approval/requested` 通知 → 前端显示确认对话框 → 用户确认/拒绝 → `approval/respond` → Agent 继续或跳过。

---

## 上下文构建

`buildInitialMessages()` 组装发送给 LLM 的初始消息序列：

```
1. system-role:  系统提示（身份、人格、编码准则、验证要求）
2. user-role:    AGENTS.md 片段（层级加载，更深层覆盖更浅层）
3. user-role:    Skills 匹配注入（检测用户输入匹配的 skill）
4. user-role:    Memories 注入（跨 session 知识）
5. user-role:    里程碑上下文（当前里程碑信息）
6. user-role:    环境上下文（首次完整注入，后续只注入 delta）
7. user-role:    用户实际输入（如果有图片，替换为 ContentPart[]）
```

### 环境差异注入

首轮 Turn 注入完整环境上下文（OS、Node 版本、目录结构等）。后续 Turn 通过 `EnvDiff` 只注入变化的字段（新增/修改/删除的环境变量、新文件等），减少 token 消耗。

---

## 上下文压缩

`compactMessages()` 在每轮循环开始前检查总 token 数。超过 80K 时：

1. 保留 system prompt（第一条消息）
2. 用 LLM 对历史消息做摘要
3. 用摘要替换中间的历史消息
4. 保留最近 20K token 的消息不变

压缩后系统提示 + AGENTS.md 会被重新注入到摘要之前。

---

## 多模态支持

### 架构

```
前端（ChatInput）                    后端
  ├─ 选择/粘贴图片                     ├─ /upload/image (HTTP POST)
  ├─ 预览（URL.createObjectURL）       │   └─ 保存到 chitu-data/uploads/
  ├─ 上传到服务器                      │   └─ 返回服务器路径
  └─ turn/start(images: paths)    →   ├─ MessageProcessor 提取 images
                                       └─ ThreadManager.runTurn()
                                           ├─ Item.images 保存路径
                                           ├─ 构建 ContentPart[]
                                           │   ├─ { type: 'text', text: '...' }
                                           │   └─ { type: 'image_url', image_url: { url } }
                                           └─ Agent Loop 替换最后用户消息
```

### 限制

- 最多 5 张图片/消息
- 单张最大 10MB
- 支持 PNG/JPEG/GIF/WebP/SVG

---

## 多 Agent 协作

`src/agent/spawn.ts` 实现子 Agent 派发：

- **AgentSpawner** — 管理子 Agent 生命周期
- **AsyncMessageQueue** — Agent 间异步消息通信
- **createSpawnTool** — `agent_spawn` 工具工厂

深度限制：3 层（root=0, 子=1, 孙=2），防止递归 spawn。子 Agent 拥有独立的 Agent Loop 实例和上下文窗口，共享父 Thread 的文件系统。子 Agent 的 maxIterations 限制为 30。

---

## 认证系统

### WebSocket 握手认证

`src/auth/index.ts` 在 WebSocket 握手阶段验证身份（`verifyClient` 回调）：

1. 从 URL query `?token=xxx` 提取令牌
2. 尝试 API Key 验证 → `crypto.timingSafeEqual()` 防时序攻击
3. 尝试验证 JWT → 自实现 base64url 解码 + HMAC-SHA256 签名验证 + exp 过期检查
4. 未配置密钥时开发模式自动放行

### 设计决策

- **零外部依赖**：JWT 验证核心 <50 行，不需要 jsonwebtoken
- **仅支持 HS256**：足够单服务 WebSocket 认证场景
- **API Key 优先**：简单场景直接用 API Key，不需要 JWT 复杂性

---

## 用户与组织

### 用户管理（`src/auth/user-store.ts`）

- 密码哈希：`crypto.scryptSync`（比 bcrypt 更抗 GPU 暴力破解）
- JWT 生成：HMAC-SHA256，包含 userId + username + exp
- 数据库：users 表（id, username, email, passwordHash, createdAt）

### 组织管理

- organizations 表 + org_members 关联表
- 角色：admin / member
- Thread 归属：ownerId（用户）+ orgId（组织）

### 数据库迁移

- 006: users 表
- 007: organizations + org_members 表
- 008: threads 添加 owner_id / org_id 列

---

## 用量追踪与计费

### 用量记录（`src/monitoring/usage.ts`）

每次 Turn 完成后异步写入 `usage_logs` 表（fire-and-forget，不阻塞返回）：
- userId, orgId, threadId, turnId
- promptTokens, completionTokens, totalTokens
- iterations, durationMs, status

### 配额系统（`src/monitoring/quota.ts`）

Turn 开始前同步检查配额，超限直接拒绝：

| 套餐 | 月 Token 额度 |
|------|--------------|
| 免费 | 100 万 |
| 专业 | 1000 万 |
| 企业 | 1 亿 |

可通过 `quotas` 表按 user/org 覆盖默认配额。`CHITU_QUOTA_DISABLED=true` 跳过检查（开发模式）。

---

## 数据持久化

### 双写策略

所有数据写入 Neon PostgreSQL（主存储）+ JSON 文件（备份）。数据库不可用时自动降级到文件存储。

### 数据库迁移（10 个）

| 迁移 | 内容 |
|------|------|
| 001 | threads 表 |
| 002 | rollout_events 表 |
| 003 | memories 表 + 索引 |
| 004 | threads 索引优化 |
| 005 | active_turns 表（Crash Recovery） |
| 006 | users 表 |
| 007 | organizations + org_members 表 |
| 008 | threads 添加 owner_id / org_id |
| 009 | usage_logs 表 |
| 010 | quotas 表 |

### 数据目录结构

```
chitu-data/
  threads/        → Thread JSON 文件（备份）
  rollouts/       → JSONL 事件记录
  memories/       → 记忆 JSON 文件（备份）
  uploads/        → 上传的图片文件
```

---

## 文件监听

### 组件

- **FileWatcher** (`src/watcher/file-watcher.ts`) — fs.watch recursive，500ms 防抖，过滤 node_modules/.git/dist
- **SkillsWatcher** (`src/watcher/skills-watcher.ts`) — 监听 `.agents/skills/` 目录，检测 SKILL.md 变更后全量重载
- **FileChangeBuffer** (`src/watcher/file-change-buffer.ts`) — 生产者-消费者缓冲区（100 事件上限），连接事件驱动的 watcher 和轮询驱动的 Agent Loop

### 集成

Agent Loop 每轮循环开始时调用 `fileChangeBuffer.flush()`，取出 pending 变更，格式化为"文件变更通知"注入到上下文消息中。

---

## MCP 集成

Model Context Protocol 客户端 (`src/mcp/`)，支持 stdio 传输协议：

1. 从配置文件加载 MCP 服务器定义（`~/.chitu/mcp.json` + `.chitu/mcp.json`）
2. 为每个服务器创建 `McpClient`，通过 stdio 连接
3. 执行 JSON-RPC 握手（`initialize` + `tools/list`）
4. 动态注册发现的工具到 `ToolRegistry`，命名规则 `mcp__{server}__{tool}`
5. 工具调用通过 stdio JSON-RPC 转发

MCP 服务器加载失败不阻塞核心工具（容错设计）。

---

## 代码语义索引

`src/indexer/` 使用 TypeScript Compiler API 构建代码符号索引：

- **AST 解析**：`ts.createSourceFile` 提取 9 种符号类型（function, class, interface, type, variable, enum, method, property, import）
- **搜索**：关键词匹配 + 驼峰/下划线拆分，路径权重评分（精确>前缀>包含>拆分>路径>签名>文档）
- **增量索引**：基于 mtime，只重新解析变更文件
- **懒加载**：首次 `code_search` 调用时才触发索引构建

---

## 沙盒执行

`src/sandbox/` 提供 exec 工具的命令隔离：

- **macOS**：`sandbox-exec`（Seatbelt SBPL 策略），白名单模式（默认拒绝所有）
  - 允许读取系统路径和项目目录
  - 允许写入 node_modules/.git/dist/tmp/chitu-data 和 /tmp
  - 禁止网络访问
  - 策略写入临时文件（`-f` 标志），执行后清理
- **Linux**：Docker 接口预留
- **降级**：sandbox-exec 失败时自动降级到直接执行

---

## 监控与可观测性

### Prometheus 指标（8 个）

| 指标 | 类型 | 说明 |
|------|------|------|
| `chitu_turn_duration_seconds` | Histogram | Turn 耗时分布 |
| `chitu_turns_total` | Counter | Turn 总数（按状态） |
| `chitu_tokens_total` | Counter | Token 消耗 |
| `chitu_llm_requests_total` | Counter | LLM 请求计数 |
| `chitu_llm_duration_seconds` | Histogram | LLM 请求耗时 |
| `chitu_active_connections` | Gauge | 活跃 WebSocket 连接 |
| `chitu_tool_calls_total` | Counter | 工具调用计数 |
| `chitu_uptime_seconds` | Gauge | 服务运行时间 |

### 结构化日志

`StructuredLogger` 输出 JSON 格式日志，包含 timestamp + level + message + requestId + context。集成到 server、agent loop、hooks、message-processor。

---

## 配置系统

4 层叠加（后者覆盖前者）：

```
全局 ~/.chitu/config.json
  → 项目 .chitu/config.json
    → 环境变量
      → CLI 参数
```

`getConfig()` 单例缓存，避免重复加载。7 个模块：types / defaults / loader / merge / env / validate / index。

---

## Review 模式

Agent 只审查代码不修改，双重约束：

1. **System Prompt**：`buildReviewSystemPrompt()` 引导 Agent 只分析不修改，输出结构化审查结果（摘要/问题列表/建议/总体评价）
2. **工具过滤**：`isToolAllowedInReview()` 只注册只读工具（exec 只读命令、read_file、git 只读工具、update_plan）
3. **命令检测**：`isReadOnlyCommand()` 用正则检测 exec 工具的命令是否只读

---

## CLI 模式

`src/cli/index.ts` 提供**进程内架构**：

- 直接实例化 ThreadManager，不走 WebSocket/JSON-RPC
- `readline/promises` 实现交互式 TUI
- 支持流式输出、内联审批、SIGINT 优雅退出
- 零额外依赖（不用 ink 等 React for CLI 框架）

---

## VS Code 扩展

`vscode-extension/` 独立子项目，通过 WebSocket JSON-RPC 连接 App Server：

- **extension.ts** — 激活/停用，注册命令和配置监听
- **client.ts** — WebSocket JSON-RPC 客户端，自动重连 + 30s 超时 + initialize 握手
- **chat-provider.ts** — 侧边栏 Chat WebView Provider（内联 HTML+CSS+JS）
- **diff-provider.ts** — 内联 diff 预览（TextDocumentContentProvider + vscode.diff）

贡献点：侧边栏 Chat 面板、4 个命令、3 个快捷键、3 个配置项。

---

## Docker 部署

### 多阶段 Dockerfile

```
deps → build → production
(安装依赖)  (tsc + vite build)  (slim 镜像，只含运行时)
```

### docker-compose.yml

两个服务：
- **server** — Node.js 后端（端口 8080），含 healthcheck
- **frontend** — nginx:alpine 托管前端静态文件（端口 3000）

### GitHub Actions CI

3 个独立 job：
1. **lint-and-typecheck** — tsc + ESLint
2. **build** — 后端和前端构建
3. **docker** — `docker build` 验证
