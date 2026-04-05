# 赤兔 (Chitu) 项目指南

## 项目简介

赤兔是一个从零构建的 AI Agent 系统，对齐 OpenAI Codex 的架构。用 GLM-5 + function calling 实现自主编码 Agent。

## 项目结构

```
src/
  agent/loop.ts          — Agent Loop 核心（while 循环：LLM → tool_calls → 执行 → 循环）
  context.ts             — AGENTS.md 加载 + 环境上下文
  types.ts               — Thread/Turn/Item 类型定义
  llm/client.ts          — GLM-5 API 客户端
  tools/
    base.ts              — Tool 接口定义
    exec.ts              — Shell 命令执行工具
    files.ts             — 文件读写编辑工具
    index.ts             — Tool Registry（工具注册表）
  thread/
    manager.ts           — ThreadManager（create/resume/runTurn）
    store.ts             — JSON 文件持久化
  server/
    index.ts             — WebSocket 服务器
    json-rpc.ts           — JSON-RPC 2.0 协议层
    message-processor.ts — JSON-RPC ↔ ThreadManager 翻译层
  start-server.ts        — 服务器启动入口
web-ui/                  — React 前端（Discord 风格 UI）
```

## 技术栈

- TypeScript + ESM（"type": "module"）
- GLM-5 API（智谱AI，function calling）
- Node.js，ws 库（WebSocket）
- React 18 + Vite + TailwindCSS + Zustand

## 开发命令

```bash
npx tsx src/start-server.ts    # 启动 WebSocket 服务器（端口 8080）
cd web-ui && npm run dev       # 启动前端（端口 5173）
npx tsx src/test-server.ts     # 端到端测试
```

## 编码约定

- 源码在 `src/`，TS + ESM，import 路径带 `.js` 后缀
- 每个模块顶部有 JSDoc 注释说明"做什么"和"学习重点"
- 工具遵循 Tool 接口（name, description, parameters, execute）
- 事件系统对齐 Codex 协议：thread/started, turn/started, item/started, item/completed, turn/completed

## 注意事项

- 不要修改 `src/types.ts` 中的 AppEvent 类型，它对齐 Codex 协议
- Agent Loop 的核心是 `src/agent/loop.ts` 的 while 循环，改之前要理解它
- 前端用单例 WebSocket（useChituSocket.ts），不要创建多个连接
- 数据存在 `./chitu-data/threads/`，不要手动修改
