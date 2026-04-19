/**
 * Token 计数估算
 *
 * 学习重点：
 * - 精确 token 计数需要 tokenizer（如 tiktoken），但 Agent 运行时不值得引入重量级依赖
 * - Codex 也用估算：英文 ~4 字符/token，中文 ~2 字符/token
 * - 赤兔用保守值 3 字符/token，混合中英文场景够用
 * - 主要用途：决定何时触发上下文压缩
 */

/** 每字符估算 token 数（保守值，适合中英混合） */
const CHARS_PER_TOKEN = 3

/**
 * 估算文本的 token 数
 */
export function approxTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * 估算一组消息的总 token 数
 *
 * 遍历所有消息的 content + tool_calls 参数，累加估算值。
 * 不包括协议开销（role 字段、JSON 结构等），但足够用于阈值判断。
 */
export function estimateMessagesTokens(messages: Array<{ content: string | unknown[] | null; tool_calls?: any[] }>): number {
  let total = 0
  for (const msg of messages) {
    if (msg.content) {
      total += typeof msg.content === 'string' ? approxTokenCount(msg.content) : approxTokenCount(JSON.stringify(msg.content))
    }
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += approxTokenCount(tc.function?.arguments || '')
        total += approxTokenCount(tc.function?.name || '')
      }
    }
    // 每条消息的协议开销（role, 结构等）
    total += 4
  }
  return total
}
