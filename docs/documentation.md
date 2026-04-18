# 赤兔文档 (Living Documentation)

本文档随实现持续更新，反映项目真实状态。

## 赤兔是什么

赤兔（Chitu）是一个教育型 AI Agent 系统，架构对齐 OpenAI Codex。使用 GLM-5（智谱AI）的 function calling 实现自主编程 Agent。系统由 WebSocket 后端（Node.js/TypeScript）和 React 前端（Discord 风格聊天 UI）组成。

## 当前状态

### 里程碑进度
- M1-M19: pending（待实现）
- M20: pending（待实现）

### 已完成的核心能力
- Agent Loop（while 循环：LLM → tool_calls → 执行 → 重复）
- Thread/Turn/Item 协议（对齐 Codex）
- WebSocket JSON-RPC 2.0 传输层
- 插件式工具系统（PluginLoader + 依赖排序）
- Context Compaction（80K token 后自动压缩）
- 5 个 Hook 事件点（pre/post tool、session start/end、prompt submit）
- 跨 session 记忆提取和注入
- Skills 加载系统
- 里程碑计划工具（milestone_plan + git_checkpoint/git_rollback）
- 监控面板（/dashboard endpoint + Discord 风格前端）
- 流式输出（item/delta 事件）

## 本地启动

### 后端
```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npx tsx src/start-server.ts
```

### 前端
```bash
cd web-ui && npm run dev
```

### 访问
- Web UI: http://localhost:3000
- WebSocket: ws://localhost:8080
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
  context.ts    — AGENTS.md 层级加载 + 环境上下文
  hooks/        — 5 个事件点的 Shell Hook 分发器
  llm/          — GLM-5 API 客户端（SSE streaming）
  memories/     — 跨 session 知识提取和注入
  rollout/      — JSONL 事件记录（审计/调试回放）
  server/       — WebSocket 传输 + JSON-RPC + HTTP endpoints
  skills/       — Skills 加载系统
  thread/       — ThreadManager + ThreadStore（JSON 文件）
  tools/        — 工具系统：PluginLoader + 多个 Plugin
  types.ts      — 核心类型（Thread/Turn/Item/AppEvent）
web-ui/         — React 19 + Vite 8 前端（Discord 风格）
docs/           — prompt.md + implement.md + documentation.md + 架构文档
plans.md        — 里程碑执行计划（唯一真相源）
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

- 数据存储还是 JSON 文件，需迁移到 SQLite（M2）
- WebSocket 无认证（M5）
- exec 工具无沙盒隔离（M10）
- 无 CI/CD（M11）
- 监控面板指标不够丰富，需对标 Hermes HUD 增强（M20）

## 设计决策记录

（Agent 运行过程中通过 milestone_plan decision 持续更新此节）

## 变更日志

- 2026-04-18: 创建 documentation.md，记录项目初始状态
