# 赤兔 (Chitu) 进度记录

## 已完成的步骤

- [x] **第 1 步：调通 GLM-5 API** ✅
- [x] **第 2 步：Tool 系统 (exec 工具 + Registry)** ✅
- [x] **第 3 步：Agent Loop** ✅
  - 核心 while 循环：LLM → tool_calls → 执行 → 循环
  - 简单任务 2 轮完成，多步任务 2 轮完成
- [x] **第 4 步：文件工具 (read/write/edit)** ✅
  - Agent 自主完成：创建目录 → 写文件 → 编辑文件 → 读取验证
- [x] **第 5 步：Thread/Turn/Item + ThreadManager** ✅
  - [x] 5.1 类型定义 `src/types.ts` — Thread/Turn/Item 完整类型
  - [x] 5.2 ThreadManager `src/thread/manager.ts` — create/resume/archive/runTurn
  - [x] 5.3 持久化 `src/thread/store.ts` — JSON 文件存储
  - [x] 5.4 集成 Agent Loop — runTurn 把每一步转成 Item
  - [x] 5.5 集成测试通过 — Agent 自主执行任务，Items 链路完整
  - [x] 5.6 事件系统 — AppEvent 类型 + EventHandler 回调
  - [x] 5.7 事件发射对齐 Codex 协议 — 7/7 测试通过
- [x] **第 6 步：WebSocket App Server** ✅
  - [x] 6.1 JSON-RPC 2.0 协议层 `src/server/json-rpc.ts` — 类型 + 编解码 + 标准错误码
  - [x] 6.2 Message Processor `src/server/message-processor.ts` — JSON-RPC ↔ ThreadManager 翻译层
    - 7 个路由：initialize, thread/create, thread/list, thread/resume, thread/archive, turn/start, turn/interrupt
    - AppEvent → JSON-RPC 通知映射（5 种通知）
    - initialize 握手（未握手拒绝调用）
  - [x] 6.3 WebSocket 服务器 `src/server/index.ts` — ws 库，连接管理
  - [x] 6.4 Turn 异步执行 — turn/start 立即返回，Agent Loop 后台运行
  - [x] 6.5 客户端断线不影响 Turn — AbortController 按 threadId 管理
  - [x] 6.6 端到端测试 — 7/7 通知序列验证通过
    - 事件序列：thread/started → turn/started → item/started/completed (user_message/tool_call/tool_result/assistant_message) → turn/completed
    - ThreadManager.onEvent(handler) 供未来的 Message Processor 监听
    - addItem 内部 emit item/started + item/completed
    - runTurn emit turn/started + turn/completed
    - create emit thread/started

### 第 5 步架构 Review（对齐 Codex 文章第 4 篇）

- [x] Review App Server 进程流程 — 确认我们缺 Message Processor 层，Step 6 补上
- [x] Review Client-Server 消息流 — 确认事件序列对齐 Codex 协议
- [x] Review 通信协议 — JSON-RPC 2.0 + WebSocket（Codex 用 stdio，我们用 WebSocket 合理）

### 第 5 步暂不做的（已归并到步骤 8-13）

- [x] ~~approval_request~~ → **归入步骤 12（安全审批）**
- [x] ~~diff~~ → **归入步骤 13（远期高级能力）**
- [x] ~~fork~~ → **归入步骤 13（远期高级能力）**
- [x] ~~delta 事件~~ → **归入步骤 13（远期高级能力）**

## 下一步

> 对齐 Codex 文章第 4 篇的 App Server 架构
> Codex 4 组件：Transport → Message Processor → Thread Manager → Core Threads

#### 6.1 架构总览

```
┌──────────────────────────────────────────────────────┐
│                    Client (前端/TUI)                    │
└──────────────────┬───────────────────────────────────┘
                   │ WebSocket (JSON-RPC 2.0)
┌──────────────────▼───────────────────────────────────┐
│              Transport Layer                           │
│           src/server/index.ts                          │
│  - WebSocket 监听 (ws 库)                              │
│  - 连接管理 (connect / disconnect / reconnect)         │
│  - 收到消息 → 传给 Message Processor                    │
└──────────────────┬───────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────┐
│            Message Processor                           │
│       src/server/message-processor.ts                  │
│  - JSON-RPC 请求解码 → 调用 ThreadManager 方法         │
│  - 监听 ThreadManager 事件 → 转成 JSON-RPC 通知推送    │
│  - initialize 握手 (版本、能力交换)                     │
│  - turn/start 立即返回，Turn 在后台异步执行             │
└──────────────────┬───────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────┐
│             Thread Manager                             │
│         src/thread/manager.ts ✅ 已完成                │
│  - create / resume / archive / list / get              │
│  - runTurn (emit AppEvent)                             │
└──────────────────┬───────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────┐
│              Core Threads                              │
│          src/agent/loop.ts ✅ 已完成                   │
│  - Agent Loop (while 循环)                             │
│  - Tool 执行                                          │
└──────────────────────────────────────────────────────┘
```

#### 6.2 文件结构

```
src/server/
  ├── index.ts              — WebSocket 服务器入口
  ├── json-rpc.ts           — JSON-RPC 2.0 类型定义和编解码
  └── message-processor.ts  — JSON-RPC ↔ ThreadManager 翻译层
```

#### 6.3 JSON-RPC 2.0 协议层 (`json-rpc.ts`)

**类型定义：**
- `JsonRpcRequest` — `{ jsonrpc: "2.0", id?, method, params? }`
- `JsonRpcResponse` — `{ jsonrpc: "2.0", id, result? | error? }`
- `JsonRpcNotification` — `{ jsonrpc: "2.0", method, params? }` (无 id)
- `JsonRpcError` — `{ code: number, message, data? }`

**标准错误码：**
- `-32700` Parse error
- `-32600` Invalid Request
- `-32601` Method not found
- `-32602` Invalid params
- `-32603` Internal error

#### 6.4 Message Processor (`message-processor.ts`)

**职责：**
1. 收到 JSON-RPC 请求 → 路由到对应的 ThreadManager 方法
2. 监听 ThreadManager 的 AppEvent → 转成 JSON-RPC 通知 → 通过 WebSocket 推给客户端
3. 管理 initialize 状态（未握手的连接不能调用其他方法）

**路由表：**

| JSON-RPC 方法 | → 调用 | 返回 |
|---|---|---|
| `initialize` | 握手 | `{ protocolVersion, capabilities }` |
| `thread/create` | `manager.create()` | `{ thread }` |
| `thread/resume` | `manager.resume()` | `{ thread, items }` |
| `thread/list` | `manager.listThreads()` | `{ threads }` |
| `thread/archive` | `manager.archive()` | `{}` |
| `turn/start` | `manager.runTurn()` 异步 | 立即返回 `{ turn }`，后续事件通过通知推送 |
| `turn/interrupt` | AbortController.abort() | `{}` |

**事件 → 通知的映射：**

| AppEvent | → JSON-RPC 通知 |
|---|---|
| `thread/started` | `{ method: "thread/started", params: { thread } }` |
| `turn/started` | `{ method: "turn/started", params: { turn } }` |
| `turn/completed` | `{ method: "turn/completed", params: { turn } }` |
| `item/started` | `{ method: "item/started", params: { item } }` |
| `item/completed` | `{ method: "item/completed", params: { item } }` |

#### 6.5 Turn 异步执行（关键设计）

**问题：** `turn/start` 触发 Agent Loop，可能跑几分钟。如果同步等待，客户端会卡住。

**解决：**
1. 收到 `turn/start` → 创建 AbortController → 立即返回 `{ turn }`
2. 在后台调用 `manager.runTurn()`（不 await，用 `.then()/.catch()`）
3. runTurn 过程中 emit 的事件通过 `manager.onEvent()` → Message Processor → WebSocket 推给客户端
4. 客户端断开连接 → Turn 继续跑，状态保存在 Thread 里
5. 客户端重连 → `thread/resume` 获取最新状态

**AbortController 管理：**
- 每个 Turn 对应一个 AbortController
- `turn/interrupt` → 调用对应的 `controller.abort()`
- 存储在 `Map<turnId, AbortController>`

#### 6.6 客户端重连机制

**流程：**
1. 客户端连接 → `initialize` 握手
2. 客户端发 `thread/resume { threadId }` → 获取当前 Thread（含所有 Items）
3. 如果 Turn 正在进行中 → 后续事件自动推送
4. 如果 Turn 已完成 → 客户端根据 Items 渲染完整时间线

**关键：Agent Loop 不依赖客户端连接。** Turn 在服务端独立运行，WebSocket 只是事件传输通道。

#### 6.7 Initialize 握手

**客户端发送：**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "1.0.0",
    "clientInfo": { "name": "chitu-web", "version": "0.1.0" }
  }
}
```

**服务端返回：**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "1.0.0",
    "serverInfo": { "name": "chitu-app-server", "version": "0.1.0" },
    "capabilities": {}
  }
}
```

**约束：** 未握手的连接调用其他方法 → 返回 `-32002` 错误 (Not initialized)

#### 6.8 完整消息流示例

```
Client                                   Server
  │                                        │
  │── initialize ────────────────────────→│
  │←──────────────── initialize response ──│
  │                                        │
  │── thread/create ─────────────────────→│
  │←── notification: thread/started ──────│
  │←── response: { thread } ──────────────│
  │                                        │
  │── turn/start { message: "..." } ────→│
  │←── notification: turn/started ────────│
  │←── response: { turn } ────────────────│  ← 立即返回！
  │                                        │
  │   (Agent Loop 在后台运行)               │
  │                                        │
  │←── notification: item/started (user) ──│
  │←── notification: item/completed ───────│
  │←── notification: item/started (tool) ──│
  │←── notification: item/completed ───────│
  │←── notification: item/started (result)─│
  │←── notification: item/completed ───────│
  │←── notification: item/started (msg) ──│
  │←── notification: item/completed ───────│
  │←── notification: turn/completed ───────│
  │                                        │
```

#### 6.9 依赖

- `ws` — WebSocket 库（Node.js 标准 WebSocket 实现）

#### 6.10 验证方式

1. 用 `wscat` 或 Node.js 脚本连接 WebSocket，发送 JSON-RPC 请求
2. 验证 initialize → thread/create → turn/start → 收到事件通知 → turn/completed 完整流程
3. 验证 turn/interrupt 能取消 Agent Loop
4. 验证客户端断开重连后，Turn 状态正确恢复

---

### 第 6 步暂不做的（已归并到步骤 8-13）

- [x] ~~item/delta 流式增量~~ → **归入步骤 13（远期高级能力）**
- [x] ~~approval_request 审批流~~ → **归入步骤 12（安全审批）**
- [x] ~~diff Item 类型~~ → **归入步骤 13（远期高级能力）**
- [x] ~~多线程并行~~ → **归入步骤 13（远期高级能力）**
- [x] ~~向后兼容~~ → **删除（学习项目，单客户端无需版本协商）**
- [x] ~~配置和身份验证~~ → **删除（学习项目，无需 ChatGPT 登录流程）**

---

- [x] ~~**第 6.5 步：项目上下文注入（agent.md 地图）**~~ → **归入步骤 8（AGENTS.md 项目地图）**

- [x] **第 7 步：前端（Discord 风格 UI）** ✅
  - [x] 7.1 Vite + React 18 + TailwindCSS 项目搭建 `web-ui/`
  - [x] 7.2 Discord 暗色主题（复用 agent-system-v2 配色方案）
  - [x] 7.3 核心组件：Layout, Sidebar, ChatArea, ChatInput, MessageItem, ToolCallItem, WelcomeScreen
  - [x] 7.4 WebSocket JSON-RPC 客户端（useChituSocket.ts，单例模式，StrictMode 安全）
  - [x] 7.5 Zustand 状态管理（threads, items, turnStatus）
  - [x] 7.6 端到端测试通过 — 新建对话 → 发消息 → Agent 执行工具 → 显示结果

### 下一步：步骤 8-13（2026-04-05 更新）

> 对齐 Harness Engineering 文章 + Codex CLI 源码分析
> 目标：实现"用赤兔生成并优化赤兔"——完全自主运行

**当前差距分析（6 个缺失层）：**

| 缺失层 | 为什么关键 | Codex 怎么做的 |
|--------|-----------|--------------|
| 上下文压缩 | Agent 做不了长任务，token 几分钟爆 | compact.rs — 自动摘要 + 重注入初始上下文 |
| AGENTS.md 地图 | Agent 不认识项目，盲目探索 | ≈100 行目录文件 + 渐进式披露 |
| 自我验证 | Agent 改了代码不知道对不对 | reproduce → fix → verify 闭环 |
| 输出边界 | 工具输出炸上下文 | HeadTailBuffer：head + tail，中间截断 |
| 安全审批 | Agent 可能把项目搞坏 | 只读命令自动批准 + 写入需确认 |
| 会话持久化 | Agent 跑 30 分钟崩了白费 | JSONL 事件流记录 + resume/fork |

**依赖关系：**
```
步骤 8 (AGENTS.md)
  ↓
步骤 9 (输出截断)
  ↓
步骤 10 (上下文压缩) ← 依赖步骤 8（压缩后重注入）和步骤 9（截断策略）
  ↓
步骤 11 (自我验证) ← 依赖步骤 9（输出截断）和步骤 8（验证指令在 system prompt）
  ↓
步骤 12 (安全审批) ← 独立，可随时做
  ↓
步骤 13 (高级能力) ← 远期
```

- [x] **第 8 步：AGENTS.md 项目地图 + 增强系统提示** ✅
  - [x] 8.1 启动时自动扫描项目根目录 `AGENTS.md`（或 `agent.md`）
  - [x] 8.2 AGENTS.md 内容作为 **user-role message** 注入（不是 system role），格式：
    ```
    # AGENTS.md instructions for /path/to/project

    <INSTRUCTIONS>
    ...AGENTS.md 文件内容...
    </INSTRUCTIONS>
    ```
  - [x] 8.3 增强 system prompt（developer-role），对齐 Codex prompt.md 结构：
    - **身份定义**："你是一个自主编码 Agent，运行在赤兔（Chitu）中"
    - **人格设定**：简洁、直接、友好，优先给出可操作指导
    - **AGENTS.md spec**：说明 AGENTS.md 的作用域和优先级规则
    - **自主性指令**："一旦有了方向就主动收集上下文、实施、测试，坚持到任务端到端完成"
    - **验证指令**："代码修改后必须运行相关测试，失败时分析错误并修正"
    - **工具使用指南**：优先用专用工具（read_file）而非原始 shell 命令（cat）
  - [x] 8.4 初始上下文组装顺序（对齐 Codex build_initial_context）：
    1. system-role message：身份 + 人格 + AGENTS.md spec + 自主性 + 验证 + 工具指南
    2. user-role message：AGENTS.md 片段（`<INSTRUCTIONS>` 包裹）
    3. user-role message：环境上下文（cwd、shell、日期）
    4. user-role message：用户实际输入
  - [x] 8.5 AGENTS.md 加 32KiB 大小限制（对齐 Codex project_doc_max_bytes）
  - [x] 8.6 写一个赤兔自己的 `AGENTS.md`，描述赤兔项目结构
  - **修改文件：** `src/agent/loop.ts`, `src/context.ts`（新建）, `AGENTS.md`（新建）, `src/thread/manager.ts`
  - **验证：** ✅ 6 项测试通过 — findProjectRoot, loadAgentsMd, formatAgentsMdInjection, buildEnvironmentContext, buildProjectContext, buildInitialMessages

- [x] **第 9 步：执行环境优化（输出边界）** ✅
  - [x] 9.1 实现 `truncateOutput(content, maxTokens)` — HeadTailBuffer 策略：头尾保留，中间截断
  - [x] 9.2 改造 `exec.ts` — 加 `NO_COLOR=1`, `TERM=dumb`, `PAGER=cat`, `GIT_PAGER=cat` 环境变量
  - [x] 9.3 改造 `agent/loop.ts` — 工具结果进入 messages 前调用 `truncateOutput()` 截断
  - [x] 9.4 默认每个工具结果上限 10K token（≈40KB），超时特殊提示
  - **修改文件：** `src/tools/exec.ts`, `src/utils/truncate.ts`（新建）, `src/agent/loop.ts`
  - **验证：** ✅ 4 项测试通过 — 短内容透传、长内容截断、token 计数、边界值

- [x] **第 10 步：上下文压缩** ✅
  - [x] 10.1 Token 计数估算 — `src/utils/token.ts`：`approxTokenCount()` + `estimateMessagesTokens()`
  - [x] 10.2 Agent Loop 每轮开始前检查 messages 总 token，超 80K 阈值触发压缩
  - [x] 10.3 超阈值时：LLM 生成早期历史摘要 + 保留最近 20K token 消息 + 保留初始上下文
  - [x] 10.4 压缩后初始上下文（system + AGENTS.md + env + task）保留不变
  - **修改文件：** `src/utils/token.ts`（新建）, `src/agent/compact.ts`（新建）, `src/agent/loop.ts`, `src/utils/truncate.ts`（refactor）
  - **验证：** ✅ 6 项测试通过 — token 计数、消息 token 估算、截断 refactor、压缩检测（短/长）

- [x] **第 11 步：自我验证闭环** ✅
  - [x] 11.1 增强系统提示 — 退出码语义 + 验证闭环流程（exit code 0=成功，非0=失败必须修复）
  - [x] 11.2 改造 `exec.ts` — 结构化返回 `[exit code: N]` + `[stdout]` + `[stderr]` 分离
  - [x] 11.3 增强类型 — `ToolResult` 加 `exitCode`，`Item` 加 `exitCode`
  - [x] 11.4 穿透 exitCode — Agent Loop → toolResults → ThreadManager Items 全链路传递
  - **修改文件：** `src/tools/base.ts`, `src/tools/exec.ts`, `src/types.ts`, `src/agent/loop.ts`, `src/thread/manager.ts`
  - **验证：** ✅ 4 项测试通过 — 成功命令 exitCode=0、失败命令 exitCode≠0、无参数、环境变量生效

- [x] **第 12 步：安全与审批** ✅
  - [x] 12.1 命令风险分类 `src/tools/policy.ts` — read/write/dangerous 三级分类
  - [x] 12.2 审批决策 — `checkApproval(command, mode)` 支持 auto-approve/ask-user 模式
  - [x] 12.3 Tool 接口扩展 — `needsApproval?(args)` 可选方法
  - [x] 12.4 Agent Loop 集成 — 执行前检查 `needsApproval`，需要审批时暂停等待回调
  - [x] 12.5 MessageProcessor 审批流 — `approval/requested` 通知 + `approval/respond` JSON-RPC 方法
  - [x] 12.6 超时机制 — 30 秒无响应自动拒绝
  - **修改文件：** `src/tools/policy.ts`（新建）, `src/tools/base.ts`, `src/tools/exec.ts`, `src/agent/loop.ts`, `src/types.ts`, `src/server/message-processor.ts`
  - **验证：** ✅ 策略分类通过（ls=read, rm=dangerous, mkdir=write）+ 端到端审批闭环验证通过（Playwright 测试：rm -rf 触发审批 → ApprovalBanner 显示 → 用户拒绝 → Agent 优雅处理）

- [ ] **第 13 步：高级能力**

  > 来源参考：3 篇 OpenAI 官方博客 + [openai/codex](https://github.com/openai/codex) 仓库源码

  **博客文章索引：**
  1. "Unrolling the Codex Agent Loop" — https://openai.com/index/unrolling-the-codex-agent-loop/
  2. "Harness Engineering" — https://openai.com/zh-Hans-CN/index/harness-engineering/
  3. "Unlocking the Codex Harness" — https://openai.com/zh-Hans-CN/index/unlocking-the-codex-harness/

  - [x] **13.1 会话事件流记录（Rollout Recording）** ✅ — JSONL 记录 + resume/fork
    - **博客：** 文章 3 "Unlocking the Codex Harness" — Thread 生命周期章节
      > "Codex 可创建、恢复、派生和归档线程，并持久保存事件历史记录，以便客户端重新连接并呈现一致的时间线"
    - **仓库：** `codex-rs/rollout/` 目录
      - `rollout/src/recorder.rs` — `RolloutRecorder` 事件记录器
      - `rollout/src/metadata.rs` — 会话元数据（`SessionMeta`）
      - `rollout/src/policy.rs` — `EventPersistenceMode` 持久化策略
      - `rollout/src/state_db.rs` — SQLite 状态数据库
      - `rollout/src/session_index.rs` — 会话索引（按名称/ID 查找）
      - `core/src/rollout.rs` — 核心层 re-export
    - **实现：**
      - `src/rollout/recorder.ts`（新建）— `RolloutRecorder` JSONL 事件记录器，`record()` / `replay()` / `delete()`
      - `src/rollout/index.ts`（新建）— 模块入口
      - `src/thread/manager.ts`（修改）— `emit()` 同时写入 JSONL；新增 `fork()` 派生方法；`deleteThread()` 同时清理 JSONL
      - `src/server/message-processor.ts`（修改）— 新增 `thread/fork` JSON-RPC 路由
      - `web-ui/src/hooks/useChituSocket.ts`（修改）— 新增 `forkThread()` 方法
      - `web-ui/src/components/Sidebar.tsx`（修改）— 新增派生按钮（GitFork 图标）
      - `web-ui/src/lib/store.ts`（修改）— `addThread` 去重，防止 RPC + 通知重复添加
    - **验证：** ✅ Playwright 端到端测试通过
      - JSONL 文件自动创建，事件链完整（thread/started → turn/started → item/started/completed → turn/completed）
      - Fork 按钮创建派生线程，标题自动加 `(fork)` 后缀，复制完整消息历史
      - 无重复线程、无 console 错误

  - [x] **13.2 Skills 系统** — `SKILL.md` 可复用工作流 ✅
    - **博客：** 文章 1 "Unrolling the Codex Agent Loop" — Input aggregation 章节（工具三层来源，用户提供层包含 Skills）
    - **文档：** https://developers.openai.com/codex/skills
    - **仓库：**
      - `codex-rs/core/src/skills.rs` — `SkillsManager`、依赖解析、隐式调用检测
      - `codex-rs/core/src/skills_watcher.rs` — 文件监听自动重载
      - `codex-rs/skills/src/lib.rs` — Skills 加载框架
      - `codex-rs/core-skills/` — 内置 Skills
      - `docs/skills.md` — 文档入口
    - **实现：**
      - `src/skills/loader.ts`（新建）— SKILL.md 发现、解析（YAML frontmatter + Markdown body）、格式化
      - `src/skills/index.ts`（新建）— 模块入口
      - `src/context.ts`（修改）— `buildProjectContext()` 返回 skills 列表和摘要
      - `src/agent/loop.ts`（修改）— `buildInitialMessages()` 注入 skills 摘要 + 匹配 skill 完整内容
    - **匹配逻辑：** 用户消息包含 skill name 或 description 中的长关键词（>4 字符）即触发
    - **验证：** ✅ Playwright e2e 测试 2/2 通过
      - 匹配测试：发送 "Write a technical blog post..." → agent 使用 skill guidance 响应
      - 非匹配测试：发送 "What is 2+2?" → agent 正常响应无 skill 注入

  - [ ] **13.3 多 Agent 协作** — 子任务拆分、并行执行、结果合并
    - **博客：** 文章 2 "Harness Engineering" — 深度优先工作方式章节
      > "将更大的目标拆解为更小的构建模块（设计、代码、评审、测试等），提示智能体去构建这些模块"
    - **仓库：**
      - `codex-rs/core/src/spawn.rs` — `spawn_child_async()` 子进程派发、网络沙盒策略传递
      - `codex-rs/core/templates/collab/` — 协作模式模板
      - `codex-rs/core/templates/collaboration_mode/` — 多 Agent 协作模板
      - `codex-rs/core/src/agent/` — Agent 抽象层

  - [x] **13.4 执行计划（PLANS.md）** — 多小时任务的活文档管理 ✅
    - **博客：** 文章 2 "Harness Engineering" — Plans as first-class artifacts 章节
      > "计划被视为一流的工件。临时轻量计划用于小幅变更，而复杂工作则记录在执行计划中，并附带进度和决策日志"
    - **仓库：**
      - `codex-rs/core/gpt_5_1_prompt.md` — `update_plan` 工具定义 + 完整 Planning 章节
      - `codex-rs/protocol/src/plan_tool.rs` — `UpdatePlanArgs { explanation?, plan: PlanItemArg[] }` 数据结构
      - `codex-rs/core/src/tools/handlers/plan.rs` — 工具实现（no-op，发送 PlanUpdate 事件）
    - **实现：**
      - `src/types.ts`（修改）— 新增 PlanStep, StepStatus, UpdatePlanArgs, plan/updated 事件
      - `src/tools/plan.ts`（新建）— update_plan 工具（no-op，对齐 Codex）
      - `src/tools/plugin-loader.ts`（修改）— getTools() 包含 registered 状态插件
      - `src/agent/loop.ts`（修改）— 系统提示增加 Planning 章节（高质量/低质量示例、使用时机、状态管理规则）
      - `src/thread/manager.ts`（修改）— Thread 新增 currentPlan，检测 update_plan tool call 发射事件
      - `src/server/message-processor.ts`（修改）— plan/updated 事件广播
      - `web-ui/src/components/PlanPanel.tsx`（新建）— 计划面板组件（步骤状态图标、进度计数）
      - `web-ui/src/lib/store.ts`（修改）— currentPlan 状态
      - `web-ui/src/hooks/useChituSocket.ts`（修改）— 监听 plan/updated 通知
    - **验证：** ✅ Playwright e2e 测试 2/2 通过
      - 多步任务：Agent 调用 update_plan → PlanPanel 显示 3 个步骤 → Agent 执行并回复
      - 简单任务：不触发 update_plan → 无 PlanPanel（正确）

  - [ ] **13.5 沙盒执行** — 容器隔离
    - **博客：** 文章 2 "Harness Engineering" + 文章 3 "Unlocking the Codex Harness" — sandbox 配置和审批章节
    - **文档：** https://developers.openai.com/codex/security
    - **仓库：**
      - `codex-rs/sandboxing/src/lib.rs` — 沙盒抽象层
      - `codex-rs/sandboxing/src/bwrap.rs` — Linux bubblewrap 沙盒
      - `codex-rs/sandboxing/src/seatbelt.rs` — macOS Seatbelt 沙盒
      - `codex-rs/sandboxing/src/landlock.rs` — Linux Landlock 沙盒
      - `codex-rs/sandboxing/src/manager.rs` — 沙盒管理器
      - `codex-rs/linux-sandbox/` — Linux 专用沙盒
      - `codex-rs/windows-sandbox-rs/` — Windows 专用沙盒
      - `codex-rs/core/src/spawn.rs` — `CODEX_SANDBOX` / `CODEX_SANDBOX_NETWORK_DISABLED` 环境变量
      - `docs/sandbox.md` — 文档入口

  - [ ] **13.6 分层 AGENTS.md 收集** — root-to-CWD 所有目录遍历
    - **博客：** 文章 1 "Unrolling the Codex Agent Loop" — Input aggregation 章节
      > "look in each folder from the Git/project root of the cwd up to the cwd itself: add the contents of any of AGENTS.override.md, AGENTS.md"
    - **仓库：**
      - `codex-rs/core/hierarchical_agents_message.md` — 分层 AGENTS.md 规范（scope、优先级、冲突解决规则）
      - `codex-rs/instructions/src/user_instructions.rs` — 用户指令加载（含 AGENTS.md 目录遍历逻辑）
      - `docs/agents_md.md` — `child_agents_md` feature flag 说明

  - [ ] **13.7 环境上下文改 XML 子元素格式** — `<cwd>...</cwd>` 替代 key-value
    - **博客：** 文章 1 "Unrolling the Codex Agent Loop" — Prompt construction 章节
    - **仓库：**
      - `codex-rs/core/src/environment_context.rs` — `EnvironmentContext` 结构体
        - `serialize_to_xml()` — 输出 `<environment_context><cwd>...</cwd><shell>...</shell>...</environment_context>`
        - `equals_except_shell()` — 回合间对比（忽略 shell）
      - `codex-rs/core/src/contextual_user_message.rs` — `ENVIRONMENT_CONTEXT_FRAGMENT` 包装器

  - [ ] **13.8 系统提示补充最终回复格式规范** — 文件引用反引号、标题分段等
    - **博客：** 文章 2 "Harness Engineering" — 品味不变式章节
      > "我们通过自定义的代码检查器和结构测试来强制执行这些规则"
    - **仓库：**
      - `codex-rs/core/prompt.md` — 完整 "Final answer structure and style guidelines" 章节：
        - Section Headers：`**Title Case**`，1-3 词
        - Bullets：`-` 短列表，4-6 条
        - Monospace：文件路径/命令用 `` `...` ``
        - File References：路径 + 行号（`:42`），不用 URI
        - Structure：general → specific → supporting
        - Tone：协作自然、简洁事实、现在时主动语态

  - [ ] **13.9 回合间环境差异检测** — 只发 delta，不重复注入
    - **博客：** 文章 3 "Unlocking the Codex Harness" — 配置变更处理章节
      > "当可能的时候，我们通过在对话过程中追加一条新消息来反映配置变化，而不是修改之前的消息"
    - **仓库：**
      - `codex-rs/core/src/environment_context.rs` — `diff_from_turn_context_item()` 方法
        - 比较 before/after 的 cwd、network 等字段，只返回变化的部分
      - `codex-rs/core/src/turn_diff_tracker.rs` — `TurnDiffTracker`
        - 文件变更的 in-memory baseline snapshot
        - `on_patch_begin()` — 文件修改前记录基线内容 + git blob OID
        - `get_unified_diff()` — 生成聚合 unified diff
        - 支持重命名/移动检测（stable internal UUID filename）

### 步骤 8 比对结论（2026-04-05 与 Codex 仓库比对）

**完全对齐：**
- AGENTS.md 注入格式（`<INSTRUCTIONS>` 包裹 + user-role）
- 注入顺序（system → AGENTS.md → 环境上下文 → 用户输入）
- 候选文件优先级（`AGENTS.override.md` > `AGENTS.md`）
- 32KiB 大小限制
- 环境上下文字段覆盖（cwd, shell, date）

**可接受差距（归入步骤 13 远期）：**
- 只读根目录 AGENTS.md（Codex 读 root-to-CWD）→ 13.6
- 环境上下文 key-value 格式（Codex 用 XML 子元素）→ 13.7
- 系统提示缺最终回复格式规范 → 13.8
- 没有回合间环境差异检测 → 13.9
- 没有 developer-role 分离（GLM API 无此角色，非遗漏）

---

## 第 13 步之后：完整差距分析（2026-04-06）

> 对 openai/codex 仓库全面比对，识别步骤 1-13 未覆盖的能力
> 按 ESSENTIAL / IMPORTANT / NICE-TO-HAVE 三级分类

### ESSENTIAL（核心功能差距）

#### 14.1 Apply Patch 工具 — 统一 diff 格式文件编辑 ✅
- **现状：** 已实现 Codex 风格的 `apply_patch` 工具，支持 Add/Delete/Update 文件操作，4 级模糊匹配
- **Codex 做法：** 用标准 unified diff 格式的 `apply_patch` 工具，支持增/删/改/移动，原子操作
- **博客：** 文章 1 "Unrolling the Codex Agent Loop" — tool 定义章节
- **仓库：**
  - `codex-rs/apply-patch/` — 独立 apply-patch crate
  - `codex-rs/core/src/apply_patch.rs` — 核心集成层
  - `codex-rs/core/prompt.md` — 工具定义（`apply_patch` 是主要文件修改工具）
- **为什么关键：** 文件编辑是 Agent 最高频操作，edit_file 的精确匹配在真实项目中经常失败
- **实现：**
  - `src/tools/apply-patch/parser.ts`（新建）— `*** Begin Patch` / `*** End Patch` 格式解析，支持 Add/Delete/Update 三种操作，heredoc 包装剥离
  - `src/tools/apply-patch/match.ts`（新建）— 4 级模糊匹配：精确 → 去尾空白 → 全去空白 → Unicode 归一化
  - `src/tools/apply-patch/apply.ts`（新建）— 文件操作执行引擎，多 hunk 倒序应用，Move to 重命名支持
  - `src/tools/apply-patch/index.ts`（新建）— 工具入口，注册为 `apply_patch`
  - `src/agent/loop.ts`（修改）— 系统提示增加 apply_patch 使用指南和格式示例
  - `src/tools/plugins/files/index.ts`（修改）— files 插件新增 apply_patch 工具
- **验证：** ✅ 21 个单元测试通过 + Playwright 端到端测试 3/3 通过（创建文件、修改文件、多 hunk）

#### 14.2 流式输出（item/delta） ✅
- **现状：** 已实现完整链路流式输出：LLM SSE → Agent Loop → WebSocket → 前端实时渲染
- **Codex 做法：** `item/started → item/delta (多次) → item/completed`，逐 token 推送
- **博客：** 文章 1 "Unrolling the Codex Agent Loop" — Streaming 章节
- **仓库：**
  - `codex-rs/protocol/src/protocol.rs` — `Event::ItemDelta` 事件类型
  - `codex-rs/core/src/stream_events_utils.rs` — 流事件工具
  - `codex-rs/tui/` — TUI 流式渲染
- **为什么关键：** 用户体验的基础，无流式 = 用户面对长时间空白等待
- **实现：**
  - `src/llm/client.ts`（修改）— 新增 `chatStream()` SSE 流式方法，try/finally reader 清理
  - `src/agent/loop.ts`（修改）— `onStreamDelta` 回调，每 token 推送到 ThreadManager
  - `src/thread/manager.ts`（修改）— 流式 item 生命周期：item/started → item/delta → item/completed；提取 `completeStreamingItem` 辅助方法；跳过 delta 的 JSONL 记录
  - `src/types.ts`（修改）— 新增 `item/delta` 事件类型
  - `src/server/message-processor.ts`（修改）— 广播 `item/delta` 通知
  - `web-ui/src/lib/store.ts`（修改）— `appendItemContent` 高效 findIndex 更新
  - `web-ui/src/hooks/useChituSocket.ts`（修改）— rAF 批量 delta 处理，item/completed 时清空 buffer
  - `web-ui/src/components/MessageItem.tsx`（修改）— 流式光标动画（绿色脉冲）
- **验证：** ✅ Playwright 端到端测试 3/3 通过（增量文本、完成验证、工具调用+流式）

### IMPORTANT（重要能力差距）

#### 14.3 Memories 系统 — 跨会话知识积累
- **现状：** 每个 thread 独立，无法跨会话学习和复用知识
- **Codex 做法：** 自动从对话中提取结构化记忆（架构决策、项目约定、已知问题），后续会话自动注入
- **博客：** 文章 2 "Harness Engineering" — 品味不变式章节
- **仓库：**
  - `codex-rs/core/src/memories/` — Memories 模块
    - `phase1.rs` — 记忆生成（Phase 1：自动提取）
    - `phase2.rs` — 记忆检索与注入（Phase 2：智能选取）
    - `storage.rs` — 记忆持久化（SQLite）
    - `control.rs` — 记忆控制（启停/阈值）
    - `prompts.rs` — 记忆生成提示词
    - `citations.rs` — 引用追踪
  - `codex-rs/state/migrations/0006_memories.sql` — 数据库迁移
- **为什么重要：** 让 Agent 随使用越来越聪明，避免重复犯同样的错误

#### 14.4 Hooks 系统 — 工具执行前后的钩子
- **现状：** Agent 执行工具无拦截点，无法自定义策略
- **Codex 做法：** 5 个 hook 事件点，用户可配置 shell 命令作为钩子
- **博客：** 未直接提及（属于 Codex CLI 高级配置）
- **仓库：**
  - `codex-rs/hooks/` — 完整 Hooks 引擎
    - `src/engine/dispatcher.rs` — 事件分发
    - `src/events/pre_tool_use.rs` — 工具执行前钩子（可阻止执行）
    - `src/events/post_tool_use.rs` — 工具执行后钩子（可修改输出）
    - `src/events/session_start.rs` — 会话启动钩子
    - `src/events/stop.rs` — 会话结束钩子
    - `src/events/user_prompt_submit.rs` — 用户输入提交钩子（可修改 prompt）
  - `schema/generated/` — 每个钩子的 JSON Schema 输入/输出定义
- **为什么重要：** 企业级 Agent 的必备能力（合规检查、自定义审批、日志审计）

#### 14.5 MCP (Model Context Protocol) 集成
- **现状：** 工具系统完全内置，无法接入外部工具服务
- **Codex 做法：** 双向 MCP 支持（作为 client 调用外部 MCP server，也作为 server 暴露工具）
- **博客：** 未直接提及（属于 Codex 生态扩展）
- **仓库：**
  - `codex-rs/mcp-server/` — Codex 作为 MCP Server
  - `codex-rs/core/src/mcp/` — MCP Client 集成
    - `mcp_connection_manager.rs` — 连接管理
    - `mcp_tool_approval_templates.rs` — MCP 工具审批模板
    - `mcp_tool_call.rs` — MCP 工具调用
  - `codex-rs/rmcp-client/` — Rust MCP Client
- **为什么重要：** 工具生态的基础协议，接入第三方能力（数据库、API、云服务）

#### 14.6 文件监听（File Watcher）
- **现状：** Agent 无法感知外部文件变更（编辑器保存、git pull 等）
- **Codex 做法：** 实时监听文件系统变更，自动触发上下文更新
- **博客：** 文章 3 "Unlocking the Codex Harness" — 实时性章节
- **仓库：**
  - `codex-rs/core/src/file_watcher.rs` — 文件监听器
  - `codex-rs/core/src/skills_watcher.rs` — Skills 文件变更监听
- **为什么重要：** Agent 长时间运行时，外部文件可能被修改，需要感知变化

### NICE-TO-HAVE（进阶能力）

#### 14.7 多 Shell 支持
- **现状：** 硬编码 `/bin/bash`
- **Codex 做法：** 自动检测用户 Shell（zsh/bash/PowerShell/cmd/sh），按类型派发不同参数
- **仓库：**
  - `codex-rs/core/src/shell.rs` — `Shell` 类型 + `ShellType` 枚举
  - `codex-rs/core/src/shell_detect.rs` — Shell 检测
  - `codex-rs/core/src/shell_snapshot.rs` — Shell 状态快照

#### 14.8 分层配置系统
- **现状：** 无配置管理
- **Codex 做法：** 多层配置叠加（全局 → 项目 → 用户 → CLI 参数），类似 git config
- **仓库：**
  - `codex-rs/config/` — 配置层栈
  - `codex-rs/core/src/config/` — 运行时配置加载

#### 14.9 Review 模式
- **现状：** Agent 只做执行，不做代码审查
- **Codex 做法：** 专门的 review prompt + diff 格式审查输出
- **仓库：**
  - `codex-rs/core/review_prompt.md` — 审查专用提示词
  - `codex-rs/core/src/review_prompts.rs` — 审查提示词管理

#### 14.10 Git 深度集成
- **现状：** Agent 可以执行 git 命令但无结构化 git 支持
- **Codex 做法：** commit 归属标注、git utils 库、diff 生成
- **仓库：**
  - `codex-rs/git-utils/` — Git 工具库
  - `codex-rs/core/src/commit_attribution.rs` — 提交归属

### 优先级排序建议

```
14.1 Apply Patch    ██████████  ✅ 已完成（2026-04-12）
14.2 流式输出       █████████░  ✅ 已完成（2026-04-12）
14.3 Memories       ████████░░  中高优先（长期价值）
14.4 Hooks          ███████░░░  中优先（可扩展性）
14.5 MCP            ██████░░░░  中优先（生态扩展）
14.6 File Watcher   █████░░░░░  中低优先
14.7 多 Shell       ███░░░░░░░  低优先
14.8 分层配置       ███░░░░░░░  低优先
14.9 Review 模式    ██░░░░░░░░  低优先
14.10 Git 集成      ██░░░░░░░░  低优先
```

## 里程碑记录

### 2026-04-12：步骤 14.2 完成 — 流式输出（item/delta）

**完成了什么：** 实现了 Agent 回复的逐 token 流式推送，用户不再需要等待数十秒空白。

**为什么重要：** 流式输出是 AI 对话体验的基础。没有流式，用户发消息后盯着空白页面等 10-30 秒，体验极差。有了流式，文本逐字出现，用户能实时看到 Agent 的思考过程。

**实现链路（7 层）：**
1. `LLMClient.chatStream()` — 发 `stream: true`，解析 SSE 事件流（`data: {"delta":{"content":"..."}}]`），累积文本和工具调用
2. `AgentLoop` — 新增 `onStreamDelta` 回调，每 token 传给 ThreadManager
3. `ThreadManager` — 流式 item 生命周期管理：
   - 首次 delta → `item/started`（空内容的 assistant_message）
   - 后续 delta → `item/delta`（逐 token 推送）
   - 最终完成 → `item/completed`（完整内容）
   - 提取 `completeStreamingItem` 辅助方法消除 3 处重复代码
4. `AppEvent` — 新增 `item/delta` 事件类型
5. `MessageProcessor` — 广播 `item/delta` 到所有 WebSocket 客户端
6. `useChituSocket` — rAF 批量处理 delta（requestAnimationFrame 合并更新），item/completed 时清空 buffer 防止内容污染
7. `MessageItem` — 流式光标动画（绿色脉冲，status='started' 时显示）

**性能优化：**
- 跳过 delta 事件的 JSONL 记录（避免高频磁盘 I/O，delta 是瞬时 UI 数据）
- 前端 rAF 批量更新（防止 100 token/sec 导致 React 过度渲染）
- Store 用 findIndex 替代 map 全量遍历
- SSE reader 加 try/finally 确保资源释放

**Code Review 修复：**
- Reader 泄漏 → try/finally + releaseLock
- 流式消息出错清理 → catch 块中完成未关闭的 item
- 消除重复代码 → completeStreamingItem 辅助方法
- delta buffer 竞态 → item/completed 时清空对应 buffer

**验证：** Playwright 端到端测试 3/3 通过
1. 增量文本 — 文本长度从短变长，证明逐 token 推送
2. 完成验证 — Turn 完成后消息有实质内容
3. 工具调用 + 流式 — 先执行 exec 工具，然后流式回复

### 2026-04-12：步骤 14.1 完成 — Apply Patch 工具 + 插件系统重构

**完成了什么：** 实现了 Codex 风格的 `apply_patch` 工具，替代 edit_file 成为 Agent 的主要文件编辑手段。同时完成了工具系统的插件化重构。

**为什么重要：** 文件编辑是 Agent 最高频操作。edit_file 的 old_text/new_text 精确匹配在实际项目中经常失败（空格偏差、缩进不一致），导致 Agent 卡在文件编辑环节。apply_patch 使用行级 diff 格式 + 4 级模糊匹配，大幅提升编辑成功率。

**插件系统重构：**
- `src/tools/plugin-types.ts`（新建）— Plugin 接口定义（元数据 + 生命周期钩子）
- `src/tools/plugin-loader.ts`（新建）— PluginLoader（注册 → 加载 → 卸载，拓扑排序依赖管理）
- `src/tools/plugins/exec/index.ts`、`files/index.ts`、`plan/index.ts` — 三个核心插件
- `src/tools/index.ts`（重构）— ToolRegistry 改为 PluginLoader 驱动，对外接口不变
- 还包含：GLM-Image 客户端、turn 事件附带 thread 数据（标题同步修复）

**Apply Patch 实现：**
- `src/tools/apply-patch/parser.ts`（新建）— 解析 `*** Begin Patch` 格式（Add/Delete/Update 三种操作）
- `src/tools/apply-patch/match.ts`（新建）— 4 级模糊匹配（对齐 Codex seek_sequence.rs）：
  1. 精确匹配（byte-for-byte）
  2. 去尾空白匹配（rstrip）
  3. 全去空白匹配（full trim）
  4. Unicode 归一化匹配（花式引号/破折号 → ASCII）
- `src/tools/apply-patch/apply.ts`（新建）— 文件操作执行引擎
  - Add File：创建目录 + 写入
  - Delete File：删除文件
  - Update File：模糊匹配旧行 → 替换为新行，多 hunk 倒序应用
  - Move to：重命名文件
  - `*** End of File` 标记：从文件末尾开始搜索
- `src/agent/loop.ts`（修改）— 系统提示增加 apply_patch 格式说明和使用指南
- Heredoc 包装自动剥离（LLM 有时把 patch 包在 `<<'EOF' ... EOF` 里）

**验证：**
- 21 个单元测试通过（parser 8 个、match 4 个、apply 9 个）
- Playwright 端到端测试 3/3 通过：
  1. 创建新文件（`*** Add File`）— Agent 成功创建 utils.ts
  2. 修改已有文件（`*** Update File`）— greet 函数返回值 Hello → Hi
  3. 多 hunk 同时修改 — 一次 patch 改两个函数

### 2026-04-11：步骤 13.4 完成 — 执行计划系统（update_plan 工具）

**完成了什么：** Agent 可以通过 `update_plan` 工具创建和跟踪多步任务计划，前端实时展示计划步骤和进度。

**为什么重要：** 计划系统是 Codex "Plans as first-class artifacts" 的核心能力。没有计划，Agent 做长任务时会丢失上下文。有了计划，Agent 像人类一样列待办、标进度、随时回顾，支持断点续做。

**关键洞察（来自 Codex 源码注释）：** plan 工具本身是 no-op，不做任何实际操作。它的价值在于：1) 强制 Agent 结构化思考，2) 让客户端读取 tool call 参数来渲染计划 UI。

**怎么做的：**
- `src/types.ts` — 新增 PlanStep（step + status）、UpdatePlanArgs、plan/updated 事件
- `src/tools/plan.ts`（新建）— update_plan 工具（no-op，对齐 Codex plan.rs）
- `src/tools/plugin-loader.ts` — 修复 getTools() 返回 registered 状态的工具
- `src/agent/loop.ts` — 系统提示增加完整 Planning 章节（对齐 Codex prompt.md）：
  - 何时使用计划（非平凡、多阶段、有依赖）
  - 何时不用（简单、单步）
  - 高质量 vs 低质量计划示例
  - 状态管理规则（始终一个 in_progress，完成后标 completed）
- `src/thread/manager.ts` — Thread 新增 currentPlan 字段，检测 update_plan tool call 时解析参数、更新计划、发射 plan/updated 事件
- 前端 PlanPanel 组件：步骤状态图标（⏳→🔄→✅）、进度计数、完成后样式变化

**验证：** Playwright e2e 测试 2/2 通过
- 多步任务：Agent 调用 update_plan → PlanPanel 显示 3 个步骤 → Agent 按计划执行
- 简单任务：不触发 update_plan → 无 PlanPanel（正确行为）

### 2026-04-10：步骤 13.2 完成 — Skills 系统（SKILL.md 可复用工作流）

**完成了什么：** Agent 自动发现和加载项目中的 SKILL.md 技能文件，根据用户消息自动匹配相关技能并注入到 LLM 上下文。

**为什么重要：** Skills 是 Codex Input aggregation 三层来源之一。让 Agent 可以根据任务类型自动获取专业指导（如技术博客写作规范、代码审查标准），而不需要每次在 prompt 中重复说明。

**怎么做的：**
- `src/skills/loader.ts`（新建）— 从 `.agents/skills/*/SKILL.md` 发现和解析技能文件
  - `loadSkills(projectRoot)` — 扫描技能目录，解析 YAML frontmatter（name, description, allowed-tools）
  - `parseSkillMd()` — 简易 YAML 解析器
  - `formatSkillsSummary()` — 技能摘要格式化（注入到初始上下文）
  - `formatSkillInjection()` — 完整技能内容格式化（`<skill>` 标签包裹）
- `src/context.ts`（修改）— `buildProjectContext()` 返回 skills 列表和摘要
- `src/agent/loop.ts`（修改）— `buildInitialMessages()` 注入：
  1. 所有技能的摘要列表（"Available Skills" user-role message）
  2. 匹配到的技能的完整内容（`<skill name="...">` 包裹）
- 匹配逻辑：用户消息包含 skill name 或 description 中 >4 字符关键词即触发

**验证：** Playwright e2e 测试 2/2 通过
- 匹配测试：发送含 "technical blog" 关键词的消息 → agent 使用 technical-blog-writing skill 指导响应
- 非匹配测试：发送 "What is 2+2?" → agent 正常响应，无 skill 注入

### 2026-04-08：步骤 13.1 完成 — 会话事件流记录（Rollout Recording）

**完成了什么：** Agent 所有事件自动记录到 JSONL 文件，支持线程派生（fork）。

**为什么重要：** 事件流记录是 Codex "线程持久保存事件历史记录" 的核心能力。JSONL 记录了 Agent 的每一步操作（审计追踪），fork 允许用户从某个对话状态探索不同方向而不影响原对话。

**怎么做的：**
- `src/rollout/recorder.ts`（新建）— `RolloutRecorder`，每个线程一个 `.jsonl` 文件
  - `record(threadId, event)` — 追加事件到 JSONL
  - `replay(threadId)` — 回放所有事件记录
  - `delete(threadId)` — 清理 JSONL 文件
- `src/thread/manager.ts`（修改）
  - `emit()` 同时调用 `recorder.record()`，异步写入不阻塞主流程
  - `fork(threadId)` — 从现有线程派生新线程（复制 items，新 ID，标题加 `(fork)`）
  - `deleteThread()` 同时清理 JSONL 文件
- `src/server/message-processor.ts`（修改）— 新增 `thread/fork` JSON-RPC 路由
- 前端：`forkThread()` 方法 + 侧边栏派生按钮（GitFork 图标）
- Store：`addThread` 去重（防止 RPC 响应 + 通知重复添加）

**验证：** Playwright 端到端测试通过 — JSONL 事件链完整、fork 按钮可用、无重复、无报错

### 2026-04-06：步骤 12 完成 — 安全与审批（含接线修复）

**完成了什么：** Agent 执行高风险命令（rm、git push 等）前需要用户审批，实现安全控制闭环。

**为什么重要：** 没有审批机制，Agent 有完全的 shell 权限，一个误操作就能破坏项目。审批是 Codex 安全模型的核心。

**怎么做的：**
- `src/tools/policy.ts`（新建）— 命令风险三级分类
  - `classifyCommand(command)` → `read` / `write` / `dangerous`
  - `checkApproval(command, mode)` → `auto-approved` / `needs-approval`
  - 只读命令（ls, git status, npm test）自动批准
  - 写入命令（mkdir, npm install）需确认
  - 危险命令（rm -rf, git push --force, sudo）需确认
- `src/tools/base.ts` — Tool 接口加 `needsApproval?(args)` 可选方法
- `src/tools/exec.ts` — 实现 `needsApproval`：exec 根据 policy.ts 分类
- `src/agent/loop.ts` — `AgentLoopConfig` 加 `onApprovalNeeded` 回调，执行前检查审批
- `src/types.ts` — `AppEvent` 加 `approval/requested` 事件类型
- `src/server/message-processor.ts` — 审批回调创建 + `approval/respond` JSON-RPC 路由 + 30s 超时
- `src/thread/manager.ts` — `RunTurnOptions` 加 `onApprovalNeeded`，传给 `runAgentLoop`
- 前端 `ApprovalBanner.tsx`（新建）— 审批横幅组件（风险着色 + 允许/拒绝按钮）
- 前端 `store.ts` — `pendingApproval` 状态
- 前端 `useChituSocket.ts` — 监听 `approval/requested` + `respondApproval()` 方法

**关键修复（0c785cc）：** 审批策略实现后，`onApprovalNeeded` 回调没有从 MessageProcessor → ThreadManager → AgentLoop 传递，所有命令绕过审批。修复后完整链路打通。

**端到端验证（Playwright）：**
```
用户发消息："请执行 rm -rf /tmp/chitu-test"
  → Agent 调用 exec("rm -rf /tmp/chitu-test")
    → needsApproval() = true
      → Agent Loop 暂停，推 approval/requested 到前端
        → ApprovalBanner 显示（红色危险标记 + 命令预览 + 允许/拒绝按钮）
          → 用户点击"拒绝"
            → 前端发 approval/respond { approved: false }
              → Agent 收到拒绝，优雅处理："操作被拒绝了"
```

### 2026-04-06：步骤 11 完成 — 自我验证闭环

**完成了什么：** Agent 能理解命令成败（exit code），实现"改代码 → 跑测试 → 看失败 → 修复 → 再测"的闭环。

**为什么重要：** 没有 exitCode 语义，Agent 无法区分命令成功还是失败，自我验证不可能实现。这是 Codex reproduce → fix → verify 闭环的基础。

**怎么做的：**
- `src/tools/base.ts` — `ToolResult` 加 `exitCode` 字段
- `src/types.ts` — `Item` 加 `exitCode` 字段
- `src/tools/exec.ts`（重写）— 结构化返回：
  - `[exit code: N]` 标记退出码
  - `[stdout]` / `[stderr]` 分离输出
  - `isError` 由 `exitCode !== 0` 决定（不再靠 error 对象有无）
  - 超时特殊标记
- `src/agent/loop.ts` — 系统提示强化验证闭环指令（5 步验证循环）+ `AgentStep.toolResults` 携带 `exitCode`
- `src/thread/manager.ts` — tool_result Items 记录 `exitCode`
- 验证 4/4 通过

**系统提示新增内容（验证闭环）：**
```
# Validating work
## Exit codes
- exit code 0 = success
- exit code non-zero = failure → MUST fix

## Verification loop (MANDATORY)
1. Run tests
2. Check exit code
3. If non-zero → read error → fix → re-run
4. Never skip failures
5. Final confirmation — ALL tests pass with exit code 0
```

**数据流：**
```
exec tool → ToolResult { exitCode, content, isError }
  → AgentStep.toolResults [{ exitCode, ... }]
    → Item { exitCode, ... } (持久化到 Thread)
      → 前端展示（可按 exitCode 着色）
```

### 2026-04-06：步骤 10 完成 — 上下文压缩

**完成了什么：** Agent 能自动检测上下文溢出，通过 LLM 生成摘要压缩历史，支持 10+ 轮长任务。

**怎么做的：**
- `src/utils/token.ts`（新建）— token 估算模块
  - `approxTokenCount(text)` — 保守估算 `text.length / 3`
  - `estimateMessagesTokens(messages)` — 累加所有消息的 content + tool_calls 估算值
- `src/agent/compact.ts`（新建）— 上下文压缩引擎（对齐 Codex compact.rs）
  - `needsCompact()` — 检查 messages 是否超过阈值（80K token）
  - `compactMessages()` — 压缩流程：分离初始上下文 → LLM 摘要早期历史 → 保留最近 20K token → 重新组装
  - 摘要系统提示：保留关键决策/文件修改/错误，丢弃冗余工具输出
- `src/agent/loop.ts`（集成）— 每轮循环开始前调用 `compactMessages()`
- `src/utils/truncate.ts`（refactor）— `approxTokenCount` 提取到 `token.ts`，truncate.ts 改为 import
- 验证 6/6 通过

**压缩策略（对齐 Codex compact.rs）：**
```
原始 messages:
  [system] [AGENTS.md] [env] [user task] | [assistant+tool x 30 轮]
                                         ↓ 超过 80K token 阈值
压缩后 messages:
  [system] [AGENTS.md] [env] [user task] | [摘要] [assistant确认] | [最近 20K token 消息]
```

### 2026-04-06：步骤 9 完成 — 执行环境优化（输出边界）

**完成了什么：** 工具输出截断 + 执行环境变量抑制颜色/分页，防止上下文窗口被工具输出撑爆。

**怎么做的：**
- `src/utils/truncate.ts`（新建）— HeadTailBuffer 截断策略
  - `approxTokenCount(text)` — 保守估算 `text.length / 3`
  - `truncateOutput(content, maxTokens)` — 在预算内原样返回，超出则保留头尾、中间截断
  - 默认 10K token 上限（≈40KB）
- `src/tools/exec.ts`（改造）— 环境变量 + 结构化输出
  - 加 `NO_COLOR=1`, `TERM=dumb`, `PAGER=cat`, `GIT_PAGER=cat` 环境变量
  - 超时命令特殊提示 `[命令超时，30秒内未完成]`
- `src/agent/loop.ts`（1 行改动）— 工具结果进 messages 前调 `truncateOutput()`
- 验证 4/4 通过

### 2026-04-05：步骤 8 完成 — AGENTS.md 项目地图 + 增强系统提示

**完成了什么：** Agent 启动时自动加载项目 AGENTS.md，系统提示对齐 Codex prompt.md 结构。

**怎么做的：**
- `src/context.ts`（新建）— AGENTS.md 发现、加载、格式化、32KiB 限制
  - `findProjectRoot()` — 从 CWD 向上找 `.git` 确定项目根
  - `loadAgentsMd()` — 候选优先级 `AGENTS.override.md` > `AGENTS.md`
  - `formatAgentsMdInjection()` — `<INSTRUCTIONS>` 包裹 + user-role 注入
  - `buildEnvironmentContext()` — cwd、shell、日期、平台
- `src/agent/loop.ts`（重写）— 增强系统提示 + 初始上下文组装
  - `buildSystemPrompt()` — 6 段结构对齐 Codex prompt.md
  - `buildInitialMessages()` — 4 层组装：system → AGENTS.md → env → user
- `src/thread/manager.ts`（2 行改动）— `systemPrompt` 改用 `buildSystemPrompt()`
- `AGENTS.md`（新建）— 赤兔项目地图
- 验证 6/6 通过

**与 Codex 仓库比对结论：**
- 完全对齐：注入格式、注入顺序、候选文件优先级、32KiB 限制
- 可接受差距归入步骤 13 远期（分层收集、XML 格式、差异检测等）

### 2026-04-05：WebSocket App Server 端到端跑通

**完成了什么**：完整实现了 Codex App Server 的 4 层架构，WebSocket + JSON-RPC 2.0 协议。

**怎么做的**：
- JSON-RPC 2.0 协议层（json-rpc.ts）：类型、编解码、标准错误码
- Message Processor（message-processor.ts）：7 个路由 + 5 种通知映射
- WebSocket 服务器（index.ts）：连接管理 + 路由分发
- Turn 异步执行：turn/start 立即返回，Agent Loop 后台运行
- 客户端断线不中断 Turn：AbortController 按 threadId 管理
- 端到端测试 7/7 通过

**架构对齐 Codex**：
```
Transport (WebSocket) → Message Processor → Thread Manager → Core Threads
```

### 2026-04-05：事件系统对齐 Codex 协议

**完成了什么**：ThreadManager 加入事件发射，事件序列完全对齐 Codex App Server 协议。

**怎么做的**：
- types.ts 新增 AppEvent 联合类型（thread/started, turn/started, turn/completed, item/started, item/completed）
- manager.ts 新增 onEvent(handler) + emit() 方法
- addItem 内部 emit item/started → item/completed（对齐 Codex Item 生命周期）
- runTurn emit turn/started → turn/completed
- create emit thread/started
- 7/7 自动化测试验证事件顺序

**架构 Review 结论**：
- Codex 4 组件（stdio reader → Message Processor → Thread Manager → Core Threads）中，我们已有后两个
- Step 6 需要补 Message Processor 层（JSON-RPC ↔ 事件的翻译层）
- 传输用 WebSocket（比 Codex 的 stdio 更适合浏览器场景）

### 2026-04-04：Agent 自主运行能力达成

**完成了什么**：Agent 能自主接收任务、循环执行工具、直到任务完成。

**怎么完成的**：
- Agent Loop (agent/loop.ts) 实现 while 循环
- 4 个核心工具：exec, read_file, write_file, edit_file
- Tool Registry 模式让工具可扩展

**遇到的问题**：
1. API endpoint 路径错误 → 改为 coding endpoint
2. .env 文件不自动加载 → 安装 dotenv
3. tsconfig 缺少 "types": ["node"] → process.env 报红
