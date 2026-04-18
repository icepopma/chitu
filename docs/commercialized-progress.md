# 赤兔 (Chitu) 商业化功能路线图

> 对齐 OpenAI Codex 生产级架构，识别赤兔从学习项目走向商业产品需要的差距
> 每个功能标注 Codex 仓库参考路径和博客文章引用源

## 状态说明

- ❌ 未开始
- 🔜 计划中
- 🚧 进行中
- ✅ 已完成

---

## 第一批：必须做（不做没人敢用）

### 1.1 数据库存储（替代 JSON 文件） ❌

**现状：** 所有数据（threads、memories、hooks）都是 JSON 文件，无事务、无并发、无查询能力。

**Codex 做法：**
- **仓库：** `codex-rs/state/` — 完整的 SQLite 状态管理层
  - `codex-rs/state/src/lib.rs` — StateRuntime 入口
  - `codex-rs/state/src/runtime.rs` — 数据库运行时（WAL 模式、连接池）
  - `codex-rs/state/migrations/` — 24 个版本化 SQL 迁移（`0001_threads.sql` → `0024_remote_control_enrollments.sql`）
  - `codex-rs/state/src/model/` — ThreadMetadata、AgentJob、LogEntry 等数据模型
- **关键设计：** 双数据库架构（`state.db` + `logs.db`），减少锁竞争；连接池 `max_connections(5)` + 5 秒 busy timeout；增量 VACUUM
- **博客：** 文章 3 "Unlocking the Codex Harness" — 线程生命周期章节
  > "Codex 可创建、恢复、派生和归档线程，并持久保存事件历史记录，以便客户端重新连接并呈现一致的时间线"

**实现方案：**
- 引入 `better-sqlite3`（同步 SQLite，性能好，无需 async 复杂性）
- 迁移：threads 表、rollout_events 表、memories 表、hooks_config 表
- ThreadStore 改为 SQLite 查询
- MemoryStorage 改为 SQLite
- 保持 JSONL rollout 文件作为备份（对齐 Codex 双写策略）

---

### 1.2 LLM API 可靠性（重试 + 降级） ❌

**现状：** API 调用失败直接抛异常，无重试、无降级、无熔断。

**Codex 做法：**
- **仓库：** `codex-rs/core/src/client.rs` — ModelClient
  - 指数退避重试（exponential backoff）
  - 自动 fallback 到备用模型
  - WebSocket 预热（连接复用）
  - 区分瞬态错误 vs 永久错误
  - Token 粘性路由（`x-codex-turn-state`）
  - 速率限制感知 + 自动退避
- **博客：** 文章 1 "Unrolling the Codex Agent Loop" — 性能章节
  > "采样模型的开销通常远大于网络流量，因此采样是我们效率优化的主要目标。这就是 prompt caching 如此重要的原因"

**实现方案：**
- `src/llm/client.ts` 新增 `chatWithRetry()` — 3 次重试 + 指数退避（1s, 2s, 4s）
- 区分 429（限流）/ 500（服务端）/ 400（客户端）错误码
- 429 和 500 自动重试，400 不重试
- 可选 fallback model 配置（主模型失败 → 降级到便宜模型）

---

### 1.3 服务端状态持久化（Crash Recovery） ❌

**现状：** envSnapshots 在内存中，服务重启丢失；turn 中途崩溃无法恢复。

**Codex 做法：**
- **仓库：**
  - `codex-rs/rollout/src/recorder.rs` — JSONL 事件记录
  - `codex-rs/rollout/src/state_db.rs` — SQLite 状态集成
  - `codex-rs/core/src/state/session.rs` — SessionState 持久化
  - `codex-rs/rollout/src/metadata.rs` — 会话元数据
  - `codex-rs/rollout/src/session_index.rs` — 按 ID/名称快速查找
- **关键设计：** TurnState 跟踪活跃 turn 和运行中的任务；自动从不完整操作中恢复；可配置历史截断
- **博客：** 文章 3 "Unlocking the Codex Harness" — 重连支持章节
  > "流式传输协议和已保存的线程会话可支持新会话轻松实现重新连接、从中断处继续运行"

**实现方案：**
- Turn 开始时写入 `state.db` 的 `active_turns` 表
- Turn 完成/失败时标记完成
- 服务启动时扫描 `active_turns`，未完成的 turn 标记为 `interrupted`
- envSnapshots 持久化到数据库

---

### 1.4 WebSocket 认证（JWT） ❌

**现状：** 任何人连接 ws://localhost:8080 即可使用，无认证。

**Codex 做法：**
- **仓库：** `codex-rs/login/` — 完整认证系统
  - `codex-rs/login/src/lib.rs` — 认证入口
  - `codex-rs/login/src/auth/manager.rs` — AuthManager（Token 自动刷新）
  - `codex-rs/login/src/auth/storage.rs` — 凭据存储（OS keyring + 文件后备，`0o600` 权限）
  - `codex-rs/login/src/device_code_auth.rs` — OAuth Device Code Flow
  - `codex-rs/core/src/client.rs` — 多种认证方式（API Key / ChatGPT OAuth / Device Code）
- **博客：** 文章 3 "Unlocking the Codex Harness" — 配置和身份验证章节
  > "Codex 可加载配置、管理默认值，并运行'使用 ChatGPT 登录'等身份验证流程，包括凭据状态"
- **博客：** 文章 1 "Unrolling the Codex Agent Loop" — 认证端点章节
  > "使用 ChatGPT 登录时使用 `https://chatgpt.com/backend-api/codex/responses`，使用 API Key 时使用 `https://api.openai.com/v1/responses`"

**实现方案：**
- 首期：API Key 认证（WebSocket 握手时传递 `?token=xxx`）
- 二期：JWT Token + 刷新机制
- 三期：OAuth Device Code Flow（对齐 Codex）

---

### 1.5 沙盒执行（容器隔离） ❌

**现状：** Agent 可执行任意 shell 命令，只靠审批拦截。误操作可破坏整个文件系统。

**Codex 做法：**
- **仓库：** `codex-rs/sandboxing/` — 完整沙盒引擎
  - `codex-rs/sandboxing/src/lib.rs` — 沙盒抽象层
  - `codex-rs/sandboxing/src/bwrap.rs` — Linux bubblewrap（用户命名空间隔离）
  - `codex-rs/sandboxing/src/seatbelt.rs` — macOS Seatbelt 策略
  - `codex-rs/sandboxing/src/landlock.rs` — Linux Landlock 文件系统限制
  - `codex-rs/sandboxing/src/manager.rs` — SandboxManager（策略转换和执行）
  - `codex-rs/linux-sandbox/` — Linux 专用沙盒
  - `codex-rs/windows-sandbox-rs/` — Windows 受限 Token
  - `docs/sandbox.md` — 沙盒文档
- **关键设计：** 分层策略（文件系统 + 网络）；网络隔离（代理、Unix socket、loopback 限制）；子进程自动清理；运行时策略动态生成
- **博客：** 文章 1 "Unrolling the Codex Agent Loop" — 工具执行和安全章节
  > "一条 role=developer 的消息描述了仅适用于 Codex 提供的 shell 工具的沙盒。其他工具（如 MCP 提供的）不受 Codex 沙盒保护，需自行实现防护"
- **博客：** 文章 3 "Unlocking the Codex Harness" — 容器化环境
  > "Codex Web 使用 Codex 运行框架，但其在容器环境中运行。工作节点提供已签出工作空间的容器"

**实现方案：**
- macOS：使用 `sandbox-exec`（Seatbelt 策略）
- Linux：使用 Docker 容器或 bubblewrap
- 策略：只读项目根目录（除指定可写路径）+ 禁止网络访问 + 资源限制

---

## 第二批：竞争力（做了才有卖点）

### 2.1 CLI 模式（终端界面） ❌

**现状：** 只有 Web UI，无终端入口。

**Codex 做法：**
- **仓库：** `codex-rs/tui/` — 完整 TUI 实现
  - `codex-rs/tui/src/main.rs` — TUI 入口
  - `codex-rs/tui/src/app.rs` — 主应用逻辑
  - `codex-rs/tui/src/chatwidget.rs` — 聊天界面组件
  - `codex-rs/tui/src/frame_rate_limiter.rs` — 120 FPS 帧率限制
- **关键设计：** Ratatui 框架；异步事件处理；Actor 架构重绘合并；Markdown 渲染；主题系统
- **博客：** 文章 1 "Unrolling the Codex Agent Loop" — 跨平台设计章节
  > "Codex CLI 是我们的跨平台本地软件 Agent，旨在安全高效地在你的机器上产生高质量、可靠的软件更改"
- **博客：** 文章 3 "Unlocking the Codex Harness" — 客户端集成章节
  > "本地客户端通常会捆绑或获取特定平台的 App Server 二进制文件，将其作为一个长期运行的子进程启动，并为 JSON-RPC 开通一个双向 stdio 通道"

**实现方案：**
- 使用 `ink`（React for CLI）或 `blessed` 构建 TUI
- 通过 stdio JSON-RPC 与 App Server 通信（对齐 Codex 的 Transport 层）
- 支持 `chitu` 命令直接启动

---

### 2.2 代码语义索引（AST + Embedding 搜索） ❌

**现状：** Agent 只能用 `rg`、`cat`、`read_file` 搜索代码，无法理解代码结构。

**Codex 做法：**
- Codex 依赖 OpenAI 的 code search 能力和 `rg` 组合
- **博客：** 文章 1 "Unrolling the Codex Agent Loop" — 工具定义章节
  > "搜索文本或文件时优先使用 rg，因为它比其他工具快得多"

**实现方案：**
- 使用 `tree-sitter` 解析项目 AST，构建符号索引（类、函数、变量）
- 用 embedding 向量化代码片段，支持语义搜索
- 注入索引信息到 Agent 上下文（"项目中有 X 个文件、Y 个函数"）

---

### 2.3 多 Agent 协作（子任务拆分 + 并行） ❌

**现状：** 单 Agent 串行执行，无法并行处理子任务。

**Codex 做法：**
- **仓库：**
  - `codex-rs/core/src/spawn.rs` — `spawn_child_async()` 子进程派发
  - `codex-rs/core/src/agent/control.rs` — 多 Agent 控制面
  - `codex-rs/core/src/agent/registry.rs` — Agent 注册和生命周期
  - `codex-rs/core/src/agent/mailbox.rs` — Agent 间消息传递
  - `codex-rs/core/templates/collab/` — 协作模式模板
  - `codex-rs/core/templates/collaboration_mode/` — 多 Agent 协作模板
- **关键设计：** 深度限制 + 昵称分配 + 路径解析；Agent 间消息传递；Fork 支持 + 历史截断；子进程自动清理；实时状态追踪
- **博客：** 文章 2 "Harness Engineering" — Agent 对 Agent 审核章节
  > "人类可以审核 Pull Request，但并非必须。随着时间的推移，我们已将几乎所有的审核工作调整为用智能体对智能体的方式来处理"
- **博客：** 文章 2 "Harness Engineering" — Ralph Wiggum 循环章节
  > "我们会指示 Codex 在本地审核其自身的更改，在本地和云端请求额外的特定智能体审查，对任何人工或智能体给出的反馈做出响应，并循环往复，直到所有智能体审核人员都满意为止"
- **博客：** 文章 3 "Unlocking the Codex Harness" — 并行编排章节
  > "Codex 桌面应用需要并行编排多个 Codex 智能体"

**实现方案：**
- `src/agent/spawn.ts` — 子 Agent 派发（每个子任务一个独立 Agent Loop 实例）
- Agent 间通过消息队列通信
- 深度限制（最多 3 层嵌套）防止失控

---

### 2.4 MCP 集成（工具生态） ❌

**现状：** 工具系统完全内置，无法接入外部工具服务。

**Codex 做法：**
- **仓库：**
  - `codex-rs/mcp-server/src/lib.rs` — Codex 作为 MCP Server
  - `codex-rs/rmcp-client/src/lib.rs` — MCP Client（含 OAuth）
  - `codex-rs/core/src/mcp.rs` — 核心 MCP 集成
  - `codex-rs/core/src/mcp/mcp_connection_manager.rs` — 连接管理
  - `codex-rs/core/src/mcp/mcp_tool_approval_templates.rs` — MCP 工具审批模板
  - `codex-rs/core/src/mcp/mcp_tool_call.rs` — MCP 工具调用
- **关键设计：** JSON-RPC 协议 + stdio 传输；OAuth 自动 Token 刷新；动态工具发现和注册；用户审批流程；多服务器支持
- **博客：** 文章 1 "Unrolling the Codex Agent Loop" — 安全章节
  > "其他工具，如那些从 MCP 服务器提供的工具，不受 Codex 沙盒保护，需自行实现防护"

**实现方案：**
- 实现 MCP Client（`src/mcp/client.ts`），支持 stdio 和 SSE 传输
- 动态加载 MCP Server 的工具定义，注册到 ToolRegistry
- 支持 MCP 工具的审批流程

---

### 2.5 IDE 插件（VS Code） ❌

**现状：** 无 IDE 集成。

**Codex 做法：**
- **博客：** 文章 3 "Unlocking the Codex Harness" — VS Code 集成章节
  > "在我们的 VS Code 扩展和桌面应用中，随附的工件包含特定平台的 Codex 二进制文件，并固定为已测试版本，以便客户端始终运行与验证完全一致的代码"
- Codex 支持 VS Code、JetBrains、Xcode 集成

**实现方案：**
- VS Code 扩展通过 stdio JSON-RPC 与 App Server 通信
- 侧边栏 Chat 面板
- 编辑器内联 diff 预览
- 快捷键触发

---

## 第三批：规模化（用户量起来后做）

### 3.1 用户系统 + 组织 + 权限 ❌

**实现方案：**
- 用户注册/登录（邮箱 / GitHub OAuth）
- 组织（Organization）概念 — 多人共享工作空间
- 角色：Owner / Admin / Member / Viewer
- 每个 Thread 归属一个用户，可选共享到组织
- API Key 管理（每个用户/组织可创建多个 key）

---

### 3.2 用量追踪 + 计费 ❌

**Codex 参考：**
- **仓库：** `codex-rs/core/src/client.rs` — `RateLimitSnapshot`（credits + plan 信息）
- **仓库：** `codex-rs/core/src/turn_timing.rs` — `TurnTimingState`（TTFT、TTFM 等指标）
- Token 用量追踪（prompt_tokens、completion_tokens、total_tokens）

**实现方案：**
- 每次 turn 记录 token 消耗到 `usage_logs` 表
- 按 user/org 聚合每日/每月用量
- 配额系统：免费额度 + 付费套餐
- Dashboard 展示用量趋势

---

### 3.3 监控 + 告警 ❌

**Codex 做法：**
- **仓库：** `codex-rs/otel/` — 完整 OpenTelemetry 集成
  - `codex-rs/otel/src/lib.rs` — OTEL Provider 管理
  - `codex-rs/core/src/otel_init.rs` — OTEL 初始化
  - `codex-rs/core/src/turn_timing.rs` — Turn 级别性能指标（TTFT、TTFM）
- **关键设计：** 分布式追踪（W3C trace context）；自定义指标（turns、tools、tokens）；多种导出器（OTLP gRPC/HTTP、console、file）

**实现方案：**
- Prometheus metrics（turn 耗时、token 消耗、API 错误率、活跃连接数）
- 结构化日志（JSON 格式 + request ID 关联）
- `/health` endpoint（存活探针）
- `/metrics` endpoint（Prometheus 抓取）

---

### 3.4 Docker + CI/CD ❌

**Codex 参考：**
- **博客：** 文章 3 "Unlocking the Codex Harness" — 容器化章节
  > "Codex Web 使用 Codex 运行框架，但其在容器环境中运行。工作节点提供已签出工作空间的容器"

**实现方案：**
- Dockerfile（多阶段构建：build → production）
- `docker-compose.yml`（server + frontend + SQLite volume）
- GitHub Actions CI（lint + type check + E2E test）
- GitHub Actions CD（自动构建 + 推送镜像 + 部署）

---

### 3.5 分层配置系统 ❌

**Codex 做法：**
- **仓库：** `codex-rs/config/`
  - `codex-rs/config/src/lib.rs` — 配置入口
  - `codex-rs/config/src/state.rs` — ConfigLayerStack（分层叠加）
  - `codex-rs/config/src/merge.rs` — 配置合并逻辑
  - `codex-rs/config/src/diagnostics.rs` — 配置错误处理
- **关键设计：** MDM → 系统 → 用户 → 项目 → CLI 参数五层叠加；来源追踪（哪个层贡献了哪个设置）；动态热重载
- **博客：** 文章 3 "Unlocking the Codex Harness" — 向后兼容章节
  > "App Server 的 JSON-RPC 接口采用向后兼容设计，因此旧版客户端可以安全地与新版服务器通信"

**实现方案：**
- 配置层：全局 `~/.chitu/config.json` → 项目 `.chitu/config.json` → 环境变量 → CLI 参数
- 合并策略：后者覆盖前者
- 支持配置验证 + 错误提示

---

### 3.6 Git 深度集成 ❌

**Codex 做法：**
- **仓库：**
  - `codex-rs/git-utils/src/lib.rs` — Git 工具库
  - `codex-rs/git-utils/src/ghost_commits.rs` — Ghost Commit（临时快照）
  - `codex-rs/git-utils/src/apply.rs` — Git Patch 应用
  - `codex-rs/core/src/commit_attribution.rs` — 提交归属（Co-authored-by）

**实现方案：**
- `src/tools/git.ts` — 结构化 git 工具（status、diff、blame、log）
- Ghost Commit：工具执行前自动 git stash，失败时自动回滚
- 提交归属：自动添加 `Co-authored-by: Chitu Agent` 到 commit message

---

### 3.7 Review 模式 ❌

**Codex 做法：**
- **仓库：**
  - `codex-rs/core/review_prompt.md` — 审查专用提示词
  - `codex-rs/core/src/review_prompts.rs` — 审查提示词管理
- **博客：** 文章 2 "Harness Engineering" — Agent 对 Agent 审核章节
  > "我们已将几乎所有的审核工作调整为用智能体对智能体的方式来处理"

**实现方案：**
- 新增 `review` 模式：Agent 只审查不修改
- 专用 system prompt（审查 diff 格式输出）
- 前端展示审查结果（问题列表 + 建议修改）

---

### 3.8 多模态支持 ❌

**实现方案：**
- 图片输入：支持截图/设计稿上传，Agent 通过 multimodal LLM 理解
- 图片输出：Mermaid/PlantUML 图表生成
- 与 `mcp__4_5v_mcp__analyze_image` 类似的图片分析能力

---

## 优先级总览

```
第一批（必须做）         第二批（竞争力）          第三批（规模化）
─────────────────       ──────────────────       ──────────────────
1.1 数据库存储 ████      2.1 CLI 模式 ████        3.1 用户系统 ████
1.2 API 可靠性 ████      2.2 代码索引 ████        3.2 用量计费 ███
1.3 崩溃恢复 ████        2.3 多 Agent  ████       3.3 监控告警 ███
1.4 认证     ████        2.4 MCP 集成 ████        3.4 Docker   ███
1.5 沙盒     ████        2.5 IDE 插件 ████        3.5 配置系统 ██
                                                  3.6 Git 集成 ██
                                                  3.7 Review   █
                                                  3.8 多模态   █
```

## 依赖关系

```
1.1 数据库存储 ← 1.3 崩溃恢复（状态持久化需要数据库）
               ← 3.2 用量计费（用量记录需要数据库）

1.2 API 可靠性 ← 独立，优先级高

1.4 认证       ← 3.1 用户系统（认证是用户系统的基础）

1.5 沙盒       ← 2.1 CLI 模式（CLI 必须有沙盒保护）
               ← 2.3 多 Agent（子 Agent 需要沙盒隔离）

2.1 CLI 模式   ← 1.5 沙盒（安全前提）
               ← 2.5 IDE 插件（共用 Transport 层）

2.3 多 Agent   ← 1.5 沙盒
               ← 1.1 数据库（Agent 状态持久化）

2.4 MCP 集成   ← 独立，可与任何步骤并行
```

## 里程碑记录

_（待开始后记录）_
