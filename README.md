# 赤兔 (Chitu) Agent

从零构建的教育型 AI Agent 系统，架构对齐 OpenAI Codex。使用 GLM-5（智谱AI）function calling 实现自主编程 Agent。

## 特性

- **自主编程 Agent** — while 循环驱动：LLM 推理 → 工具调用 → 执行结果 → 继续推理，直到任务完成
- **22 个里程碑** — 从基础架构到多模态支持，覆盖生产级 Agent 的所有核心能力
- **WebSocket + JSON-RPC 2.0** — 双向实时通信，流式输出逐 token 推送
- **React Discord 风格 UI** — 聊天界面 + 监控面板 + 实时里程碑进度
- **CLI 模式** — 终端直接交互，零依赖 readline TUI
- **VS Code 扩展** — 侧边栏 Chat + 内联 diff 预览
- **多模态** — 图片上传（截图/设计稿），Agent 通过 vision 理解
- **多 Agent 协作** — 子 Agent 派发，3 层嵌套，独立上下文窗口
- **插件式工具系统** — PluginLoader + 依赖排序，内置 15+ 工具
- **MCP 集成** — Model Context Protocol 客户端，动态发现外部工具
- **代码语义索引** — TypeScript AST 符号解析 + 关键词搜索
- **Git 深度集成** — status/diff/blame/log + checkpoint/rollback + ghost commit
- **沙盒执行** — macOS sandbox-exec (Seatbelt) + Linux Docker 预留
- **用户系统** — 注册/登录 + 组织管理 + 配额计费
- **Docker + CI/CD** — 多阶段构建 + GitHub Actions
- **Neon PostgreSQL** — 主存储 + JSON 文件备份，自动降级
- **Prometheus + 结构化日志** — 8 个指标 + JSON 日志

## 架构

4 层架构，对齐 Codex：

```
Transport (WebSocket/JSON-RPC 或 CLI readline)
  → Message Processor (JSON-RPC ↔ ThreadManager 翻译)
    → Thread Manager (create/resume/runTurn/fork)
      → Agent Loop (while loop: LLM → tool_calls → execute → repeat)
```

核心数据模型：**Thread**（完整对话）→ **Turn**（一轮任务）→ **Item**（单步操作：消息/工具调用/工具结果）

事件协议对齐 Codex：`thread/started` → `turn/started` → `item/started` → `item/delta` → `item/completed` → `turn/completed`

## 快速开始

### 环境要求

- Node.js ≥ 22
- npm ≥ 10
- GLM-5 API Key（[智谱AI 开放平台](https://open.bigmodel.cn/)）

### 安装

```bash
git clone <repo-url> && cd chitu
npm install
cd web-ui && npm install && cd ..
```

### 配置

```bash
# 必需
export ZHIPU_API_KEY="your-api-key"

# 可选
export NEON_DATABASE_URL="postgresql://..."  # Neon PostgreSQL（未配置时用 JSON 文件）
export CHITU_API_KEY="your-api-key"          # WebSocket 静态认证
export CHITU_JWT_SECRET="your-jwt-secret"    # JWT 签名密钥
export PORT=8080                              # 服务端口（默认 8080）
```

### 启动

```bash
# 后端
npm run dev                    # 开发模式（热重载）
npx tsx src/start-server.ts    # 生产模式

# 前端
cd web-ui && npm run dev       # http://localhost:3000

# CLI 模式（不需要浏览器）
npm run cli
```

### 访问

| 端点 | 地址 |
|------|------|
| Web UI | http://localhost:3000 |
| WebSocket | ws://localhost:8080 |
| 健康检查 | http://localhost:8080/health |
| Prometheus 指标 | http://localhost:8080/metrics |
| 运行状态 | http://localhost:8080/status |
| 监控面板 API | http://localhost:8080/dashboard |
| 图片上传 | POST http://localhost:8080/upload/image |

### Docker

```bash
docker compose up --build
# 后端: http://localhost:8080
# 前端: http://localhost:3000
```

## 项目结构

```
src/
  agent/        — Agent Loop（核心循环）+ context compaction + spawn（子 Agent）+ review prompt
  auth/         — WebSocket 认证（API Key + JWT）+ 用户管理（注册/登录/组织）
  cli/          — CLI 终端模式（readline TUI）
  config/       — 分层配置系统（全局→项目→环境变量→CLI）
  context.ts    — AGENTS.md 层级加载 + 环境上下文
  db/           — Neon PostgreSQL 连接 + 迁移（10 个）+ Crash Recovery
  hooks/        — 5 个事件点的 Shell Hook 分发器
  indexer/      — 代码语义索引（AST 符号解析 + 搜索引擎）
  llm/          — GLM-5 API 客户端（SSE streaming + 重试 + metrics）
  mcp/          — MCP 客户端（stdio 传输 + 动态工具发现）
  memories/     — 跨 session 知识提取和注入
  monitoring/   — Prometheus 指标 + 结构化 JSON 日志 + 用量追踪 + 配额
  rollout/      — JSONL 事件记录（审计/调试回放）
  sandbox/      — 沙盒执行（macOS Seatbelt + Linux Docker 预留）
  server/       — WebSocket 传输 + JSON-RPC + HTTP endpoints + 用户/用量路由
  skills/       — Skills 加载系统（.agents/skills/*/SKILL.md）
  thread/       — ThreadManager + ThreadStore（PG 主 + JSON 备份）
  tools/        — 插件式工具系统（PluginLoader + 15+ 工具）
  upload/       — 图片上传 + 静态文件服务
  utils/        — Shell 检测、环境快照 diff、输出截断
  watcher/      — 文件监听 + Skills 热重载 + FileChangeBuffer
  types.ts      — 核心类型（Thread/Turn/Item/AppEvent）
web-ui/         — React 19 + Vite 8 + TailwindCSS 4（Discord 风格）
vscode-extension/ — VS Code 扩展（侧边栏 Chat + 内联 diff）
docs/           — 产品规格 + 执行手册 + 架构文档
```

## 开发

```bash
# 类型检查
npx tsc --noEmit

# 后端测试
npm test

# 构建
npm run build

# 前端 lint
cd web-ui && npm run lint
```

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | TypeScript + ESM, Node.js 22, ws (WebSocket) |
| 数据库 | Neon PostgreSQL (serverless), 10 个迁移 |
| LLM | GLM-5 (智谱AI), function calling, SSE streaming |
| 前端 | React 19, Vite 8, TailwindCSS 4, Zustand 5 |
| IDE | VS Code Extension API |
| 容器 | Docker multi-stage, docker-compose, nginx |
| CI/CD | GitHub Actions (lint + typecheck + build + docker) |
| 监控 | Prometheus exposition format, 结构化 JSON 日志 |

## 里程碑

| # | 里程碑 | 状态 |
|---|--------|------|
| M1 | LLM API 可靠性（重试 + 降级） | ✅ |
| M2 | 分层配置系统 | ✅ |
| M3 | 数据库存储（Neon PostgreSQL） | ✅ |
| M4 | 服务端状态持久化（Crash Recovery） | ✅ |
| M5 | 监控 + 告警（Prometheus + 结构化日志） | ✅ |
| M6 | Git 深度集成 | ✅ |
| M7 | 文件监听（File Watcher） | ✅ |
| M8 | 多 Shell 支持 | ✅ |
| M9 | MCP 集成（工具生态） | ✅ |
| M10 | WebSocket 认证（API Key + JWT） | ✅ |
| M11 | CLI 模式（终端界面） | ✅ |
| M12 | 沙盒执行（容器隔离） | ✅ |
| M13 | Docker + CI/CD | ✅ |
| M14 | Review 模式 | ✅ |
| M15 | 增强监控面板 | ✅ |
| M16 | 多 Agent 协作（子任务拆分） | ✅ |
| M17 | 代码语义索引（AST 搜索） | ✅ |
| M18 | IDE 插件（VS Code） | ✅ |
| M19 | 用户系统 + 组织 + 权限 | ✅ |
| M20 | 用量追踪 + 计费 | ✅ |
| M21 | 多模态支持 | ✅ |
| M22 | Documentation + Final Verification | ✅ |

## License

MIT
