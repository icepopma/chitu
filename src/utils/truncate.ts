/**
 * 输出截断工具
 *
 * 学习重点：
 * - Agent 执行命令可能产生大量输出（如 npm install, git log）
 * - 无限增长的工具输出会撑爆 LLM 上下文窗口
 * - Codex 的做法：HeadTailBuffer — 保留头尾，中间截断
 */

import { approxTokenCount } from './token.js'

/** 默认最大 token 数 */
const DEFAULT_MAX_TOKENS = 10_000

/** 每字符估算 token 数（与 token.ts 保持一致） */
const CHARS_PER_TOKEN = 3

/** 截断时的提示文本 */
const TRUNCATION_NOTICE = '\n\n... [输出被截断，保留头尾部分] ...\n\n'

/**
 * 将 token 数转换为大致字符数
 */
function tokensToChars(tokens: number): number {
  return tokens * CHARS_PER_TOKEN
}

/**
 * 截断过长的工具输出
 *
 * 策略（对齐 Codex HeadTailBuffer）：
 * - 如果内容在 token 预算内 → 原样返回
 * - 如果超出 → 保留前半 + 截断提示 + 保留后半
 *
 * @param content 工具输出内容
 * @param maxTokens 最大允许 token 数（默认 10K）
 * @returns 截断后的内容
 */
export function truncateOutput(content: string, maxTokens: number = DEFAULT_MAX_TOKENS): string {
  const currentTokens = approxTokenCount(content)
  if (currentTokens <= maxTokens) {
    return content
  }

  const maxChars = tokensToChars(maxTokens)
  // 头尾各占一半预算，再减去截断提示的长度
  const halfBudget = Math.floor((maxChars - TRUNCATION_NOTICE.length) / 2)

  const head = content.slice(0, halfBudget)
  const tail = content.slice(content.length - halfBudget)

  const originalTokens = approxTokenCount(content)
  const result = head + TRUNCATION_NOTICE + tail

  return `[原始输出约 ${originalTokens} tokens，已截断至约 ${maxTokens} tokens]\n${result}`
}
