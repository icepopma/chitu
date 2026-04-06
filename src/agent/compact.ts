/**
 * 上下文压缩（Context Compaction）
 *
 * 对齐 Codex compact.rs
 *
 * 问题：
 * - Agent 循环每轮都往 messages 里追加内容（assistant 回复 + 工具结果）
 * - 10-20 轮后 messages 可能几十万 token，远超 LLM 上下文窗口
 * - 如果不处理，LLM 调用会报 token 超限错误
 *
 * Codex 的做法（compact.rs）：
 * 1. 每轮循环开始前检查 messages 总 token 数
 * 2. 超过阈值 → 把历史消息发给 LLM，让它生成摘要
 * 3. 用摘要替换历史消息，保留最近几轮 + 重新注入初始上下文
 * 4. Agent 继续正常工作，"忘记"了早期细节但保留了关键信息
 *
 * 学习重点：
 * - 这是长任务 Agent 的核心能力，没有它 Agent 做不了 10+ 轮的任务
 * - 压缩策略的选择：全部摘要 vs 保留最近 N 条 vs 混合
 * - 重注入初始上下文（system prompt + AGENTS.md）很重要，否则 Agent 丢失人格和项目知识
 */

import type { Message, ToolDefinition } from '../llm/client.js'
import { buildSystemPrompt, buildInitialMessages } from './loop.js'
import { estimateMessagesTokens } from '../utils/token.js'

/** 压缩配置 */
export interface CompactConfig {
  /** 触发压缩的 token 阈值（默认 80K） */
  compactThreshold?: number
  /** 压缩后保留最近消息的 token 预算（默认 20K） */
  recentBudget?: number
  /** LLM 客户端（用于生成摘要） */
  chatFn: (messages: Message[], tools?: ToolDefinition[]) => Promise<{ content: string | null }>
}

/** 压缩结果 */
export interface CompactResult {
  /** 压缩后的 messages */
  messages: Message[]
  /** 是否触发了压缩 */
  compacted: boolean
  /** 压缩前的 token 数 */
  tokensBefore: number
  /** 压缩后的 token 数（如果触发了压缩） */
  tokensAfter?: number
}

/** 压缩时发给 LLM 的系统提示 */
const COMPACT_SYSTEM_PROMPT = `你是一个上下文压缩助手。你的任务是将一段对话历史压缩为简洁的摘要。

规则：
- 保留所有关键决策、文件修改、错误和解决方案
- 保留用户的核心需求和 Agent 的当前进展
- 丢弃冗余的工具输出细节（如文件内容、命令输出的完整内容）
- 用简洁的要点列表格式
- 用中文输出
- 摘要应该足够详细，让 Agent 能无障碍地继续任务`

/**
 * 检查是否需要压缩
 */
export function needsCompact(messages: Message[], threshold: number): boolean {
  const tokens = estimateMessagesTokens(messages)
  return tokens > threshold
}

/**
 * 执行上下文压缩
 *
 * 步骤（对齐 Codex compact）：
 * 1. 分离初始上下文（system + AGENTS.md + env）和对话历史
 * 2. 从对话历史中取出需要摘要的部分（留出 recentBudget 给最近的消息）
 * 3. 调用 LLM 生成摘要
 * 4. 组装新 messages：初始上下文 + 摘要 + 最近消息
 *
 * @param messages 当前完整的消息列表
 * @param task 用户原始任务
 * @param config 压缩配置
 * @returns 压缩结果
 */
export async function compactMessages(
  messages: Message[],
  task: string,
  config: CompactConfig,
): Promise<CompactResult> {
  const {
    compactThreshold = 80_000,
    recentBudget = 20_000,
    chatFn,
  } = config

  const tokensBefore = estimateMessagesTokens(messages)
  if (tokensBefore <= compactThreshold) {
    return { messages, compacted: false, tokensBefore }
  }

  // 1. 分离初始上下文和对话历史
  // 初始上下文 = 前 3-4 条（system + AGENTS.md + env + user task）
  // 找到第一条 assistant 消息的位置作为对话开始的边界
  let initialEnd = 0
  for (let i = 0; i < messages.length; i++) {
    initialEnd = i + 1
    if (messages[i].role === 'user' && i >= 2) {
      // 到达用户的第一个实际消息（跳过 AGENTS.md 和 env）
      break
    }
  }

  const initialContext = messages.slice(0, initialEnd)
  const conversationHistory = messages.slice(initialEnd)

  if (conversationHistory.length <= 2) {
    // 对话太短，不值得压缩
    return { messages, compacted: false, tokensBefore }
  }

  // 2. 从对话历史尾部保留最近的消息（不超过 recentBudget）
  const recentMessages: Message[] = []
  let recentTokens = 0
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessagesTokens([conversationHistory[i]])
    if (recentTokens + msgTokens > recentBudget && recentMessages.length > 0) {
      break
    }
    recentMessages.unshift(conversationHistory[i])
    recentTokens += msgTokens
  }

  // 需要摘要的部分 = 对话历史 - 最近保留的
  const historyToCompact = conversationHistory.slice(0, conversationHistory.length - recentMessages.length)

  if (historyToCompact.length === 0) {
    return { messages, compacted: false, tokensBefore }
  }

  // 3. 调用 LLM 生成摘要
  const summaryMessages: Message[] = [
    { role: 'system', content: COMPACT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `请压缩以下对话历史为简洁摘要。原始任务：${task}\n\n<conversation>\n${
        historyToCompact.map(m => {
          const role = m.role
          const content = m.content || '(tool call)'
          return `[${role}] ${content.slice(0, 500)}`
        }).join('\n')
      }\n</conversation>`,
    },
  ]

  const summaryResponse = await chatFn(summaryMessages)
  const summary = summaryResponse.content || '(压缩摘要失败，保留原始历史)'

  // 4. 组装新 messages
  const newMessages: Message[] = [
    // 初始上下文（system + AGENTS.md + env + user task）
    ...initialContext,
    // 摘要替换早期历史
    {
      role: 'user',
      content: `[上下文压缩摘要]\n以下是之前对话的关键信息摘要：\n\n${summary}`,
    },
    {
      role: 'assistant',
      content: '已了解之前的对话历史摘要，继续执行任务。',
    },
    // 最近的消息保持原样
    ...recentMessages,
  ]

  const tokensAfter = estimateMessagesTokens(newMessages)

  return {
    messages: newMessages,
    compacted: true,
    tokensBefore,
    tokensAfter,
  }
}
