# Implementation Plan

## Verification Checklist
- [x] M1: LLM API 可靠性（重试 + 降级）
- [x] M2: 分层配置系统
- [x] M3: 数据库存储（Neon PostgreSQL 替代 JSON 文件）
- [ ] M4: 服务端状态持久化（Crash Recovery）
- [ ] M5: 监控 + 告警（Prometheus + 结构化日志）
- [ ] M6: Git 深度集成
- [ ] M7: 文件监听（File Watcher）
- [ ] M8: 多 Shell 支持
- [ ] M9: MCP 集成（工具生态）
- [ ] M10: WebSocket 认证（API Key + JWT）
- [ ] M11: CLI 模式（终端界面）
- [ ] M12: 沙盒执行（容器隔离）
- [ ] M13: Docker + CI/CD
- [ ] M14: Review 模式
- [ ] M15: 增强监控面板（对标 Hermes HUD）
- [ ] M16: 多 Agent 协作（子任务拆分 + 并行）
- [ ] M17: 代码语义索引（AST + Embedding 搜索）
- [ ] M18: IDE 插件（VS Code）
- [ ] M19: 用户系统 + 组织 + 权限
- [ ] M20: 用量追踪 + 计费
- [ ] M21: 多模态支持
- [ ] M22: Documentation + Final Verification

## M1: LLM API 可靠性（重试 + 降级）
- **Scope**: 在 `src/llm/client.ts` 中新增 `fetchWithRetry()` 方法，实现指数退避重试（3 次，1s/2s/4s）。在 `src/agent/loop.ts` 中新增 5 次 LLM 重试循环，失败时注入错误信息到上下文继续尝试。区分 429（限流）和 500（服务端）自动重试，400（客户端）不重试。`maxIterations` 增加到 10000。
- **Key Files**: `src/llm/client.ts`, `src/agent/loop.ts`
- **Acceptance Criteria**:
  - `fetchWithRetry()` 方法存在且被 `chatStream` 内部调用
  - 429 和 500 状态码触发重试，400 不重试
  - 重试间隔为指数退避（1s, 2s, 4s）
  - Agent Loop 有 5 次 LLM 重试循环
  - `maxIterations` 为 10000
  - 现有测试不回归
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: completed
- **Completed**: 1744944000000

## M2: 分层配置系统
- **Scope**: 实现配置层：全局 `~/.chitu/config.json` → 项目 `.chitu/config.json` → 环境变量 → CLI 参数。后者覆盖前者。支持配置验证。参考 Codex `codex-rs/config/` 五层叠加设计。
- **Key Files**: `src/config/`, `src/start-server.ts`
- **Acceptance Criteria**:
  - 配置加载和合并逻辑正确
  - 全局 → 项目 → 环境变量优先级正确
  - 配置验证和错误提示
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: completed
- **Started**: 1776530190491
- **Completed**: 1776530532233

### Decisions
- 配置系统采用 4 层叠加：默认值 → 全局 ~/.chitu/config.json → 项目 .chitu/config.json → 环境变量 → CLI 参数。每个字段都有来源追踪（ConfigSource），方便调试。验证失败只阻止 API Key 缺失的服务器启动，其他只是警告。

### Notes
- 创建了 src/config/ 模块（6 个文件）：types.ts（类型）、defaults.ts（默认值）、loader.ts（文件加载）、env.ts（环境变量映射）、merge.ts（深度合并）、validate.ts（验证）、index.ts（统一入口+单例）。start-server.ts 已集成配置系统，启动时打印配置来源。test-config.ts 验证通过。

## M3: 数据库存储（Neon PostgreSQL 替代 JSON 文件）
- **Scope**: 使用 Neon serverless PostgreSQL 作为持久化存储。通过 `@neondatabase/serverless` 驱动连接。创建 threads 表、rollout_events 表、memories 表。ThreadStore 和 MemoryStorage 改为 PostgreSQL 查询。保持 JSONL rollout 文件作为备份。连接串通过 `NEON_DATABASE_URL` 环境变量配置。
- **Key Files**: `src/thread/store.ts`, `src/memories/storage.ts`, `src/db/`
- **Acceptance Criteria**:
  - `@neondatabase/serverless` 依赖已安装
  - 数据库迁移脚本存在（threads、rollout_events、memories 表）
  - ThreadStore 读写操作使用 PostgreSQL
  - MemoryStorage 读写操作使用 PostgreSQL
  - 现有 JSONL rollout 文件仍作为备份写入
  - `NEON_DATABASE_URL` 环境变量配置
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`, `npm test`
- **Status**: completed
- **Started**: 1776530539752
- **Completed**: 1776531439849

### Decisions
- 采用双写策略（PostgreSQL 主 + JSON 文件备份）：1) 保证数据可靠性，数据库不可用时自动降级到文件存储；2) JSON 文件保持向后兼容，方便本地开发和调试；3) MemoryStorage 的 load() 保持同步接口兼容性（降级到文件），新增 loadAsync() 优先从数据库读取

### Notes
- 修改文件清单：src/thread/store.ts（重写为 PG+JSON 双写）、src/memories/storage.ts（重写为 PG+JSON 双写）、src/agent/loop.ts（load → loadAsync）、src/start-server.ts（启动自动迁移）、tsconfig.json（排除 .test.ts 文件）。用户需要配置 NEON_DATABASE_URL 环境变量，未配置时自动降级到文件存储。

## M4: 服务端状态持久化（Crash Recovery）
- **Scope**: Turn 开始时写入 PostgreSQL 的 `active_turns` 表，Turn 完成/失败时标记完成。服务启动时扫描未完成的 turn 标记为 `interrupted`。envSnapshots 持久化到数据库。参考 Codex `codex-rs/core/src/state/session.rs`。
- **Key Files**: `src/thread/manager.ts`, `src/db/`
- **Acceptance Criteria**:
  - `active_turns` 表存在
  - Turn 开始/完成/失败时状态正确更新
  - 服务启动时未完成 turn 被标记为 interrupted
  - envSnapshots 持久化到数据库
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M5: 监控 + 告警（Prometheus + 结构化日志）
- **Scope**: Prometheus metrics（turn 耗时、token 消耗、API 错误率、活跃连接数）。结构化日志（JSON 格式 + request ID 关联）。`/health` 和 `/metrics` HTTP endpoint。参考 Codex `codex-rs/otel/`。
- **Key Files**: `src/server/index.ts`, `src/monitoring/`
- **Acceptance Criteria**:
  - `/health` endpoint 返回 200
  - `/metrics` endpoint 返回 Prometheus 格式指标
  - 结构化日志输出 JSON 格式
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`, `curl http://localhost:8080/health`
- **Status**: pending

## M6: Git 深度集成
- **Scope**: 结构化 git 工具（status、diff、blame、log）作为新 plugin。Ghost Commit：工具执行前自动 git stash，失败时自动回滚。提交归属：自动添加 `Co-authored-by: Chitu Agent`。参考 Codex `codex-rs/git-utils/` 和 `codex-rs/core/src/commit_attribution.rs`。
- **Key Files**: `src/tools/plugins/git/`
- **Acceptance Criteria**:
  - 新 git 工具可读取 status、diff、blame、log
  - Ghost Commit 在工具执行前创建临时快照
  - 失败时自动回滚到快照
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M7: 文件监听（File Watcher）
- **Scope**: 实时监听项目文件变更（编辑器保存、git pull 等），自动触发上下文更新。监听 `.agents/skills/` 目录变更，热加载 Skills。使用 Node.js `fs.watch` 或 `chokidar`。参考 Codex `codex-rs/core/src/file_watcher.rs` 和 `codex-rs/core/src/skills_watcher.rs`。
- **Key Files**: `src/watcher/`, `src/agent/loop.ts`, `src/skills/loader.ts`
- **Acceptance Criteria**:
  - 文件变更事件被正确捕获
  - Agent 收到文件变更通知（注入到上下文）
  - Skills 目录变更触发热加载
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M8: 多 Shell 支持
- **Scope**: 自动检测用户 Shell（zsh/bash/sh），按类型派发不同参数。macOS 默认 zsh，Linux 默认 bash。替换硬编码的 `/bin/bash`。参考 Codex `codex-rs/core/src/shell.rs` + `shell_detect.rs`。
- **Key Files**: `src/tools/exec.ts`, `src/utils/shell.ts`
- **Acceptance Criteria**:
  - 自动检测当前用户 Shell
  - exec 工具使用检测到的 Shell
  - macOS / Linux 下行为正确
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M9: MCP 集成（工具生态）
- **Scope**: 实现 MCP Client（`src/mcp/client.ts`），支持 stdio 和 SSE 传输。动态加载 MCP Server 的工具定义，注册到 ToolRegistry。支持 MCP 工具的审批流程。参考 Codex `codex-rs/mcp/`。
- **Key Files**: `src/mcp/`, `src/tools/index.ts`
- **Acceptance Criteria**:
  - MCP Client 可连接到 stdio 类型的 MCP Server
  - 动态发现并注册 MCP 工具到 ToolRegistry
  - MCP 工具的审批流程正常工作
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M10: WebSocket 认证（API Key + JWT）
- **Scope**: WebSocket 握手时验证 `?token=xxx` 参数。支持 API Key 和 JWT Token 两种认证方式。参考 Codex `codex-rs/login/` 认证系统。
- **Key Files**: `src/server/index.ts`, `src/auth/`
- **Acceptance Criteria**:
  - 未认证连接被拒绝
  - API Key 认证可用
  - JWT Token 认证可用
  - 认证失败返回明确错误
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M11: CLI 模式（终端界面）
- **Scope**: 使用 `ink`（React for CLI）构建 TUI。通过 stdio JSON-RPC 与 App Server 通信。支持 `chitu` 命令直接启动。参考 Codex `codex-rs/tui/`。
- **Key Files**: `src/cli/`, `package.json`
- **Acceptance Criteria**:
  - `npx chitu` 或 `npm run cli` 启动终端界面
  - 终端界面可发送消息并接收回复
  - 通过 stdio JSON-RPC 与 App Server 通信
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M12: 沙盒执行（容器隔离）
- **Scope**: macOS 使用 `sandbox-exec`（Seatbelt 策略），Linux 使用 Docker。策略：只读项目根目录（除指定可写路径）+ 禁止网络访问 + 资源限制。参考 Codex `codex-rs/sandboxing/`。
- **Key Files**: `src/sandbox/`, `src/tools/exec.ts`
- **Acceptance Criteria**:
  - macOS 上 exec 工具在 sandbox-exec 限制下执行
  - 只能写入指定可写路径
  - 网络访问被禁止
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M13: Docker + CI/CD
- **Scope**: Dockerfile（多阶段构建）。`docker-compose.yml`（server + frontend + Neon 环境变量）。GitHub Actions CI（lint + type check + E2E test）。
- **Key Files**: `Dockerfile`, `docker-compose.yml`, `.github/workflows/`
- **Acceptance Criteria**:
  - `docker build` 成功
  - `docker-compose up` 启动完整服务
  - GitHub Actions CI 配置存在且语法正确
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`, `docker build -t chitu .`
- **Status**: pending

## M14: Review 模式
- **Scope**: 新增 `review` 模式：Agent 只审查不修改。专用 system prompt（审查 diff 格式输出）。前端展示审查结果（问题列表 + 建议修改）。参考 Codex `codex-rs/core/review_prompt.md`。
- **Key Files**: `src/agent/loop.ts`, `src/server/message-processor.ts`, `web-ui/src/components/`
- **Acceptance Criteria**:
  - Review 模式下 Agent 只分析不修改文件
  - 专用 system prompt 引导审查行为
  - 前端可展示审查结果
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M15: 增强监控面板（对标 Hermes HUD）
- **Scope**: 参考 https://github.com/joeynyc/hermes-hudui 仓库，将赤兔的监控面板从基础指标扩展为丰富的多维度监控系统。后端扩展 `/dashboard` 端点，从 rollout JSONL 中提取工具使用频率和每日活动统计；从 memories 目录读取记忆状态（条目数、按类别统计）；增加 token 成本估算（按模型/按天）。前端增加 Tab 导航（总览/Token 成本/记忆/工具使用），新增 Sparkline 折线图组件（每日活动趋势）、容量条组件（value/max 可视化）、工具使用频率横向条形图（Top N）、增长快照 Delta 对比。保持 Discord 风格 UI 一致性。
- **Key Files**: `src/server/index.ts`, `web-ui/src/components/DashboardPage.tsx`, `web-ui/src/components/dashboard/`
- **Acceptance Criteria**:
  - `/dashboard` 端点返回工具使用频率统计（从 rollout JSONL 提取）
  - `/dashboard` 端点返回每日活动统计（消息数/turn 数/token 数按天聚合）
  - `/dashboard` 端点返回记忆状态（条目数、按类别统计）
  - `/dashboard` 端点返回 token 成本估算（按模型/按天）
  - 前端有 Tab 导航切换不同面板（总览/Token 成本/记忆/工具使用）
  - Sparkline 折线图展示每日活动趋势
  - 工具使用频率横向条形图展示 Top N 工具
  - 容量条组件可视化 token/memory 使用
  - 保持现有 Discord 风格 UI 不变
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`, `curl http://localhost:8080/dashboard | jq .`
- **Status**: pending

## M16: 多 Agent 协作（子任务拆分 + 并行）
- **Scope**: `src/agent/spawn.ts` 子 Agent 派发（每个子任务一个独立 Agent Loop 实例）。Agent 间通过消息队列通信。深度限制（最多 3 层嵌套）防止失控。参考 Codex `codex-rs/core/src/spawn.rs`。
- **Key Files**: `src/agent/spawn.ts`, `src/thread/manager.ts`
- **Acceptance Criteria**:
  - 可从主 Agent 派发子 Agent
  - 子 Agent 有独立的 Agent Loop 实例
  - 深度限制为 3 层
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M17: 代码语义索引（AST + Embedding 搜索）
- **Scope**: 使用 `tree-sitter` 解析项目 AST，构建符号索引（类、函数、变量）。用 embedding 向量化代码片段，支持语义搜索。注入索引信息到 Agent 上下文。
- **Key Files**: `src/indexer/`, `src/agent/loop.ts`
- **Acceptance Criteria**:
  - 可解析项目 AST 构建符号索引
  - Agent 可查询符号索引
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M18: IDE 插件（VS Code）
- **Scope**: VS Code 扩展通过 stdio JSON-RPC 与 App Server 通信。侧边栏 Chat 面板。编辑器内联 diff 预览。快捷键触发。
- **Key Files**: `vscode-extension/`
- **Acceptance Criteria**:
  - VS Code 扩展可安装和激活
  - 侧边栏 Chat 面板可发送消息
  - 编辑器内联 diff 预览工作
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M19: 用户系统 + 组织 + 权限
- **Scope**: 用户注册/登录（邮箱 / GitHub OAuth）。组织概念 — 多人共享工作空间。角色：Owner / Admin / Member / Viewer。每个 Thread 归属一个用户。
- **Key Files**: `src/auth/`, `src/db/`, `src/server/`
- **Acceptance Criteria**:
  - 用户注册和登录可用
  - 组织和角色管理可用
  - Thread 归属用户
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M20: 用量追踪 + 计费
- **Scope**: 每次 turn 记录 token 消耗到 `usage_logs` 表。按 user/org 聚合每日/每月用量。配额系统：免费额度 + 付费套餐。
- **Key Files**: `src/db/`, `src/monitoring/`
- **Acceptance Criteria**:
  - 每次 turn 的 token 消耗被记录
  - 可按 user/org 查询用量
  - 配额系统基本可用
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M21: 多模态支持
- **Scope**: 图片输入：支持截图/设计稿上传，Agent 通过 multimodal LLM 理解。图片输出：Mermaid/PlantUML 图表生成。
- **Key Files**: `src/llm/client.ts`, `src/tools/plugins/`, `web-ui/src/components/`
- **Acceptance Criteria**:
  - 用户可上传图片
  - Agent 能理解图片内容
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M22: Documentation + Final Verification
- **Scope**: 所有里程碑完成后的最终文档更新。更新 README.md 反映完整功能集。更新 CLAUDE.md 反映新架构（数据库、配置、认证、MCP 等）。写 docs/architecture.md 描述完整系统架构（数据模型、Agent Loop、工具插件、事件协议、MCP、认证）。确保所有 npm scripts 可用且通过验证。参考 Design Desk Milestone 24。
- **Key Files**: `README.md`, `CLAUDE.md`, `docs/architecture.md`
- **Acceptance Criteria**:
  - README.md 反映完整的安装、使用、开发流程
  - CLAUDE.md 包含所有新模块的架构说明
  - docs/architecture.md 描述完整的系统架构
  - `npm run build`、`npm test`、`npx tsc --noEmit` 全部通过
  - `npm run dev` 一键启动完整服务
- **Verification Commands**: `npm run build`, `npm test`, `npx tsc --noEmit`
- **Status**: pending
