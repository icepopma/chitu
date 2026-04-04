# Codex 架构研究笔记

研究来源：OpenAI 官方博客 3 篇 + Codex 开源仓库源码分析 + Harness Engineering 实践文章

## 一、核心架构（Codex 的三大层）

```
┌─────────────────────────────────────────┐
│           Transport Layer                │
│     stdio / WebSocket (JSON-RPC 2.0)     │
├─────────────────────────────────────────┤
│          App Server Layer                │
│  MessageProcessor → CodexMessageProcessor│
│  ThreadManager → Codex Core Threads      │
├─────────────────────────────────────────┤
│           Codex Core Layer               │
│  Agent Loop + Tools + Context Manager    │
│  + Compaction + Skills + Plugins         │
└─────────────────────────────────────────┘
```

**关键洞察**：三层中，Agent Loop（Core Layer）是一切的基础。先写 Loop，再包 App Server，最后加 Transport。

## 二、Agent Loop（系统心脏）

来源：[Unrolling the Codex Agent Loop](https://openai.com/index/unrolling-the-codex-agent-loop/)

### 循环算法

```
while True:
    response = LLM(messages + tool_definitions)

    if response 是纯文字:
        返回给用户，循环结束

    if response 包含 tool_calls:
        for each tool_call:
            result = execute(tool_call)
            messages.append(tool_result)
        continue  # 回到循环开头
```

### 关键设计

1. **一次 Turn 可能包含多次 LLM 调用**：用户发一句话，Agent 可能循环 5-50 次
2. **tool_calls 和 reasoning 都必须包含在后续请求中**：否则模型会丢失上下文
3. **最大迭代次数限制**：防止死循环（Codex 用 50 次）
4. **流式传输**：用 SSE (Server-Sent Events) 实时推送增量

### 提示词构建顺序（重要！）

```
1. system message     ← 服务器控制
2. tools list         ← 工具定义（缓存关键！）
3. instructions       ← 开发者指令
4. input items        ← 用户消息、工具结果
```

**为什么这个顺序？** 因为 prompt caching 要求**精确前缀匹配**。静态内容放前面，变量内容放后面。tools 必须每次一样，否则缓存失效。

## 三、工具系统

来源：[为 Responses API 配备计算机环境](https://openai.com/zh-Hans-CN/index/equip-responses-api-computer-environment/)

### Shell 工具（最核心）

- 模型提出 shell 命令，平台在容器中执行
- 支持并发执行多条命令
- 有界输出：每个命令指定输出上限，保留首尾，中间截断
- 例：`开头部分 ... 已截断 1000 字符 ... 结尾部分`

### 工具的三层来源

1. **平台提供**：shell、file_read、file_write（沙盒内）
2. **API 提供**：web_search、image_generation 等
3. **用户提供**：MCP 服务器、Skills

### 输出截断模式（重要！）

```json
{
  "output_cap": 1000,
  "result": "开头... 已截断 1000 字符 ...结尾"
}
```

工具输出可能非常大（日志、文件内容）。不做截断会耗尽上下文。

## 四、App Server（Harness）

来源：[解锁 Codex 运行框架](https://openai.com/zh-Hans-CN/index/unlocking-the-codex-harness/)

### 三个对话原语

| 原语 | 说明 | 生命周期 |
|------|------|----------|
| **Thread** | 用户与 Agent 的会话容器 | 创建、恢复、fork、归档 |
| **Turn** | 由用户输入发起的一次 Agent 工作周期 | started → in_progress → completed/interrupted |
| **Item** | 输入/输出的基本单位 | started → delta(可选) → completed |

### Item 类型

- `user_message` — 用户消息
- `assistant_message` — Agent 回复
- `tool_call` — 工具调用请求
- `tool_result` — 工具执行结果
- `approval_request` — 需要用户审批的操作

### Item 生命周期事件

```
item/started    → 开始
item/delta      → 流式增量（可选，用于文本流）
item/completed  → 完成
```

### JSON-RPC 协议

**Client → Server（请求）**：
- `initialize` — 握手
- `thread/create` — 创建线程
- `turn/start` — 提交消息，启动 Agent Loop
- `turn/interrupt` — 中断当前 Turn

**Server → Client（通知）**：
- `item/started`, `item/delta`, `item/completed`
- `turn/started`, `turn/completed`

**Server → Client（请求）**：
- `approval/request` — Agent 需要用户审批才能继续

### 双向通信模式

App Server 是**完全双向**的：
- 客户端发请求，服务端回多个通知
- 服务端也可以主动发请求（如审批），客户端必须回应

## 五、上下文压缩（Compaction）

来源：文章 2

### 为什么需要

Agent 长时间运行时，对话历史不断增长。128K token 的上下文窗口会被填满。

### Codex 的做法

1. **旧方案**：手动 `/compact`，让 LLM 总结对话，用总结替换旧消息
2. **新方案**：`/responses/compact` 端点，返回 `type=compaction` 的特殊 item，包含 `encrypted_content`（不透明的压缩表示），保留模型的潜在理解

### 自动压缩触发

- 设定 `auto_compact_limit` token 阈值
- 超过阈值时自动压缩
- 压缩后新上下文 = 压缩项 + 早期窗口的高价值部分

## 六、工程实践（Harness Engineering）

来源：[Harness Engineering 文章](https://openai.com/zh-Hans-CN/index/harness-engineering/)

### 1. "给 Agent 一张地图，不是一本说明书"

- AGENTS.md ~100 行，作为内容目录
- 深层信息放在 docs/ 目录
- **渐进式披露**：Agent 从小入口开始，按需深入

### 2. "强制执行不变量，不微观管理实施"

- 用自定义 linter 强制执行架构规则
- 错误信息中注入修复指令（Agent 可以直接理解错误并修复）
- 在中央层强制执行边界，在本地层允许自主权

### 3. 严格分层架构

```
Types → Config → Repo → Service → Runtime → UI
```

依赖方向严格，只能"向前"依赖。横切关注点通过单一显式接口进入。

### 4. 工具 = Agent 能力的边界

> "当 Agent 遇到困难时，解决方案不是'再努力一点'，
> 而是追问：Agent 还需要什么能力？我们如何让它既清晰又可执行？"

### 5. 自我验证循环

Agent 可以：
- 运行应用验证修复
- 录制视频演示 bug 和修复
- 运行测试检查结果
- 查看 UI 截图确认行为

### 6. "垃圾回收"式技术债管理

- 每天运行 Agent 扫描偏差和不良模式
- 发起小的重构 PR
- 人类品味一旦被捕捉，就编码到系统中

## 七、对 Chitu 项目的具体指导

### 构建顺序验证

```
✅ 1. 调通 LLM API          — 已完成
✅ 2. 第一个 Tool (exec)     — 已完成  
→  3. Agent Loop             — 下一步（核心中的核心）
   4. 更多 Tool              — 文件读写、搜索、输出截断
   5. Thread/Turn/Item       — 对话原语
   6. JSON-RPC 服务          — 传输层
   7. 前端                    — 可视化
   8. 上下文压缩              — 长任务支持
```

### Agent Loop 实现要点

- 最大迭代次数：50
- 每次循环检查 AbortSignal
- 工具调用结果必须加入 messages 数组
- assistant 消息中的 tool_calls 也必须加入（不能只加 tool result）

### 工具系统设计要点

- 工具输出必须有长度限制（截断模式）
- 工具定义要稳定（影响 prompt caching）
- 工具错误也要返回给 LLM（让它知道失败了，可以换策略）

### 提示词设计要点

- system prompt 简短精炼
- 静态内容放前面，变量内容放后面
- 工具定义顺序保持一致
