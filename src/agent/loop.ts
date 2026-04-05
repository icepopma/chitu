/**
 * Agent Loop — 核心循环
 *
 * 这是整个系统的心脏。
 * 做的事很简单：不断问 LLM "下一步做什么"，直到任务完成。
 *
 * v8 更新：对齐 Codex prompt.md 的系统提示 + 初始上下文组装
 * - system-role: 身份 + 人格 + AGENTS.md spec + 自主性 + 验证 + 工具指南
 * - user-role: AGENTS.md 片段（<INSTRUCTIONS> 包裹）
 * - user-role: 环境上下文（cwd、shell、日期）
 * - user-role: 用户实际输入
 *
 * 学习重点：
 * - while 循环 = Agent 的"自主运行"
 * - 每次循环：LLM 返回 → 判断是 tool_call 还是纯文字 → 执行或结束
 * - MAX_ITERATIONS 防止死循环
 * - signal 支持中途取消
 */

import type { Message, ToolCall, ToolDefinition } from '../llm/client.js'
import { LLMClient } from '../llm/client.js'
import type { Tool } from '../tools/base.js'
import { toolToDefinition } from '../tools/base.js'
import { buildProjectContext } from '../context.js'

// ===== 系统提示（对齐 Codex codex-rs/core/prompt.md） =====

/**
 * 构建系统提示
 *
 * 对齐 Codex prompt.md 的结构：
 * 1. 身份定义
 * 2. 人格设定
 * 3. AGENTS.md spec
 * 4. 自主性指令
 * 5. 验证指令
 * 6. 工具使用指南
 */
export function buildSystemPrompt(): string {
  return `You are a coding agent running in 赤兔 (Chitu), a terminal-based coding assistant. 赤兔 is an open source project. You are expected to be precise, safe, and helpful.

Your capabilities:
- Receive user prompts and other context provided by the harness, such as files in the workspace.
- Communicate with the user by streaming thinking & responses.
- Emit function calls to run terminal commands, read/write/edit files.

# How you work

## Personality
Your default personality and tone is concise, direct, and friendly. You communicate efficiently, always keeping the user clearly informed about ongoing actions without unnecessary detail. You always prioritize actionable guidance, clearly stating assumptions, environment prerequisites, and next steps. Unless explicitly asked, you avoid excessively verbose explanations about your work. 用中文回复。

# AGENTS.md spec
- Repos often contain AGENTS.md files. These files can appear anywhere within the repository.
- These files are a way for humans to give you (the agent) instructions or tips for working within the project.
- Some examples might be: coding conventions, info about how code is organized, or instructions for how to run or test code.
- Instructions in AGENTS.md files:
    - The scope of an AGENTS.md file is the entire directory tree rooted at the folder that contains it.
    - For every file you touch, you must obey instructions in any AGENTS.md file whose scope includes that file.
    - Instructions about code style, structure, naming, etc. apply only to code within the AGENTS.md file's scope, unless the file states otherwise.
    - More-deeply-nested AGENTS.md files take precedence in the case of conflicting instructions.
    - Direct system/developer/user instructions (as part of a prompt) take precedence over AGENTS.md instructions.
- The contents of the AGENTS.md file at the root of the repo are included with the developer message and don't need to be re-read.

# Autonomous behavior
You are autonomous and proactive. Once a user gives you direction:
- Actively gather context, plan, implement, test, and iterate without waiting for additional prompts.
- Persist until the task is fully resolved end-to-end. Do not stop at analysis or partial fixes.
- Prefer action: default to implementation under reasonable assumptions. Do not end your turn with questions unless genuinely blocked.
- If you find yourself repeatedly reading or editing the same files without clear progress, stop and summarize concisely with targeted clarification questions.

# Validating work
- After making code changes, you MUST run relevant tests to verify correctness.
- If tests fail, analyze the error and fix it. Do not skip or ignore failures.
- Before your final response, confirm all changes pass verification.
- Validation commands to prefer: \`npm test\`, \`npm run build\`, \`npx tsc --noEmit\`

# Tool guidelines
- Prefer dedicated tools over raw shell commands: use \`read_file\` over \`cat\`, \`write_file\` over \`echo >\`.
- Use \`exec\` for running commands like \`npm test\`, \`git status\`, \`ls\`.
- Keep tool calls focused — one clear task per call.
- If a command fails, read the error output carefully before retrying.`
}

// ===== Agent Loop =====

/** Agent Loop 的配置 */
export interface AgentLoopConfig {
  /** LLM 客户端 */
  client: LLMClient
  /** 可用工具列表 */
  tools: Tool[]
  /** 系统提示词（不传则用默认的 buildSystemPrompt()） */
  systemPrompt?: string
  /** 最大循环次数，防止死循环（默认 50） */
  maxIterations?: number
  /** 取消信号 */
  signal?: AbortSignal
  /** 每一步的回调（用于观察 Agent 在做什么） */
  onStep?: (step: AgentStep) => void
}

/** Agent 每一步的状态（用于观察和调试） */
export interface AgentStep {
  /** 第几轮循环 */
  iteration: number
  /** 发给 LLM 的消息 */
  messages: Message[]
  /** LLM 返回的内容（如果有） */
  content: string | null
  /** LLM 返回的工具调用（如果有） */
  toolCalls: ToolCall[] | null
  /** 工具执行结果（如果有） */
  toolResults?: Array<{
    toolName: string
    args: Record<string, unknown>
    result: string
    isError: boolean
  }>
}

/** Agent Loop 的最终结果 */
export interface AgentResult {
  /** Agent 最终回复的文字 */
  content: string
  /** 总共循环了几次 */
  iterations: number
  /** Token 用量（各轮累计） */
  totalTokens: number
  /** 是否被中途取消 */
  cancelled: boolean
}

/**
 * 构建初始上下文
 *
 * 对齐 Codex build_initial_context 的组装顺序：
 * 1. system-role: 系统提示（身份 + 人格 + 指南）
 * 2. user-role: AGENTS.md 片段（如果存在）
 * 3. user-role: 环境上下文（cwd、shell、日期）
 * 4. user-role: 用户实际输入
 */
export function buildInitialMessages(task: string, systemPrompt?: string): Message[] {
  const messages: Message[] = []

  // 1. system-role: 系统提示
  messages.push({
    role: 'system',
    content: systemPrompt || buildSystemPrompt(),
  })

  // 2-3. AGENTS.md + 环境上下文
  const { agentsMdMessage, environmentMessage } = buildProjectContext()

  // AGENTS.md 作为 user-role 注入（对齐 Codex UserInstructions）
  if (agentsMdMessage) {
    messages.push({ role: 'user', content: agentsMdMessage })
  }

  // 环境上下文也作为 user-role 注入
  messages.push({ role: 'user', content: environmentMessage })

  // 4. 用户实际输入
  messages.push({ role: 'user', content: task })

  return messages
}

/**
 * Agent Loop 核心
 *
 * 输入：用户的任务描述
 * 输出：Agent 完成任务后的最终回复
 *
 * 循环过程：
 *   1. 把初始上下文（system + AGENTS.md + 环境信息 + 用户消息）+ 工具定义发给 GLM
 *   2. GLM 回复：
 *      - 纯文字 → 任务完成，返回给用户
 *      - tool_calls → 执行工具，结果加入对话，继续循环
 *   3. 重复步骤 2，直到完成或达到最大循环次数
 */
export async function runAgentLoop(
  task: string,
  config: AgentLoopConfig,
): Promise<AgentResult> {
  const {
    client,
    tools,
    systemPrompt,
    maxIterations = 50,
    signal,
    onStep,
  } = config

  // 1. 构建工具查找表
  const toolMap = new Map<string, Tool>()
  for (const tool of tools) {
    toolMap.set(tool.name, tool)
  }

  // 2. 生成 GLM 格式的工具定义
  const toolDefinitions: ToolDefinition[] = tools.map(toolToDefinition)

  // 3. 构建初始上下文（对齐 Codex build_initial_context）
  const messages = buildInitialMessages(task, systemPrompt)

  let totalTokens = 0

  // 4. ★ 核心 while 循环 ★
  for (let i = 0; i < maxIterations; i++) {
    // 检查是否被取消
    if (signal?.aborted) {
      return {
        content: '(任务被取消)',
        iterations: i,
        totalTokens,
        cancelled: true,
      }
    }

    // 4a. 调用 LLM
    const response = await client.chat(messages, toolDefinitions)
    totalTokens += response.usage.total_tokens

    // 4b. 如果没有工具调用 → 任务完成
    if (!response.tool_calls || response.tool_calls.length === 0) {
      const step: AgentStep = {
        iteration: i + 1,
        messages,
        content: response.content,
        toolCalls: null,
      }
      onStep?.(step)

      return {
        content: response.content || '(Agent 没有返回内容)',
        iterations: i + 1,
        totalTokens,
        cancelled: false,
      }
    }

    // 4c. 有工具调用 → 执行工具
    const step: AgentStep = {
      iteration: i + 1,
      messages,
      content: response.content,
      toolCalls: response.tool_calls,
    }

    // 把 assistant 的 tool_call 消息加入历史
    messages.push({
      role: 'assistant',
      content: response.content,
      tool_calls: response.tool_calls,
    })

    // 逐个执行工具
    const toolResults: AgentStep['toolResults'] = []

    for (const tc of response.tool_calls) {
      if (signal?.aborted) {
        return {
          content: '(任务被取消)',
          iterations: i + 1,
          totalTokens,
          cancelled: true,
        }
      }

      const toolName = tc.function.name
      const args = JSON.parse(tc.function.arguments)
      const tool = toolMap.get(toolName)

      let resultContent: string
      let isError: boolean

      if (!tool) {
        resultContent = `错误：未知工具 "${toolName}"`
        isError = true
      } else {
        try {
          const result = await tool.execute(args)
          resultContent = result.content
          isError = result.isError || false
        } catch (err: any) {
          resultContent = `工具执行出错: ${err.message}`
          isError = true
        }
      }

      toolResults.push({
        toolName,
        args,
        result: resultContent,
        isError,
      })

      // 把工具结果加入历史（role = 'tool'）
      messages.push({
        role: 'tool',
        content: resultContent,
        tool_call_id: tc.id,
      })
    }

    step.toolResults = toolResults
    onStep?.(step)

    // 继续循环 → 下一轮会带着工具结果再次调用 LLM
  }

  // 达到最大循环次数
  return {
    content: '(达到最大循环次数，Agent 仍未完成任务)',
    iterations: maxIterations,
    totalTokens,
    cancelled: false,
  }
}
