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
  - **验证：** ✅ 策略分类通过（ls=read, rm=dangerous, mkdir=write）

- [ ] **第 13 步：高级能力（远期）**
  - [ ] 13.1 会话事件流记录（Rollout Recording） — JSONL 记录 + resume/fork
  - [ ] 13.2 Skills 系统 — `SKILL.md` 可复用工作流
  - [ ] 13.3 多 Agent 协作 — 子任务拆分、并行执行、结果合并
  - [ ] 13.4 执行计划（PLANS.md） — 多小时任务的活文档管理
  - [ ] 13.5 沙盒执行 — Docker 容器隔离
  - [ ] 13.6 分层 AGENTS.md 收集（root-to-CWD 所有目录，非仅根目录）
  - [ ] 13.7 环境上下文改 XML 子元素格式（`<cwd>...</cwd>` 而非 key-value）
  - [ ] 13.8 系统提示补充最终回复格式规范（文件引用用反引号、标题分段）
  - [ ] 13.9 回合间环境差异检测（只发 delta，不重复注入）

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

## 里程碑记录

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
