/**
 * 记忆提取器 — 从对话中提取结构化记忆
 *
 * 对齐 Codex codex-rs/core/src/memories/phase1.rs
 * 简化：每个 turn 结束后提取，不使用 job 队列
 *
 * 流程：
 * 1. 收集 turn 中的所有 items（用户消息 + 工具调用 + 结果）
 * 2. 用 LLM 提取关键记忆（偏好、架构、约定、失败、事实）
 * 3. 去重后存入 MemoryStorage
 */

import type { Item } from '../types.js'
import type { LLMClient, Message } from '../llm/client.js'
import { MemoryStorage, type MemoryCategory } from './storage.js'

/** 有效的记忆类别集合 */
const VALID_CATEGORIES = new Set<string>([
  'preference', 'architecture', 'convention', 'failure', 'fact',
])

/** 触发提取的最少 items 数（user_message + assistant_message = 2 即可） */
const MIN_ITEMS_FOR_EXTRACTION = 2

/** 提取 prompt 的对话摘要长度上限 */
const MAX_CONVERSATION_LENGTH = 6000

/**
 * 记忆提取器
 */
export class MemoryExtractor {
  private storage: MemoryStorage
  private client: LLMClient

  constructor(client: LLMClient, storage?: MemoryStorage) {
    this.client = client
    this.storage = storage || new MemoryStorage()
  }

  /**
   * 从对话 items 中提取记忆
   *
   * @returns 新增的记忆数量
   */
  async extractFromItems(
    items: Item[],
    threadId: string,
  ): Promise<number> {
    // 过滤太短的对话
    if (items.length < MIN_ITEMS_FOR_EXTRACTION) return 0

    // 构建对话摘要
    const conversation = this.summarizeConversation(items)
    if (!conversation) return 0

    // 用 LLM 提取记忆
    const extracted = await this.callLLMForExtraction(conversation)
    if (extracted.length === 0) return 0

    // 存储新记忆（内部去重）
    const added = this.storage.addMemories(
      extracted.map(m => ({
        category: m.category as MemoryCategory,
        content: m.content,
        sourceThreadId: threadId,
      }))
    )

    return added.length
  }

  /**
   * 将对话 items 转为摘要文本
   *
   * 保留关键信息，压缩工具输出
   */
  private summarizeConversation(items: Item[]): string | null {
    const lines: string[] = []

    for (const item of items) {
      switch (item.type) {
        case 'user_message':
          lines.push(`User: ${item.content}`)
          break
        case 'assistant_message':
          // 助手消息截断，保留关键部分
          const msg = item.content.length > 300
            ? item.content.slice(0, 300) + '...'
            : item.content
          lines.push(`Assistant: ${msg}`)
          break
        case 'tool_call':
          lines.push(`Tool call: ${item.toolName}(${truncateToolArgs(item.content)})`)
          break
        case 'tool_result': {
          // 工具结果大幅压缩，只保留成功/失败标记和前几行
          const exitCode = item.exitCode ?? 0
          const status = exitCode === 0 ? 'SUCCESS' : `FAILED(exit ${exitCode})`
          const resultPreview = item.content.length > 200
            ? item.content.slice(0, 200) + `... [${status}]`
            : `${item.content} [${status}]`
          lines.push(`Tool result (${item.toolName}): ${resultPreview}`)
          break
        }
      }
    }

    if (lines.length === 0) return null

    const text = lines.join('\n')

    // 如果总长度超预算，截断中间部分
    if (text.length > MAX_CONVERSATION_LENGTH) {
      const half = Math.floor(MAX_CONVERSATION_LENGTH / 2)
      return text.slice(0, half) + '\n... (truncated) ...\n' + text.slice(-half)
    }

    return text
  }

  /**
   * 调用 LLM 提取记忆
   *
   * 对齐 Codex memories/prompts.rs 的提取 prompt
   */
  private async callLLMForExtraction(
    conversation: string,
  ): Promise<Array<{ category: string; content: string }>> {
    const extractionPrompt = `Analyze this conversation and extract structured memories. Focus on things worth remembering for future conversations.

Extract memories in these categories:
- preference: User preferences about how they want things done (style, approach, tools)
- architecture: Key architecture or design decisions made during the conversation
- convention: Project-specific coding conventions, patterns, or file organization rules
- failure: Bugs encountered, error patterns, and their solutions
- fact: Important facts about the project, dependencies, or environment

Rules:
- Only extract genuinely useful, non-obvious information
- Each memory should be a single, self-contained fact (not a conversation summary)
- Do NOT extract: trivial facts, obvious information, or temporary state
- Do NOT extract: the content of files that were read/written (those are in the project)
- Prefer specific, actionable memories over vague generalizations
- Maximum 5 memories per conversation

Respond with ONLY a JSON array, no markdown fences:
[{"category": "preference", "content": "..."}, ...]

If nothing worth remembering, respond with: []`

    const messages: Message[] = [
      { role: 'system', content: extractionPrompt },
      { role: 'user', content: `Conversation to analyze:\n\n${conversation}` },
    ]

    try {
      const response = await this.client.chat(messages)
      const text = (response.content || '').trim()

      // 提取 JSON：处理 markdown fence 和前后多余文本
      let jsonText = text
      const fenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
      if (fenceMatch) {
        jsonText = fenceMatch[1].trim()
      }
      // 兜底：找到第一个 [ 和最后一个 ] 之间的内容
      const arrMatch = jsonText.match(/\[[\s\S]*\]/)
      if (arrMatch) {
        jsonText = arrMatch[0]
      }

      const parsed = JSON.parse(jsonText)
      if (!Array.isArray(parsed)) return []

      // 验证每条记忆的格式
      return parsed.filter(
        (m: any) =>
          typeof m.category === 'string' &&
          typeof m.content === 'string' &&
          m.content.length > 0 &&
          VALID_CATEGORIES.has(m.category)
      )
    } catch (err) {
      // 提取失败不应影响主流程
      console.warn('[memories] 提取失败:', (err as Error).message)
      return []
    }
  }

  /** 获取存储引用（供外部使用） */
  getStorage(): MemoryStorage {
    return this.storage
  }
}

/** 截断工具调用参数用于摘要 */
function truncateToolArgs(args: string): string {
  if (args.length <= 100) return args
  return args.slice(0, 100) + '...'
}
