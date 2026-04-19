# 赤兔文档 (Living Documentation)

本文档随实现持续更新，反映项目真实状态。

## 赤兔是什么

赤兔（Chitu）是一个教育型 AI Agent 系统，架构对齐 OpenAI Codex。使用 GLM-5（智谱AI）的 function calling 实现自主编程 Agent。系统由 WebSocket 后端（Node.js/TypeScript）和 React 前端（Discord 风格聊天 UI）组成。

## 当前状态

### 里程碑进度
- M1: ✅ 已完成（LLM API 可靠性）
- M2: ✅ 已完成（分层配置系统）
- M3: ✅ 已完成（Neon PostgreSQL 数据库存储）
- M4: ✅ 已完成（Crash Recovery）
- M5: ✅ 已完成（监控 + 告警）
- M6: ✅ 已完成（Git 深度集成）
- M7: ✅ 已完成（文件监听）
- M8: ✅ 已完成（多 Shell 支持）
- M9: ✅ 已完成（MCP 集成）
- M10: ✅ 已完成（WebSocket 认证）
- M11: ✅ 已完成（CLI 模式）
- M12: ✅ 已完成（沙盒执行）
- M13: ✅ 已完成（Docker + CI/CD）
- M14: ✅ 已完成（Review 模式）
- M15: ✅ 已完成（增强监控面板）
- M16: ✅ 已完成（多 Agent 协作）
- M17: ✅ 已完成（代码语义索引）
- M18: ✅ 已完成（IDE 插件 VS Code）
- M19: ✅ 已完成（用户系统 + 组织 + 权限）
- M20-M22: 待处理

### 优先级分组
| 优先级 | 范围 | Milestones |
|--------|------|-----------|
| P0 基础设施 | 让赤兔稳定运行 | M1 ✅, M2 ✅, M3 ✅ |
| P1 可观测+安全 | 让赤兔可信赖 | M4 ✅, M5 ✅, M6 ✅ |
| P2 平台支持 | 让赤兔跑在更多环境 | M7 ✅, M8 ✅ |
| P3 生态集成 | 扩展能力边界 | M9 ✅, M10 ✅ |
| P4 多端接入 | CLI/沙盒/容器 | M11 ✅, M12（沙盒）, M13（Docker CI） |
| P5 高级功能 | Review/监控/多Agent | M14 ✅（Review）, M15 ✅（监控增强）, M16 ✅（多Agent） |
| P6 远期目标 | 索引/IDE/用户/计费 | M17 ✅, M18 ✅, M19-M21 |
| P7 收尾 | 文档 | M22 |

### 已完成的核心能力

**基础架构：**
- Agent Loop（while 循环：LLM → tool_calls → 执行 → 重复，10000 次迭代上限）
- Thread/Turn/Item 协议（对齐 Codex）
- WebSocket JSON-RPC 2.0 传输层
- 插件式工具系统（PluginLoader + 依赖排序）
- Context Compaction（80K token 后自动压缩）
- 流式输出（item/delta 事件，逐 token 推送）
- System Prompt 对齐 Codex gpt_5_1_prompt.md（11 节结构）

**安全与可靠性：**
- 5 个 Hook 事件点（pre/post tool、session start/end、prompt submit）
- 安全审批系统（命令三级分类：read/write/dangerous）
- 自主运行模式（autoApprove + 前端 Zap 图标切换）
- LLM API 可靠性（M1）— 3 次 HTTP 指数退避重试 + 5 次 Agent Loop 重试 + 错误注入到上下文
- Crash Recovery（M4）— active_turns 表持久化 turn 状态，启动时扫描未完成 turn 标记为 interrupted，envSnapshots 持久化到数据库

**知识与记忆：**
- 跨 session 记忆提取和注入（5 种类别：preference/architecture/convention/failure/fact）
- Skills 加载系统（自动发现 .agents/skills/*/SKILL.md）

**规划与监控：**
- 里程碑计划工具（milestone_plan + git_checkpoint/git_rollback + 任务时长追踪）
- 监控面板（/dashboard endpoint + Discord 风格前端，含服务器信息、运行指标、里程碑进度、活动记录）
- **Prometheus 指标 + 结构化日志**（M5）— 8 个 Prometheus 指标（turn 耗时 histogram、turn 总数 counter、token 消耗 counter、LLM 请求计数/耗时、活跃连接 gauge、工具调用 counter），`/metrics` endpoint 输出标准 Prometheus exposition format。`/health` endpoint 返回 200。StructuredLogger 输出 JSON 格式日志（timestamp + level + message + requestId + context），已集成到 server、agent loop、hooks、message-processor。LLM metrics 通过 LlmMetrics 接口 + setMetrics() 注入避免循环依赖

**Git 深度集成：**
- **Git Plugin v2.0**（M6）— 8 个工具：4 个只读工具（git_status、git_diff、git_blame、git_log）+ 2 个写操作（git_checkpoint、git_rollback）+ 2 个 Ghost Commit 工具（ghost_commit、ghost_rollback）。Ghost Commit 使用 `git stash push -u` 创建临时快照，操作成功时 drop stash，失败时 pop stash 恢复。git_checkpoint 自动注入 `Co-authored-by: Chitu Agent <chitu@agent.local>` trailer。新增 `src/tools/git/` 目录下 6 个文件（status.ts、diff.ts、blame.ts、log.ts、ghost.ts、index.ts 重写）

**文件监听：**
- **File Watcher + Skills Hot-Reload**（M7）— 3 个新文件：`src/watcher/file-watcher.ts`（fs.watch recursive 监听项目文件变更，防抖 500ms，过滤 node_modules/.git/dist 等噪声目录），`src/watcher/skills-watcher.ts`（专门监听 `.agents/skills/` 目录变更，检测 SKILL.md 文件变化后全量重载 Skills），`src/watcher/file-change-buffer.ts`（生产者-消费者缓冲区，连接 FileWatcher 和 Agent Loop，100 事件上限防内存泄漏）。集成方式：server 启动时创建 FileWatcher + SkillsWatcher → ThreadManager 持有 FileChangeBuffer → Agent Loop 每轮循环开始时 flush buffer 并格式化为"文件变更通知"注入到上下文消息中。

**多 Shell 支持：**
- **Shell 检测**（M8）— 自动检测用户 shell（zsh/bash/sh/fish），替代硬编码 `/bin/bash`。检测优先级：`SHELL` 环境变量 → 平台默认（macOS → zsh, Linux → bash）→ 兜底 `/bin/sh`。新增 `src/utils/shell.ts`（107 行），定义 `ShellType`、`ShellInfo` 类型，导出 `detectShell()`、`getShellArgs()`、`getShellPath()` 函数。exec 工具、配置系统默认值、env-diff 均已切换到动态检测。

**MCP 集成：**
- **MCP Client**（M9）— 实现 MCP（Model Context Protocol）客户端，支持 stdio 传输协议，动态发现并注册 MCP 服务器提供的工具。新增 `src/mcp/` 目录（4 个文件）：`types.ts`（MCP 类型定义：McpServerConfig、McpTool、McpCallResult）、`client.ts`（319 行 McpClient 类：connect → handshake → tools/list 发现 → 工具注册，10 秒请求超时，SIGTERM 断连）、`loader.ts`（配置加载：全局 `~/.chitu/mcp.json` + 项目 `.chitu/mcp.json` 覆盖）、`index.ts`（模块入口）。工具命名规则 `mcp__{server}__{tool}` 防冲突。审批策略：`auto-approve`（自动通过）/ `ask-user`（需用户确认，默认）。MCP 工具加载失败不阻塞核心工具（容错设计）。ToolRegistry 新增 `loadMcpTools()` 和 `disconnectMcp()` 方法。

**WebSocket 认证：**
- **API Key + JWT 双模式认证**（M10）— WebSocket 握手阶段验证身份，未认证连接直接拒绝（HTTP 401）。新增 `src/auth/index.ts`（147 行）：`extractTokenFromRequest()` 从 URL query 参数 `?token=xxx` 提取令牌，`authenticateConnection()` 依次尝试 API Key → JWT 验证。API Key 验证使用 `crypto.timingSafeEqual()` 防时序攻击。JWT 实现零外部依赖：自写 base64url 解码 + HMAC-SHA256 签名验证 + `exp` 过期检查。开发模式：未配置 `CHITU_API_KEY` 和 `CHITU_JWT_SECRET` 时自动放行。WebSocket Server 通过 `verifyClient` 回调集成。

**CLI 模式：**
- **终端交互界面**（M11）— 放弃原计划的 `ink`（React for CLI），改用 Node.js 内置 `readline/promises` 实现零外部依赖的 TUI。新增 `src/cli/index.ts`（154 行）。关键决策：**进程内架构**（CLI 直接实例化 ThreadManager，不走 WebSocket/JSON-RPC），避免网络开销。功能：交互式提示符 `你 > `、事件驱动实时输出（🐎 turn 开始、🔧 工具调用、流式文本输出）、内联审批流程、SIGINT 优雅退出。package.json 新增 `bin.chitu` 和 `npm run cli` 脚本。

**沙盒执行：**
- **Sandbox 隔离**（M12）— exec 工具在沙盒中执行命令，macOS 使用 `sandbox-exec`（Seatbelt SBPL 策略），Linux 预留 Docker 接口。策略采用白名单模式（deny default）：允许读取系统路径和项目目录、允许写入指定可写路径（node_modules/.git/dist/tmp/chitu-data）和 /tmp 临时目录、禁止网络访问、允许进程创建和 IPC。沙盒可配置开关（Tool 接口 `sandboxEnabled` 属性）。策略文件写入 /tmp 临时文件，执行完毕后清理。exec 工具输出带 `[sandbox: macos]` 标记。新增 `src/sandbox/` 目录（4 个文件）。

**Docker + CI/CD：**
- **多阶段 Dockerfile**（M13）— 3 阶段构建：deps（安装依赖）→ build（tsc 编译后端 + Vite 构建前端）→ production（slim 镜像，只含生产依赖和构建产物）。生产镜像基于 `node:22-bookworm-slim`，最终大小远小于完整构建镜像。
- **docker-compose.yml**（M13）— 两个服务：server（Node.js 后端，端口 8080，含 healthcheck）+ frontend（nginx:alpine 托管前端静态文件，端口 3000）。支持 Neon PostgreSQL 环境变量透传，数据卷持久化 `chitu-data`。
- **GitHub Actions CI**（M13）— 3 个 job：lint-and-typecheck（后端 tsc + 前端 tsc + ESLint）、build（构建后端和前端）、docker（`docker build` 验证镜像构建成功）。触发条件：push/PR 到 main 分支。

**Review 模式：**
- **Review 模式**（M14）— Agent 只审查代码不修改。新增 `src/agent/review-prompt.ts`（专用系统提示 + 只读工具过滤 + 只读命令检测）。后端：`buildReviewSystemPrompt()` 生成审查专用 prompt（输出结构化审查结果：摘要/问题列表/建议修改/总体评价），`isToolAllowedInReview()` 过滤只允许 exec（只读命令）、read_file、git_status/diff/blame/log、update_plan。`isReadOnlyCommand()` 用正则检测 exec 命令是否只读（cat/ls/grep/git status 等）。ThreadManager.runTurn() 根据 `mode` 参数切换系统提示和工具集。前端：ChatInput 新增 Eye 图标切换 Review 模式，`sendMessage` 传递 `mode: 'review'` 到后端。完整链路：前端 toggle → JSON-RPC turn/start(mode) → MessageProcessor → ThreadManager → review prompt + 只读工具过滤。

**配置与存储：**
- **分层配置系统**（M2）— 4 层叠加：全局 `~/.chitu/config.json` → 项目 `.chitu/config.json` → 环境变量 → CLI 参数。后者覆盖前者。支持类型验证。7 个文件：types.ts（类型定义）、defaults.ts（默认值）、loader.ts（文件加载）、merge.ts（4 层合并）、env.ts（环境变量映射）、validate.ts（验证）、index.ts（入口 + 单例缓存）
- **Neon PostgreSQL 数据库存储**（M3）— ThreadStore + MemoryStorage 双写策略（PG 主存储 + JSON 文件备份），启动时自动运行 5 个迁移（threads、rollout_events、memories 表 + 索引 + active_turns 表），数据库不可用时自动降级到文件存储

**代码语义索引：**
- **代码符号搜索**（M17）— 使用 TypeScript Compiler API（`ts.createSourceFile`）解析项目 AST，提取符号索引（function、class、interface、type、variable、enum、method、property、import）。新增 `src/indexer/` 目录（6 个文件）：`types.ts`（SymbolEntry、SearchResult、IndexStats 类型定义）、`symbols.ts`（AST 解析器，支持 9 种符号类型提取，包含签名、导出状态、JSDoc 注释）、`search.ts`（关键词 + 驼峰/下划线拆分搜索，路径权重评分）、`indexer.ts`（CodeIndexer 主模块，递归文件遍历 + mtime 增量索引 + 懒加载）、`tool.ts`（`code_search` 工具，Agent 可查询符号索引）、`index.ts`（模块入口）。工具通过 `indexerPlugin` 注册到 PluginLoader。搜索评分：精确匹配(1.0) > 前缀匹配(0.9) > 包含匹配(0.8) > 驼峰拆分匹配(0.6) > 路径匹配(0.4) > 签名匹配(0.3) > 文档匹配(0.2)。核心代码加权 1.2x，导出符号加权 1.1x。

**沙盒修复（M17 期间）：**
- 修复 macOS sandbox-exec 降级逻辑：改进 exit code 提取（`typeof error.code === 'number' ? error.code : error.status ?? 1`），增强降级检测条件（`error !== null || stderr.includes('sandbox-exec')`）。

**多 Agent 协作：**
- **子 Agent 派发系统**（M16）— 新增 `src/agent/spawn.ts`，实现 AgentSpawner 类（管理子 Agent 生命周期）+ AsyncMessageQueue（Agent 间异步消息通信）+ createSpawnTool（agent_spawn 工具工厂函数）。深度限制 MAX_SPAWN_DEPTH=2（即 0=root, 1=子Agent, 2=孙Agent 三层嵌套）。子 Agent 拥有独立的 Agent Loop 实例和上下文窗口，共享父 Thread 的文件系统。工具集与父 Agent 相同但受深度限制（L2 子 Agent 不能再 spawn）。ThreadManager.runTurn() 中创建 spawner 并添加 spawnTool 到工具列表。子 Agent 开始/完成时通过回调发射 item/started、item/completed 事件。

**沙盒修复（M16 期间）：**
- 修复 macOS sandbox-exec 的 'unbound variable' 错误：将 `-p`（内联策略字符串）改为 `-f`（从文件读取策略），避免策略中的 S-expression 特殊字符被 shell 解析。降级条件简化为 `exitCode !== 0`（移除了多余的 `&& error` 检查），确保 sandbox-exec 失败时始终降级到直接执行。

**VS Code 扩展：**
- **IDE 插件**（M18）— 新增 `vscode-extension/` 目录（独立子项目）。扩展通过 WebSocket JSON-RPC 2.0 直接连接 App Server（复用现有协议，不需要 stdio 适配层）。包含 4 个核心文件：`extension.ts`（激活/停用生命周期，注册命令和配置监听）、`client.ts`（WebSocket JSON-RPC 客户端，自动重连 + 30 秒请求超时 + initialize 握手 + pending request 匹配）、`chat-provider.ts`（侧边栏 Chat WebView Provider，完整聊天 UI — 消息渲染、流式 delta 输出、工具调用显示、审批交互框）、`diff-provider.ts`（内联 diff 预览，TextDocumentContentProvider + vscode.diff 命令显示原始/修改对比）。贡献点：侧边栏 Chat 面板、4 个命令（openChat/sendSelection/showDiffPreview/newThread）、3 个快捷键（cmd+shift+c/e/n）、3 个配置项（serverUrl/autoApprove/token）。支持认证 Token 透传（URL query 参数 `?token=xxx`）。

**用户系统 + 组织权限：**
- **用户注册/登录 + 组织管理**（M19）— 新增 `src/auth/user-store.ts`（用户 CRUD + 密码哈希 + JWT 生成 + 组织管理）和 `src/server/user-handlers.ts`（JSON-RPC 薄适配层）。`src/server/message-processor.ts` 新增 8 个 JSON-RPC 方法：`auth/register`（注册）、`auth/login`（登录返回 JWT）、`auth/getUser`（获取用户信息）、`org/create`（创建组织）、`org/addMember`（添加成员）、`org/listMembers`（列出成员）、`org/list`（列出用户组织）、`admin/listUsers`（管理员列出所有用户）。Thread 类型新增 `ownerId` 和 `orgId` 可选字段，ThreadStore PG 读写和 ThreadManager.create/fork 均已更新支持归属关系。数据库迁移 006-008 创建 users 表、organizations/org_members 表、threads 添加 owner_id/org_id 列。

## 本地启动

### 后端
```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npx tsx src/start-server.ts
```

### CLI 模式
```bash
# 终端交互
npm run cli
```

### 环境变量
- `ZHIPU_API_KEY` — 智谱 AI API Key（必需）
- `ZHIPU_CODING_ENDPOINT` — GLM-5 API 端点（可选，有默认值）
- `NEON_DATABASE_URL` — Neon PostgreSQL 连接串（可选，未配置时自动降级到文件存储）
- `CHITU_API_KEY` — WebSocket 静态 API Key 认证（可选）
- `CHITU_JWT_SECRET` — JWT 令牌签名密钥（可选）
- `CHITU_AUTH_DISABLED` — 禁用认证，开发模式用（可选）

### 前端
```bash
cd web-ui && npm run dev
```

### 访问
- Web UI: http://localhost:3000
- WebSocket: ws://localhost:8080
- 健康检查: http://localhost:8080/health
- Prometheus 指标: http://localhost:8080/metrics
- 状态接口: http://localhost:8080/status
- 监控面板 API: http://localhost:8080/dashboard

## 验证命令

- `npx tsc --noEmit` — TypeScript 类型检查
- `npm test` — 运行测试套件
- `npm run build` — 编译 TypeScript
- `cd web-ui && npm run lint` — 前端 ESLint

## 项目结构

```
src/
  agent/        — Agent Loop（核心循环）+ context compaction + spawn（子 Agent 派发）
  auth/         — WebSocket 认证（API Key + JWT）
  cli/          — CLI 终端模式（readline TUI）
  config/       — 分层配置系统（types/defaults/loader/merge/env/validate）
  context.ts    — AGENTS.md 层级加载 + 环境上下文
  db/           — 数据库连接 + 迁移 + Crash Recovery（Neon PostgreSQL）
  hooks/        — 5 个事件点的 Shell Hook 分发器
  llm/          — GLM-5 API 客户端（SSE streaming + 重试 + metrics 集成）
  mcp/          — MCP 客户端（stdio 传输 + 动态工具发现）
  memories/     — 跨 session 知识提取和注入（PG 主 + JSON 备份）
  monitoring/   — Prometheus 指标（metrics.ts）+ 结构化 JSON 日志（logger.ts）
  rollout/      — JSONL 事件记录（审计/调试回放）
  server/       — WebSocket 传输 + JSON-RPC + HTTP endpoints
  skills/       — Skills 加载系统
  thread/       — ThreadManager + ThreadStore（PG 主 + JSON 备份）
  tools/        — 工具系统：PluginLoader + 多个 Plugin（exec, files, plan, milestone, git v2.0, indexer）
  indexer/      — 代码语义索引：AST 符号解析 + 搜索引擎 + code_search 工具
  sandbox/      — 沙盒执行：Seatbelt 策略 + 统一执行器（macOS sandbox-exec / Linux Docker）
  utils/        — 通用工具（shell 检测、环境快照 diff）
  watcher/      — 文件监听：FileWatcher + SkillsWatcher + FileChangeBuffer
  types.ts      — 核心类型（Thread/Turn/Item/AppEvent）
web-ui/         — React 19 + Vite 8 前端（Discord 风格）
vscode-extension/ — VS Code 扩展（侧边栏 Chat + 内联 diff + 快捷键）
docs/           — prompt.md + implement.md + documentation.md + 架构文档
plans.md        — 里程碑执行计划（22 个 milestones，唯一真相源）
Dockerfile      — 多阶段 Docker 构建（deps → build → production）
docker-compose.yml — server + frontend 容器编排
.dockerignore   — Docker 构建排除文件
.github/workflows/ci.yml — GitHub Actions CI（lint + typecheck + build + docker）
```

## 架构

4 层架构，对齐 Codex：

```
Transport (WebSocket/JSON-RPC)
  → Message Processor (JSON-RPC ↔ ThreadManager 翻译)
    → Thread Manager (create/resume/runTurn/fork)
      → Agent Loop (while loop: LLM → tool_calls → execute → repeat)
```

CLI 模式绕过前 2 层，直接实例化 ThreadManager：

```
CLI (readline)
  → Thread Manager (direct, no JSON-RPC)
    → Agent Loop
```

数据流：用户消息 → JSON-RPC → MessageProcessor → ThreadManager.runTurn() → Agent Loop → LLM + Tools → 事件流 → WebSocket 通知 → 前端

## 已知问题 / 后续

- ~~数据存储还是 JSON 文件，需迁移到 Neon PostgreSQL（M3）~~ ✅ 已完成
- ~~无分层配置系统（M2）~~ ✅ 已完成
- ~~无 Crash Recovery，进程崩溃丢失 turn 状态（M4）~~ ✅ 已完成
- ~~无结构化日志和 Prometheus 指标（M5）~~ ✅ 已完成
- ~~无 Git 深度集成（M6）~~ ✅ 已完成
- ~~无文件监听，Agent 无法感知外部变更（M7）~~ ✅ 已完成
- ~~硬编码 `/bin/bash`，需多 Shell 支持（M8）~~ ✅ 已完成
- ~~无 MCP 工具生态集成（M9）~~ ✅ 已完成
- ~~WebSocket 无认证（M10）~~ ✅ 已完成
- ~~无 CLI 终端模式（M11）~~ ✅ 已完成
- ~~exec 工具无沙盒隔离（M12）~~ ✅ 已完成
- 无 CI/CD（M13）→ ✅ 已完成
- ~~监控面板指标不够丰富，需对标 Hermes HUD 增强（M15）~~ ✅ 已完成
- ~~无子 Agent 派发能力（M16）~~ ✅ 已完成
- macOS sandbox-exec -p 标志导致 'unbound variable' 错误 → ✅ 已修复（改为 -f）
- ~~无代码语义索引，Agent 无法快速查找符号定义（M17）~~ ✅ 已完成
- ~~无 IDE 插件支持（M18）~~ ✅ 已完成
- ~~无用户系统和组织权限（M19）~~ ✅ 已完成

## 设计决策记录

### M2: 分层配置系统
- **决策**：4 层叠加（全局 → 项目 → 环境变量 → CLI），参考 Codex codex-rs/config/
- **为什么**：不同项目可能需要不同的端口、模型、超时设置。分层让全局默认值被项目级配置覆盖，CLI 参数最高优先级方便临时调试。
- **Trade-off**：增加了首次理解的复杂度，但换来了灵活性。用 `getConfig()` 单例缓存避免重复加载。

### M3: Neon PostgreSQL 数据库存储
- **决策**：双写策略 — PG 主存储 + JSON 文件备份，数据库不可用时自动降级
- **为什么**：Neon serverless 自动休眠不扣费，适合开发和小规模使用。JSON 备份确保即使数据库挂了数据也不丢。`ON CONFLICT DO UPDATE` 实现幂等写入。
- **Trade-off**：双写有轻微性能开销，但保证了数据安全。`neon()` SQL 模板标签函数天然防 SQL 注入。

### M4: Crash Recovery
- **决策**：active_turns 表 + 启动时扫描 interrupted
- **为什么**：进程崩溃时内存中的 turn 状态全部丢失。写入数据库后，重启时可以知道哪些 turn 被中断，envSnapshots 也能恢复。
- **Trade-off**：每次 turn start/complete 多一次数据库写入，但换来的是崩溃后可恢复。

### M6: Git 深度集成
- **决策**：Ghost Commit 用 `git stash` 而非 `git commit` 创建临时快照
- **为什么**：stash 不污染 git history，pop/drop 操作是原子性的，适合临时快照场景。checkpoint 中的 Co-authored-by 使用 `--trailer` 参数注入（兼容旧版 git 有 fallback）
- **Trade-off**：stash 不如 commit 完整（不含 index 状态细节），但对于 Agent 的"快照-执行-回滚"场景足够

### M7: 文件监听
- **决策**：FileChangeBuffer 作为 FileWatcher 和 Agent Loop 之间的解耦桥梁
- **为什么**：FileWatcher 是事件驱动的（随时可能触发），Agent Loop 是轮询驱动的（每轮循环检查一次）。Buffer 解耦了两者的时间模型，flush 操作保证变更只被消费一次。100 事件上限防止内存泄漏。
- **Trade-off**：如果 Agent Loop 运行时间长，中间的变更会累积在 buffer 中，全部注入可能导致上下文膨胀。但实际场景中外部变更频率不高，500ms 防抖也减少了事件数量。

### M8: 多 Shell 支持
- **决策**：运行时自动检测用户 shell，不引入配置项
- **为什么**：参考 Codex `codex-rs/core/src/shell.rs` 的自动检测模式。用户 shell 是环境事实，不需要手动配置。检测链 `SHELL` env → `os.platform()` 默认 → `/bin/sh` 兜底覆盖所有场景。
- **Trade-off**：如果用户临时切换了 shell 但没更新 `SHELL` 环境变量，检测可能不准确。但这在实践中很少发生。

### M9: MCP 集成
- **决策**：MCP 工具命名加 `mcp__{server}__` 前缀，加载失败不阻塞核心工具
- **为什么**：MCP 服务器提供的工具名可能与内置工具冲突（比如两个 MCP 服务器都提供 `read_file`）。前缀命名空间隔离避免冲突。容错设计确保 MCP 服务器不可用时赤兔核心功能不受影响。
- **Trade-off**：工具名变长了（如 `mcp__filesystem__read_file`），Agent 调用时多几个 token。但换来的是无冲突的安全注册。

### M10: WebSocket 认证
- **决策**：自实现 JWT 验证，不引入 `jsonwebtoken` 依赖
- **为什么**：JWT 验证只需 base64url 解码 + HMAC-SHA256 签名比对 + 过期检查，核心逻辑不到 50 行。引入 `jsonwebtoken` 会拉进一堆不需要的依赖（jws、jwa、lodash 等）。
- **Trade-off**：不支持 RS256 等非对称算法，仅支持 HS256。对于单服务 WebSocket 认证场景足够，多服务间共享认证需要升级。

### M11: CLI 模式
- **决策**：放弃 ink（React for CLI），用 Node.js 内置 readline/promises + 进程内架构
- **为什么**：ink 引入 React 运行时 + yoga-layout + ink 生态依赖，对一个 CLI 界面来说过重。readline/promises 是 Node.js 内置模块，零依赖。进程内架构（直接实例化 ThreadManager）比 stdio JSON-RPC 少一层网络开销，延迟更低。
- **Trade-off**：readline 的 UI 能力比 ink 弱（不支持富文本布局、进度条等）。但 CLI 场景主要是文本输入输出，readline 足够。

### M12: 沙盒执行
- **决策**：macOS 使用 `sandbox-exec`（Seatbelt SBPL 策略），Linux 预留 Docker 接口。策略用白名单模式（deny default）。
- **为什么**：`sandbox-exec` 是 macOS 原生沙盒机制，无需额外依赖，策略用 S-expression 格式描述。白名单模式（默认拒绝所有，只放行必要操作）比黑名单更安全。参考 Codex `codex-rs/sandboxing/` 的设计。
- **Trade-off**：`sandbox-exec` 被 Apple 标记为 deprecated（实际仍可用）。Linux 沙盒需 Docker（M13 完善）。Seatbelt 策略配置较复杂，首次调试可能需要放宽权限。

### M13: Docker + CI/CD
- **决策**：多阶段 Docker 构建（deps → build → production），CI 用 3 个独立 job（lint、build、docker）
- **为什么**：多阶段构建让最终镜像只含运行时必需文件，大幅减小镜像体积。CI 拆成独立 job 让每个阶段可独立失败和缓存。docker job 单独验证镜像构建，确保 Dockerfile 不broken。前端用 nginx 托管而非 Node.js serve，性能更好。
- **Trade-off**：多阶段构建增加 Dockerfile 复杂度，但换来的是 ~5x 镜像体积缩减。docker-compose 的 frontend 服务依赖 server healthcheck 通过后才启动，确保前端可访问后端。

### M14: Review 模式
- **决策**：通过 system prompt + 工具过滤双重约束实现只读模式，而非硬编码禁止写入操作
- **为什么**：system prompt 引导 Agent 行为（只分析不修改 + 结构化输出审查结果），工具过滤作为硬性保障（只注册只读工具到 Agent Loop）。exec 工具额外做命令只读检测（正则匹配 cat/ls/grep/git status 等），防止 Agent 通过 shell 命令间接写入。双层防护比单层更可靠。
- **Trade-off**：exec 工具的只读命令检测用正则匹配，可能遗漏边缘情况（如 `python -c "open('x','w')"`）。但对于常见场景足够，且 system prompt 层面已经约束了 Agent 不应尝试写入。

### M17: 代码语义索引
- **决策**：放弃 tree-sitter（需要 node-gyp native 编译，CI 环境可能失败），改用 TypeScript Compiler API（`ts.createSourceFile`）做 AST 符号提取。项目已有 TypeScript 依赖，零额外安装。搜索用关键词匹配 + 文件路径权重评分，不调用外部 embedding API（避免额外依赖和网络延迟）。
- **为什么**：tree-sitter 的 node-gyp 编译在不同平台/Node 版本上经常失败，对于教育项目来说风险太高。TypeScript Compiler API 是已有的零成本选择，`ts.createSourceFile` 不需要完整的 TypeScript 程序即可独立解析文件。搜索策略选择 TF-IDF 文本相似度而非向量 embedding，因为不需要额外的 API 调用和模型部署。
- **Trade-off**：只能索引 TypeScript/JavaScript 文件，不支持 Python、Go 等其他语言（tree-sitter 是通用的）。搜索是关键词匹配而非真正的语义搜索（embedding 更智能但需要外部 API）。索引在内存中，进程重启后需要重建（懒加载机制减轻了影响）。

### M16: 多 Agent 协作
- **决策**：SubAgent 是独立的 Agent Loop 实例，由 AgentSpawner 管理。深度限制 3 层（0=root, 1, 2），防止无限嵌套。子 Agent 通过 AsyncMessageQueue 与父 Agent 通信。子 Agent 共享父 Thread 的文件系统但使用独立的上下文窗口。
- **为什么**：复杂任务可能需要拆分为独立子任务并行/串行执行。每个子 Agent 有独立上下文避免父 Agent 上下文过大。深度限制防止 Agent 递归 spawn 导致资源耗尽。参考 Codex `codex-rs/core/src/spawn.rs`。
- **Trade-off**：子 Agent 当前是串行执行的，并行执行需要额外的并发控制。子 Agent 的 maxIterations 限制为 30（比主 Agent 的 10000 更严格），适合子任务但不能处理超大型任务。

### M18: VS Code 扩展
- **决策**：直接通过 WebSocket JSON-RPC 连接 App Server，不用 stdio 适配层。WebView 渲染 Chat UI（内联 HTML+CSS+JS），不引入 React/Vue 等框架。
- **为什么**：现有 App Server 已提供完整的 WebSocket JSON-RPC 接口，扩展只需实现一个客户端即可复用全部协议。WebView 内联 HTML 比 React 框架更轻量，避免引入打包工具链。独立 tsconfig（commonjs 模块）与主项目解耦，不影响主项目编译。
- **Trade-off**：WebView 内联 HTML 不如 React 组件化可维护，但对于 Chat UI 的复杂度足够。ws 库作为扩展运行时依赖（VS Code 扩展运行在 Node.js 环境，可以使用 ws）。

### M19: 用户系统 + 组织权限
- **决策**：密码用 Node.js `crypto.scryptSync` 哈希，JWT 用 HMAC-SHA256（复用 M10 的自实现方案），不引入 bcrypt/jsonwebtoken 等外部依赖。组织权限用简单的 org_members 关联表，不实现 RBAC 角色。
- **为什么**：scrypt 是 Node.js 内置的强密码哈希算法（比 bcrypt 更抗 GPU 暴力破解），零外部依赖。JWT 复用 M10 已验证的自实现方案保持一致性。org_members 表用 (org_id, user_id) 复合主键 + role 字段，满足基本的组织权限需求且不过度设计。
- **Trade-off**：scryptSync 是同步操作（注册/登录时阻塞事件循环），但密码哈希通常 <100ms，对低并发场景可接受。未实现 GitHub OAuth（需外部凭证配置）。未实现细粒度 RBAC（admin/member 两种角色足够起步）。

## 变更日志

2026-04-19: M19 完成 — 用户系统 + 组织权限。新增 `src/auth/user-store.ts`（用户 CRUD + scrypt 密码哈希 + JWT 生成 + 组织管理）、`src/server/user-handlers.ts`（JSON-RPC 适配层）。`message-processor.ts` 新增 8 个方法（auth/register、auth/login、auth/getUser、org/create、org/addMember、org/listMembers、org/list、admin/listUsers）。Thread 类型新增 ownerId/orgId，ThreadStore 和 ThreadManager 已更新。修复 ThreadStore INSERT/SELECT SQL 列名遗漏。fork 方法继承 ownerId/orgId。

2026-04-19: M18 完成 — 新增 vscode-extension/ 目录（独立子项目），VS Code 扩展通过 WebSocket JSON-RPC 连接 App Server。包含 extension.ts（入口）、client.ts（JSON-RPC 客户端）、chat-provider.ts（侧边栏 Chat WebView）、diff-provider.ts（内联 diff 预览）。4 个命令、3 个快捷键、3 个配置项。

2026-04-19: M17 完成 — 新增 src/indexer/ 目录（6 个文件：types.ts、symbols.ts、search.ts、indexer.ts、tool.ts、index.ts），使用 TypeScript Compiler API 构建代码符号索引。新增 src/tools/plugins/indexer/index.ts（indexerPlugin）。支持 9 种符号类型、关键词 + 驼峰拆分搜索、mtime 增量索引、懒加载。修复 indexerPlugin 的 Plugin 接口不匹配（getTools() → tools 属性）。修复沙盒降级逻辑（exit code 提取和降级检测条件改进）。

2026-04-19: M16 完成 — 新增 src/agent/spawn.ts（AgentSpawner + AsyncMessageQueue + createSpawnTool）。子 Agent 独立 Agent Loop 实例，深度限制 3 层，共享文件系统但独立上下文。ThreadManager 集成 spawnTool。修复沙盒 sandbox-exec -p→-f。

- 2026-04-19: M14 完成 — 新增 src/agent/review-prompt.ts（review 系统提示 + 只读工具过滤 + 只读命令检测）。ThreadManager 根据 mode 切换系统提示和工具集。前端 ChatInput 新增 Review 模式切换按钮（Eye 图标）。完整链路：前端 toggle → JSON-RPC turn/start(mode) → MessageProcessor → ThreadManager → review prompt + 只读工具。

- 2026-04-19: M13 完成 — 新增 Dockerfile（3 阶段构建：deps/build/production）、.dockerignore、docker-compose.yml（server + frontend 两个服务 + healthcheck + 数据卷）、.github/workflows/ci.yml（3 个 job：lint+typecheck、build、docker build 验证）。

- 2026-04-19: M11 完成 — 新增 src/cli/index.ts（154 行），readline TUI + 进程内架构。支持交互式对话、流式输出、内联审批、SIGINT 退出。package.json 新增 bin.chitu 和 npm run cli。

- 2026-04-19: M10 完成 — 新增 src/auth/index.ts（147 行），WebSocket 握手认证。支持 API Key（timingSafeEqual 防时序攻击）+ JWT（自实现 HS256，零外部依赖）。开发模式未配置密钥时自动放行。

- 2026-04-19: M9 完成 — 新增 src/mcp/ 目录（4 个文件：types.ts、client.ts、loader.ts、index.ts），MCP 客户端实现。stdio 传输 + JSON-RPC 2.0 + 动态工具发现 + `mcp__{server}__{tool}` 命名空间。工具注册容错。ToolRegistry 新增 loadMcpTools() / disconnectMcp()。

- 2026-04-19: M8 完成 — 新增 src/utils/shell.ts（107 行），自动检测用户 shell（zsh/bash/sh/fish）。检测优先级：SHELL env → 平台默认 → /bin/sh。exec 工具、配置默认值、env-diff 全部切换到动态检测。

- 2026-04-19: M7 完成 — 新增 src/watcher/ 目录（3 个文件：file-watcher.ts、skills-watcher.ts、file-change-buffer.ts），文件监听 + Skills 热重载。FileWatcher 500ms 防抖 + 噪声过滤，FileChangeBuffer 100 事件上限，SkillsWatcher 检测 SKILL.md 变更后全量重载。集成到 server 启动流程和 Agent Loop。

- 2026-04-19: M6 完成 — 新增 4 个只读 git 工具（status/diff/blame/log）、2 个 Ghost Commit 工具（ghost_commit/ghost_rollback）、checkpoint 添加 Co-authored-by。git plugin 升级到 v2.0.0（8 个工具）。新增 src/tools/git/ 目录（status.ts、diff.ts、blame.ts、log.ts、ghost.ts、index.ts 重写）。

- 2026-04-19: M5 完成 — 新增 src/monitoring/metrics.ts（8 个 Prometheus 指标）+ src/monitoring/logger.ts（StructuredLogger JSON 日志）。/metrics endpoint 输出 Prometheus exposition format，/health endpoint 返回 200。LLM metrics 通过接口注入避免循环依赖。

- 2026-04-19: M4 完成 — 新增 src/db/crash-recovery.ts，active_turns 表持久化 turn 状态（start/complete/fail/interrupt），启动时 recoverInterruptedTurns() 扫描未完成 turn，envSnapshots 持久化到数据库。迁移 005_create_active_turns。

- 2026-04-19: M3 完成 — ThreadStore 和 MemoryStorage 迁移到 Neon PostgreSQL，保留 JSON 文件作为备份。5 个数据库迁移（threads/rollout_events/memories 表 + 索引 + active_turns）。双写策略确保可靠性。新增 src/db/connection.ts、src/db/migrate.ts。

- 2026-04-19: M2 完成 — 新增 src/config/ 目录（7 个文件），实现分层配置系统。全局 ~/.chitu/config.json → 项目 .chitu/config.json → 环境变量 → CLI 参数。支持类型验证和默认值。

- 2026-04-18: 数据库从 SQLite 改为 Neon serverless PostgreSQL

- 2026-04-18: 重新排序 milestones（22 个），新增 M7 文件监听、M8 多 Shell 支持。将 PROGRESS.md 未完成任务合并。M1 标记为 completed。

- 2026-04-18: 创建 documentation.md，记录项目初始状态
