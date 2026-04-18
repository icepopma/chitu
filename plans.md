# Implementation Plan

## Verification Checklist
- [ ] M1: LLM API 可靠性（重试 + 降级）
- [ ] M2: 数据库存储（SQLite 替代 JSON 文件）
- [ ] M3: 服务端状态持久化（Crash Recovery）
- [ ] M4: 分层配置系统
- [ ] M5: WebSocket 认证（API Key + JWT）
- [ ] M6: 监控 + 告警（Prometheus + 结构化日志）
- [ ] M7: Git 深度集成
- [ ] M8: MCP 集成（工具生态）
- [ ] M9: CLI 模式（终端界面）
- [ ] M10: 沙盒执行（容器隔离）
- [ ] M11: Docker + CI/CD
- [ ] M12: Review 模式
- [ ] M13: 多 Agent 协作（子任务拆分 + 并行）
- [ ] M14: 代码语义索引（AST + Embedding 搜索）
- [ ] M15: IDE 插件（VS Code）
- [ ] M16: 用户系统 + 组织 + 权限
- [ ] M17: 用量追踪 + 计费
- [ ] M18: 多模态支持

## M1: LLM API 可靠性（重试 + 降级）
- **Scope**: 在 `src/llm/client.ts` 中新增 `chatWithRetry()` 方法，实现指数退避重试（3 次，1s/2s/4s）。区分 429（限流）和 500（服务端）自动重试，400（客户端）不重试。可选 fallback model 配置。
- **Key Files**: `src/llm/client.ts`
- **Acceptance Criteria**:
  - `chatWithRetry()` 方法存在且被 `chatStream` 内部调用
  - 429 和 500 状态码触发重试，400 不重试
  - 重试间隔为指数退避（1s, 2s, 4s）
  - 现有测试不回归
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M2: 数据库存储（SQLite 替代 JSON 文件）
- **Scope**: 引入 `better-sqlite3`，创建 SQLite 数据库层。迁移 threads 表、rollout_events 表、memories 表。ThreadStore 和 MemoryStorage 改为 SQLite 查询。保持 JSONL rollout 文件作为备份。参考 Codex `codex-rs/state/` 双数据库架构（state.db + logs.db）。
- **Key Files**: `src/thread/store.ts`, `src/memories/storage.ts`, `src/db/`（新增目录）
- **Acceptance Criteria**:
  - `better-sqlite3` 依赖已安装
  - 数据库迁移脚本存在（threads、rollout_events、memories 表）
  - ThreadStore 读写操作使用 SQLite
  - MemoryStorage 读写操作使用 SQLite
  - 现有 JSONL rollout 文件仍作为备份写入
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`, `npm test`
- **Status**: pending

## M3: 服务端状态持久化（Crash Recovery）
- **Scope**: Turn 开始时写入 `state.db` 的 `active_turns` 表，Turn 完成/失败时标记完成。服务启动时扫描未完成的 turn 标记为 `interrupted`。envSnapshots 持久化到数据库。参考 Codex `codex-rs/core/src/state/session.rs`。
- **Key Files**: `src/thread/manager.ts`, `src/db/`（扩展）
- **Acceptance Criteria**:
  - `active_turns` 表存在
  - Turn 开始/完成/失败时状态正确更新
  - 服务启动时未完成 turn 被标记为 interrupted
  - envSnapshots 持久化到数据库
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M4: 分层配置系统
- **Scope**: 实现配置层：全局 `~/.chitu/config.json` → 项目 `.chitu/config.json` → 环境变量 → CLI 参数。后者覆盖前者。支持配置验证。参考 Codex `codex-rs/config/` 五层叠加设计。
- **Key Files**: `src/config/`（新增目录）, `src/start-server.ts`
- **Acceptance Criteria**:
  - 配置加载和合并逻辑正确
  - 全局 → 项目 → 环境变量优先级正确
  - 配置验证和错误提示
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M5: WebSocket 认证（API Key + JWT）
- **Scope**: WebSocket 握手时验证 `?token=xxx` 参数。支持 API Key 和 JWT Token 两种认证方式。参考 Codex `codex-rs/login/` 认证系统。
- **Key Files**: `src/server/index.ts`, `src/auth/`（新增目录）
- **Acceptance Criteria**:
  - 未认证连接被拒绝
  - API Key 认证可用
  - JWT Token 认证可用
  - 认证失败返回明确错误
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M6: 监控 + 告警（Prometheus + 结构化日志）
- **Scope**: Prometheus metrics（turn 耗时、token 消耗、API 错误率、活跃连接数）。结构化日志（JSON 格式 + request ID 关联）。`/health` 和 `/metrics` HTTP endpoint。参考 Codex `codex-rs/otel/`。
- **Key Files**: `src/server/index.ts`, `src/monitoring/`（新增目录）
- **Acceptance Criteria**:
  - `/health` endpoint 返回 200
  - `/metrics` endpoint 返回 Prometheus 格式指标
  - 结构化日志输出 JSON 格式
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`, `curl http://localhost:8080/health`
- **Status**: pending

## M7: Git 深度集成
- **Scope**: 结构化 git 工具（status、diff、blame、log）作为新 plugin。Ghost Commit：工具执行前自动 git stash，失败时自动回滚。提交归属：自动添加 `Co-authored-by: Chitu Agent`。参考 Codex `codex-rs/git-utils/`。
- **Key Files**: `src/tools/plugins/git/`（扩展）
- **Acceptance Criteria**:
  - 新 git 工具可读取 status、diff、blame、log
  - Ghost Commit 在工具执行前创建临时快照
  - 失败时自动回滚到快照
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M8: MCP 集成（工具生态）
- **Scope**: 实现 MCP Client（`src/mcp/client.ts`），支持 stdio 和 SSE 传输。动态加载 MCP Server 的工具定义，注册到 ToolRegistry。支持 MCP 工具的审批流程。参考 Codex `codex-rs/mcp/`。
- **Key Files**: `src/mcp/`（新增目录）, `src/tools/index.ts`
- **Acceptance Criteria**:
  - MCP Client 可连接到 stdio 类型的 MCP Server
  - 动态发现并注册 MCP 工具到 ToolRegistry
  - MCP 工具的审批流程正常工作
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M9: CLI 模式（终端界面）
- **Scope**: 使用 `ink`（React for CLI）构建 TUI。通过 stdio JSON-RPC 与 App Server 通信。支持 `chitu` 命令直接启动。参考 Codex `codex-rs/tui/`。
- **Key Files**: `src/cli/`（新增目录）, `package.json`
- **Acceptance Criteria**:
  - `npx chitu` 或 `npm run cli` 启动终端界面
  - 终端界面可发送消息并接收回复
  - 通过 stdio JSON-RPC 与 App Server 通信
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M10: 沙盒执行（容器隔离）
- **Scope**: macOS 使用 `sandbox-exec`（Seatbelt 策略），Linux 使用 Docker。策略：只读项目根目录（除指定可写路径）+ 禁止网络访问 + 资源限制。参考 Codex `codex-rs/sandboxing/`。
- **Key Files**: `src/sandbox/`（新增目录）, `src/tools/exec.ts`
- **Acceptance Criteria**:
  - macOS 上 exec 工具在 sandbox-exec 限制下执行
  - 只能写入指定可写路径
  - 网络访问被禁止
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M11: Docker + CI/CD
- **Scope**: Dockerfile（多阶段构建）。`docker-compose.yml`（server + frontend + SQLite volume）。GitHub Actions CI（lint + type check + E2E test）。
- **Key Files**: `Dockerfile`, `docker-compose.yml`, `.github/workflows/`（新增目录）
- **Acceptance Criteria**:
  - `docker build` 成功
  - `docker-compose up` 启动完整服务
  - GitHub Actions CI 配置存在且语法正确
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`, `docker build -t chitu .`
- **Status**: pending

## M12: Review 模式
- **Scope**: 新增 `review` 模式：Agent 只审查不修改。专用 system prompt（审查 diff 格式输出）。前端展示审查结果（问题列表 + 建议修改）。参考 Codex `codex-rs/core/review_prompt.md`。
- **Key Files**: `src/agent/loop.ts`, `src/server/message-processor.ts`, `web-ui/src/components/`
- **Acceptance Criteria**:
  - Review 模式下 Agent 只分析不修改文件
  - 专用 system prompt 引导审查行为
  - 前端可展示审查结果
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M13: 多 Agent 协作（子任务拆分 + 并行）
- **Scope**: `src/agent/spawn.ts` 子 Agent 派发（每个子任务一个独立 Agent Loop 实例）。Agent 间通过消息队列通信。深度限制（最多 3 层嵌套）防止失控。参考 Codex `codex-rs/core/src/spawn.rs`。
- **Key Files**: `src/agent/spawn.ts`（新增）, `src/thread/manager.ts`
- **Acceptance Criteria**:
  - 可从主 Agent 派发子 Agent
  - 子 Agent 有独立的 Agent Loop 实例
  - 深度限制为 3 层
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M14: 代码语义索引（AST + Embedding 搜索）
- **Scope**: 使用 `tree-sitter` 解析项目 AST，构建符号索引（类、函数、变量）。用 embedding 向量化代码片段，支持语义搜索。注入索引信息到 Agent 上下文。
- **Key Files**: `src/indexer/`（新增目录）, `src/agent/loop.ts`
- **Acceptance Criteria**:
  - 可解析项目 AST 构建符号索引
  - Agent 可查询符号索引
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M15: IDE 插件（VS Code）
- **Scope**: VS Code 扩展通过 stdio JSON-RPC 与 App Server 通信。侧边栏 Chat 面板。编辑器内联 diff 预览。快捷键触发。
- **Key Files**: `vscode-extension/`（新增目录）
- **Acceptance Criteria**:
  - VS Code 扩展可安装和激活
  - 侧边栏 Chat 面板可发送消息
  - 编辑器内联 diff 预览工作
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M16: 用户系统 + 组织 + 权限
- **Scope**: 用户注册/登录（邮箱 / GitHub OAuth）。组织概念 — 多人共享工作空间。角色：Owner / Admin / Member / Viewer。每个 Thread 归属一个用户。
- **Key Files**: `src/auth/`（扩展）, `src/db/`（扩展）, `src/server/`
- **Acceptance Criteria**:
  - 用户注册和登录可用
  - 组织和角色管理可用
  - Thread 归属用户
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M17: 用量追踪 + 计费
- **Scope**: 每次 turn 记录 token 消耗到 `usage_logs` 表。按 user/org 聚合每日/每月用量。配额系统：免费额度 + 付费套餐。
- **Key Files**: `src/db/`（扩展）, `src/monitoring/`（扩展）
- **Acceptance Criteria**:
  - 每次 turn 的 token 消耗被记录
  - 可按 user/org 查询用量
  - 配额系统基本可用
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending

## M18: 多模态支持
- **Scope**: 图片输入：支持截图/设计稿上传，Agent 通过 multimodal LLM 理解。图片输出：Mermaid/PlantUML 图表生成。
- **Key Files**: `src/llm/client.ts`, `src/tools/plugins/`（扩展）, `web-ui/src/components/`
- **Acceptance Criteria**:
  - 用户可上传图片
  - Agent 能理解图片内容
  - `npx tsc --noEmit` 通过
- **Verification Commands**: `npx tsc --noEmit`
- **Status**: pending
