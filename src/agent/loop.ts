/**
 * Agent Loop — 核心循环
 *
 * 这是整个系统的心脏。
 * 做的事很简单：不断问 LLM "下一步做什么"，直到任务完成。
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

/** Agent Loop 的配置 */
export interface AgentLoopConfig {
  /** LLM 客户端 */
  client: LLMClient
  /** 可用工具列表 */
  tools: Tool[]
  /** 系统提示词（告诉 Agent 它是谁、该怎么做） */
  systemPrompt: string
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
 * Agent Loop 核心
 *
 * 输入：用户的任务描述
 * 输出：Agent 完成任务后的最终回复
 *
 * 循环过程：
 *   1. 把用户消息 + 工具定义发给 GLM
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

  // 3. 初始化对话历史
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task },
  ]

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
