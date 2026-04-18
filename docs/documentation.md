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
- M8-M22: 待处理

### 优先级分组
| 优先级 | 范围 | Milestones |
|--------|------|-----------|
| P0 基础设施 | 让赤兔稳定运行 | M1 ✅, M2 ✅, M3 ✅ |
| P1 可观测+安全 | 让赤兔可信赖 | M4 ✅, M5 ✅, M6（Git） |
| P2 平台支持 | 让赤兔跑在更多环境 | M7（文件监听）, M8（多 Shell） |
| P3 生态集成 | 扩展能力边界 | M9（MCP）, M10（认证） |
| P4 多端接入 | CLI/沙盒/容器 | M11（CLI）, M12（沙盒）, M13（Docker CI） |
| P5 高级功能 | Review/监控/多Agent | M14（Review）, M15（监控增强）, M16（多Agent） |
| P6 远期目标 | 索引/IDE/用户/计费 | M17-M21 |
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

**配置与存储：**
- **分层配置系统**（M2）— 4 层叠加：全局 `~/.chitu/config.json` → 项目 `.chitu/config.json` → 环境变量 → CLI 参数。后者覆盖前者。支持类型验证。7 个文件：types.ts（类型定义）、defaults.ts（默认值）、loader.ts（文件加载）、merge.ts（4 层合并）、env.ts（环境变量映射）、validate.ts（验证）、index.ts（入口 + 单例缓存）
- **Neon PostgreSQL 数据库存储**（M3）— ThreadStore + MemoryStorage 双写策略（PG 主存储 + JSON 文件备份），启动时自动运行 5 个迁移（threads、rollout_events、memories 表 + 索引 + active_turns 表），数据库不可用时自动降级到文件存储

## 本地启动

### 后端
```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npx tsx src/start-server.ts
```

### 环境变量
- `ZHIPU_API_KEY` — 智谱 AI API Key（必需）
- `ZHIPU_CODING_ENDPOINT` — GLM-5 API 端点（可选，有默认值）
- `NEON_DATABASE_URL` — Neon PostgreSQL 连接串（可选，未配置时自动降级到文件存储）

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
  agent/        — Agent Loop（核心循环）+ context compaction
  config/       — 分层配置系统（types/defaults/loader/merge/env/validate）
  context.ts    — AGENTS.md 层级加载 + 环境上下文
  db/           — 数据库连接 + 迁移 + Crash Recovery（Neon PostgreSQL）
  hooks/        — 5 个事件点的 Shell Hook 分发器
  llm/          — GLM-5 API 客户端（SSE streaming + 重试 + metrics 集成）
  memories/     — 跨 session 知识提取和注入（PG 主 + JSON 备份）
  monitoring/   — Prometheus 指标（metrics.ts）+ 结构化 JSON 日志（logger.ts）
  rollout/      — JSONL 事件记录（审计/调试回放）
  server/       — WebSocket 传输 + JSON-RPC + HTTP endpoints
  skills/       — Skills 加载系统
  thread/       — ThreadManager + ThreadStore（PG 主 + JSON 备份）
  tools/        — 工具系统：PluginLoader + 多个 Plugin（exec, files, plan, milestone, git v2.0）
  watcher/      — 文件监听：FileWatcher + SkillsWatcher + FileChangeBuffer
  types.ts      — 核心类型（Thread/Turn/Item/AppEvent）
web-ui/         — React 19 + Vite 8 前端（Discord 风格）
docs/           — prompt.md + implement.md + documentation.md + 架构文档
plans.md        — 里程碑执行计划（22 个 milestones，唯一真相源）
```

## 架构

4 层架构，对齐 Codex：

```
Transport (WebSocket/JSON-RPC)
  → Message Processor (JSON-RPC ↔ ThreadManager 翻译)
    → Thread Manager (create/resume/runTurn/fork)
      → Agent Loop (while loop: LLM → tool_calls → execute → repeat)
```

数据流：用户消息 → JSON-RPC → MessageProcessor → ThreadManager.runTurn() → Agent Loop → LLM + Tools → 事件流 → WebSocket 通知 → 前端

## 已知问题 / 后续

- ~~数据存储还是 JSON 文件，需迁移到 Neon PostgreSQL（M3）~~ ✅ 已完成
- ~~无分层配置系统（M2）~~ ✅ 已完成
- ~~无 Crash Recovery，进程崩溃丢失 turn 状态（M4）~~ ✅ 已完成
- ~~无结构化日志和 Prometheus 指标（M5，进行中）~~ ✅ 已完成
- ~~无 Git 深度集成（M6）~~ ✅ 已完成
- WebSocket 无认证（M10）
- exec 工具无沙盒隔离（M12）
- 无 CI/CD（M13）
- 监控面板指标不够丰富，需对标 Hermes HUD 增强（M15）
- ~~无文件监听，Agent 无法感知外部变更（M7）~~ ✅ 已完成
- 硬编码 `/bin/bash`，需多 Shell 支持（M8）

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

## 变更日志

- 2026-04-19: M6 完成 — 新增 4 个只读 git 工具（status/diff/blame/log）、2 个 Ghost Commit 工具（ghost_commit/ghost_rollback）、checkpoint 添加 Co-authored-by。git plugin 升级到 v2.0.0（8 个工具）。新增 src/tools/git/status.ts、diff.ts、blame.ts、log.ts、ghost.ts。

- 2026-04-19: M4 完成 — 新增 src/db/crash-recovery.ts，active_turns 表持久化 turn 状态（start/complete/fail/interrupt），启动时 recoverInterruptedTurns() 扫描未完成 turn，envSnapshots 持久化到数据库。迁移 005_create_active_turns。
- 2026-04-19: M3 完成 — ThreadStore 和 MemoryStorage 迁移到 Neon PostgreSQL，保留 JSON 文件作为备份。5 个数据库迁移（threads/rollout_events/memories 表 + 索引 + active_turns）。双写策略确保可靠性。新增 src/db/connection.ts、src/db/migrate.ts。
- 2026-04-19: M2 完成 — 新增 src/config/ 目录（7 个文件），实现分层配置系统。全局 ~/.chitu/config.json → 项目 .chitu/config.json → 环境变量 → CLI 参数。支持类型验证和默认值。
- 2026-04-18: 数据库从 SQLite 改为 Neon serverless PostgreSQL
- 2026-04-18: 重新排序 milestones（22 个），新增 M7 文件监听、M8 多 Shell 支持。将 PROGRESS.md 未完成任务合并。M1 标记为 completed。
- 2026-04-18: 创建 documentation.md，记录项目初始状态
