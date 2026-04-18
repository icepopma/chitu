# 赤兔自主运行规范 (Prompt Spec)

## 目标

将赤兔（Chitu）从一个基础的 Agent 系统，升级为一个完整的、可用于演示和实际开发的自主编程 Agent。包含数据库存储、认证、监控、Git 集成、MCP 工具生态、CLI 界面、容器化等能力。

## 核心目标（必须全部完成）

1. **可靠性**：LLM 调用有重试和降级，服务能从崩溃中恢复
2. **持久化**：数据从 JSON 文件迁移到 SQLite，支持复杂查询
3. **安全性**：WebSocket 有认证，工具执行有沙盒
4. **可观测性**：有监控面板、结构化日志、Prometheus 指标
5. **生态集成**：Git 深度集成、MCP 工具协议、VS Code 插件
6. **多端访问**：CLI 终端界面 + Web UI + IDE 插件
7. **生产就绪**：Docker 部署、CI/CD、用户系统、用量计费

## 非目标（不做）

- 不自研 LLM，只对接 GLM-5
- 不做分布式部署，单机运行
- 不做移动端 App
- 不做国际化和多语言（中文为主）
- 不做实时协作（多人同时编辑同一个 Thread）

## 硬约束

- **TypeScript + ESM**，import 路径用 `.js` 后缀
- **LLM**: 只用 GLM-5 via 智谱AI，`ZHIPU_API_KEY` 环境变量
- **不修改 `src/types.ts` 中的 AppEvent 类型**（对齐 Codex 协议）
- **新工具必须用 Plugin 接口**（`src/tools/plugins/`）
- **所有代码通过 `npx tsc --noEmit`** — 类型检查是硬性要求
- **现有 e2e 测试不能回归** — 任何改动不能破坏已有功能
- **保持 4 层架构不变**：Transport → Message Processor → Thread Manager → Agent Loop
- **用中文写注释和文档**，代码标识符用英文

## 技术栈

- 后端：Node.js + TypeScript (ESM) + ws + better-sqlite3
- 前端：React 19 + Vite 8 + TailwindCSS 4 + Zustand 5
- LLM：GLM-5 via 智谱AI（function calling）
- 数据：SQLite（threads、rollout_events、memories 表）
- 部署：Docker + GitHub Actions CI

## "Done When" 检查清单

全部 M1-M20 里程碑完成，且满足以下条件：

- [ ] `npx tsc --noEmit` 通过（0 errors，除 vitest 声明文件）
- [ ] `npm test` 通过
- [ ] `npm run build` 通过
- [ ] `npm run dev` 启动后端 + `cd web-ui && npm run dev` 启动前端
- [ ] 浏览器访问 localhost:3000 能创建对话、发送消息、收到回复
- [ ] 监控面板 localhost:8080/dashboard 显示里程碑进度
- [ ] 所有 20 个 milestones 在 plans.md 中标记为 completed
- [ ] README.md 和 CLAUDE.md 反映最终架构
- [ ] docs/architecture.md 描述完整系统

## 参考

- Codex（`openai/codex`）：Agent Loop + Thread/Turn/Item 协议 + Git worktree + 沙盒
- Design Desk（`derrickchoi-openai/design-desk`）：长任务里程碑模式 + prompt.md/implement.md/documentation.md 三文件方法
- Hermes HUD（`joeynyc/hermes-hudui`）：监控面板参考
