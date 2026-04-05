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

### 第 5 步暂不做的（后面加）

- [ ] approval_request（审批流，Server → Client 请求）
- [ ] diff（文件差异展示）
- [ ] fork（线程分叉，从某个节点分出新线程）
- [ ] delta 事件（流式增量，第 6 步加 WebSocket 后才有意义）

## 下一步

### 第 6 步：WebSocket App Server（详细设计）

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

### 第 6 步暂不做的（后面加）

- [ ] **item/delta** 流式增量（需要 Agent Loop 支持 streaming，复杂度高）
- [ ] **approval_request** 审批流（Server → Client 主动请求，需要双向请求机制）
- [ ] **diff** Item 类型（文件差异展示）
- [ ] **多线程并行**（架构预留：每个线程独立 AbortController，暂不实现并发调度）
- [ ] **向后兼容**（initialize 交换版本号已预留，暂不实现版本协商逻辑）
- [ ] **配置和身份验证**（Codex 有 ChatGPT 登录流程，我们暂不需要）

---

- [ ] **第 6.5 步：项目上下文注入（agent.md 地图）**
  - 系统自动加载项目根目录的 agent.md
  - 把 agent.md 内容注入 system prompt，作为 Agent 的"地图"
  - Agent 不用盲目探索，一开始就知道项目结构、约定、注意事项
  - 来源：Codex 文章第 4 篇的"仓库作为记录系统"

- [ ] **第 7 步：前端**

#### 7.1 技术选型

| 技术 | 选择 | 原因 |
|---|---|---|
| 框架 | Vite + React 18 | 学习项目不需要 Next.js SSR |
| 样式 | TailwindCSS | 复用 agent-system-v2 的 Discord 暗色主题 |
| 状态管理 | Zustand | 轻量，agent-system-v2 已验证 |
| 图标 | Lucide React | agent-system-v2 同款 |
| WebSocket | 浏览器原生 | 连接 Chitu App Server |

#### 7.2 UI 布局（Discord 风格）

```
┌─────────┬───────────────────────────────────────────┐
│         │  Header — 线程标题 + 连接状态 + 取消按钮   │
│  🏠     ├───────────────────────────────────────────┤
│  ───    │                                           │
│  💬 线程1│  Messages                                 │
│  💬 线程2│  ┌─ User Message ─────────────────────┐  │
│  💬 线程3│  │ 请帮我创建一个文件                    │  │
│         │  └──────────────────────────────────────┘  │
│  ───    │  ┌─ Tool Call (可折叠) ─────────────────┐  │
│  ＋新建  │  │ 🔧 exec: echo "hello"                │  │
│         │  │ ↳ Hello                               │  │
│         │  └──────────────────────────────────────┘  │
│         │  ┌─ Assistant Message ──────────────────┐  │
│         │  │ 🐰 文件已创建完成！                    │  │
│         │  └──────────────────────────────────────┘  │
│         │                                           │
│         ├───────────────────────────────────────────┤
│         │  [  输入消息...                    ] [发送] │
└─────────┴───────────────────────────────────────────┘
```

**颜色方案**（复用 agent-system-v2 的 globals.css）：
- 背景: `#1a1a1a` / `#2a2a2a`
- 强调色: `#5865f2`（Discord 蓝紫）
- 文字: `#ffffff` / `#888888`
- 成功: `#43b581`
- 边框: `#2a2a2a`
- Discord 风格滚动条

#### 7.3 文件结构

```
web-ui/
  ├── index.html
  ├── vite.config.ts
  ├── tailwind.config.ts
  ├── postcss.config.js
  ├── package.json
  ├── src/
  │   ├── main.tsx                — 入口
  │   ├── App.tsx                 — 根组件 + 路由
  │   ├── index.css               — Tailwind + Discord 主题（复用 globals.css）
  │   ├── lib/
  │   │   ├── store.ts            — Zustand 状态（简化版）
  │   │   └── utils.ts            — cn() 工具函数
  │   ├── hooks/
  │   │   └── useChituSocket.ts   — WebSocket JSON-RPC 客户端
  │   ├── components/
  │   │   ├── Layout.tsx          — 三栏布局
  │   │   ├── Sidebar.tsx         — 线程列表（Discord 频道列表）
  │   │   ├── ChatArea.tsx        — 主聊天区（复用 chat-area.tsx 结构）
  │   │   ├── MessageList.tsx     — 消息列表
  │   │   ├── MessageItem.tsx     — 单条消息
  │   │   ├── ToolCallItem.tsx    — 工具调用（可折叠）
  │   │   ├── ChatInput.tsx       — 输入框 + 发送按钮
  │   │   └── WelcomeScreen.tsx   — 欢迎页
  │   └── types/
  │       └── index.ts            — 类型定义（对齐 Chitu types.ts）
```

#### 7.4 核心组件设计

**Layout.tsx** — 三栏布局
```
<div class="flex h-screen">
  <Sidebar />         {/* 左侧 240px */}
  <ChatArea />        {/* 右侧 flex-1 */}
</div>
```

**Sidebar.tsx** — Discord 频道列表
- 顶部 Logo + 标题 "赤兔"
- 连接状态指示灯（绿/红）
- 线程列表（点击切换，当前线程高亮）
- 底部 "＋ 新建对话" 按钮
- 复用 agent-system-v2 的 sidebar 结构

**ChatArea.tsx** — 主聊天区（复用 chat-area.tsx）
- Header: 线程标题 + Turn 状态 + 取消按钮
- MessageList: 滚动消息列表
- ChatInput: 输入框
- 无线程时显示 WelcomeScreen

**MessageItem.tsx** — 消息气泡
- user_message: 用户头像 + 消息内容
- assistant_message: 🐰 头像 + Markdown 渲染
- tool_call: 🔧 工具图标 + 折叠面板
- tool_result: ↳ 结果展示（代码块高亮）

**ToolCallItem.tsx** — 工具调用展示（可折叠）
```
┌─ 🔧 exec ───────────────────── [▼] ─┐
│  命令: echo "hello"                   │
│  结果: Hello                          │
└──────────────────────────────────────┘
```

**ChatInput.tsx** — 输入区（复用 chat-input.tsx）
- 自动扩展 textarea
- Enter 发送，Shift+Enter 换行
- 发送按钮（Turn 运行中变为取消按钮）

**WelcomeScreen.tsx** — 空状态欢迎页
- 🐰 大图标
- "你好，我是赤兔" 标题
- 能力列表
- 复用 agent-system-v2 的 welcome-screen.tsx

#### 7.5 状态管理（Zustand）

```typescript
interface AppState {
  // 连接
  connected: boolean
  initialized: boolean

  // 线程
  threads: Array<{ id: string; title: string; updatedAt: number }>
  currentThreadId: string | null

  // 消息 (Items)
  items: Item[]

  // Turn 状态
  turnStatus: 'idle' | 'running' | 'completed' | 'failed'

  // Actions
  selectThread: (id: string | null) => void
  addItem: (item: Item) => void
  updateItem: (itemId: string, update: Partial<Item>) => void
  clearItems: () => void
  setTurnStatus: (status: string) => void
}
```

#### 7.6 WebSocket Hook（useChituSocket.ts）

**参考 agent-system-v2 的 useAppServer.ts，简化重写：**

```
连接流程：
1. new WebSocket(serverUrl)
2. onopen → sendRequest('initialize', { clientInfo })
3. 收到 response → setIsInitialized(true)

消息交互：
4. sendRequest('thread/create') → 创建线程
5. sendRequest('turn/start', { threadId, message }) → 发消息
6. 收到 notifications → 更新 Zustand store

通知处理：
- thread/started → 添加到 threads 列表
- turn/started → setTurnStatus('running')
- item/started → addItem(item)
- item/completed → updateItem(id, item)
- turn/completed → setTurnStatus('idle')
```

**关键特性（复用 useAppServer.ts 的模式）：**
- pendingRequests Map 管理 request-response
- useRef 防闭包问题
- 连接状态管理
- 自动重连

#### 7.7 消息渲染逻辑

Items 按时间排序渲染，根据 type 分组：
```
[user_message]    → 消息气泡（用户）
  [tool_call]     → 工具调用（折叠）
  [tool_result]   → 工具结果（折叠内）
  [tool_call]     → 工具调用（折叠）
  [tool_result]   → 工具结果（折叠内）
[assistant_message] → 消息气泡（Agent）
```

#### 7.8 与 agent-system-v2 的复用关系

| 组件 | 来源 | 改动 |
|---|---|---|
| Layout | layout.tsx | 简化为两栏（去掉 diff/terminal 面板） |
| Sidebar | sidebar/ThreadList | 简化为纯线程列表 |
| ChatArea | chat-area.tsx | 基本复用，去掉 task/confirmation 逻辑 |
| MessageList | message-list.tsx | 复用，改用 Chitu Item 类型 |
| ChatInput | chat-input.tsx | 基本复用，去掉 model/sandbox 选择 |
| WelcomeScreen | welcome-screen.tsx | 基本复用 |
| globals.css | globals.css | 完全复用 Discord 暗色主题 |
| store.ts | store.ts | 简化，只保留线程/消息/连接状态 |
| useAppServer.ts | hooks/useAppServer.ts | 重写为 useChituSocket.ts，对齐 Chitu 协议 |

#### 7.9 验证方式

1. 启动 Chitu App Server（`npx tsx src/server/index.ts`）
2. 启动前端（`cd web-ui && npm run dev`）
3. 浏览器打开 → 看到 Discord 风格 UI
4. 点击 "新建对话" → 左侧出现新线程
5. 输入消息 → 看到 Agent 回复 + 工具调用过程
6. 点击取消 → Agent 停止
7. 切换线程 → 消息正确显示

- [ ] **第 8 步：上下文压缩**
  - Token 计数估算
  - 超阈值时自动压缩（让 LLM 总结历史）
  - 支持长任务不爆上下文

## 里程碑记录

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
