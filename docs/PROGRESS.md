# 赤兔 (Chitu) 进度记录

## 已完成的步骤

- [x] **第 1 步：调通 GLM-5 API** ✅
- [x] **第 2 步：Tool 系统 (exec 工具 + Registry)** ✅
- [x] **第 3 步：Agent Loop** ✅
  - 核心 while 循环：LLM → tool_calls → 执行 → 循环
  - 简单任务 2 轮完成，多步任务 2 轮完成
- [x] **第 4 步：文件工具 (read/write/edit)** ✅
  - Agent 自主完成：创建目录 → 写文件 → 编辑文件 → 读取验证

## 当前步骤

- [ ] **第 5 步：Thread/Turn/Item + ThreadManager**

### 第 5 步详细拆分

- [ ] 5.1 类型定义 `src/types.ts`
  - Thread: id, title, status(created/active/idle/archived), items[]
  - Turn: id, threadId, status(in_progress/completed/interrupted/failed)
  - Item: id, type, status(started/completed), content + 工具相关字段
  - Item 类型：user_message, assistant_message, tool_call, tool_result
  - 事件类型：AgentEvent (item/started, item/delta, item/completed, turn/completed)

- [ ] 5.2 ThreadManager `src/thread/manager.ts`
  - create(title?): Thread — 创建新线程
  - resume(threadId): Thread — 恢复线程（重连场景）
  - archive(threadId): void — 归档线程
  - startTurn(threadId, userInput): Turn — 开始新一轮
  - addItem(threadId, item): void — 添加 Item
  - completeTurn(threadId): void — 完成 Turn
  - listThreads(): Thread[]
  - getThread(id): Thread

- [ ] 5.3 持久化 `src/thread/store.ts`
  - JSON 文件存储（data/threads/{id}.json）
  - saveThread / loadThread / listThreadIds / deleteThread
  - Turn 结束时保存（不每次 Item 都写磁盘）

- [ ] 5.4 集成 Agent Loop
  - Agent Loop 接收 ThreadManager，操作 Thread/Turn/Item
  - 每一步工具调用和回复都记录为 Item
  - 测试：多轮对话 + 重连恢复

### 第 5 步暂不做的（后面加）

- [ ] approval_request（审批流，Server → Client 请求）
- [ ] diff（文件差异展示）
- [ ] fork（线程分叉，从某个节点分出新线程）
- [ ] delta 事件（流式增量，第 6 步加 WebSocket 后才有意义）

## 后续步骤

- [ ] **第 6 步：WebSocket 服务器**
  - JSON-RPC 2.0 路由
  - 对外暴露 Thread 操作：thread/create, thread/resume, turn/start, turn/interrupt
  - 事件推送：item/started, item/delta, item/completed, turn/completed
  - 双向通信（Server 可发请求给 Client）

- [ ] **第 7 步：前端**
  - Vite + React + TailwindCSS
  - WebSocket JSON-RPC 客户端
  - 聊天界面 + 工具调用展示 + 取消按钮

- [ ] **第 8 步：上下文压缩**
  - Token 计数估算
  - 超阈值时自动压缩（让 LLM 总结历史）
  - 支持长任务不爆上下文

## 里程碑记录

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
