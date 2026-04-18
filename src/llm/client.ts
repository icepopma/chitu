/**
 * GLM-5 API 客户端
 *
 * 这是整个系统跟 LLM 通信的唯一入口。
 * 做的事很简单：发 HTTP 请求，拿回回复。
 *
 * 学习重点：
 * - LLM API 就是一个 HTTP 接口
 * - messages 数组就是"对话历史"
 * - function calling 让模型可以说"我想调用某个工具"
 * - v14.2：新增 chatStream() 支持流式输出（SSE）
 */

// ===== 类型定义 =====

/** 一条消息，发给 LLM 或从 LLM 收到 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  /** tool_calls：当模型想调用工具时，这个字段会有值 */
  tool_calls?: ToolCall[]
  /** tool_call_id：当这条消息是工具执行结果时，标识对应哪个工具调用 */
  tool_call_id?: string
}

/** 模型返回的工具调用请求 */
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string  // JSON 字符串，需要 parse
  }
}

/** 工具定义（告诉模型"你可以用哪些工具"） */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>  // JSON Schema
  }
}

/** LLM 返回的完整结果 */
export interface LLMResponse {
  content: string | null
  tool_calls: ToolCall[] | null
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/** 流式输出的一个 chunk */
export interface StreamChunk {
  /** 增量文本内容 */
  delta: string
  /** 是否结束 */
  done: boolean
  /** 工具调用（累积的，仅在完成时有值） */
  tool_calls: ToolCall[] | null
  /** usage（仅在最后一个 chunk） */
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

// ===== 客户端实现 =====

export class LLMClient {
  private apiKey: string
  private model: string
  private endpoint: string

  constructor() {
    this.apiKey = process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY || ''
    this.model = 'glm-5'
    this.endpoint = process.env.ZHIPU_CODING_ENDPOINT
      || 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions'

    if (!this.apiKey) {
      throw new Error('需要设置 ZHIPU_API_KEY 或 GLM_API_KEY 环境变量')
    }
  }

  /**
   * 带重试的 fetch — 指数退避（1s/2s/4s）
   * 429（限流）和 5xx（服务端）自动重试，4xx（客户端）不重试
   * 网络错误（DNS、连接超时、断网）也自动重试
   */
  private async fetchWithRetry(url: string, init: RequestInit, maxRetries = 3): Promise<Response> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, init)
        // 429 或 5xx → 重试
        if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000
          console.warn(`[llm] ${response.status} on attempt ${attempt + 1}, retrying in ${delay}ms...`)
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        return response
      } catch (err: any) {
        // 网络错误（ECONNREFUSED, ENOTFOUND, timeout, 断网）→ 重试
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000
          console.warn(`[llm] network error on attempt ${attempt + 1}: ${err.message}, retrying in ${delay}ms...`)
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        throw err
      }
    }
    // unreachable but TypeScript needs it
    throw new Error('Max retries exceeded')
  }

  /**
   * 调用 GLM-5（非流式）
   */
  async chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
      max_tokens: 4096,
    }

    if (tools && tools.length > 0) {
      body.tools = tools
      body.tool_choice = 'auto'
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`GLM API error ${response.status}: ${text}`)
    }

    const data = await response.json()
    const choice = data.choices?.[0]

    if (!choice) {
      throw new Error('GLM API 返回了空响应')
    }

    return {
      content: choice.message.content || null,
      tool_calls: choice.message.tool_calls || null,
      usage: {
        prompt_tokens: data.usage?.prompt_tokens || 0,
        completion_tokens: data.usage?.completion_tokens || 0,
        total_tokens: data.usage?.total_tokens || 0,
      },
    }
  }

  /**
   * 流式调用 GLM-5（SSE）
   *
   * 对齐 OpenAI streaming 协议：
   * - 发 stream: true，API 返回 SSE 事件流
   * - 每个 chunk: data: {"choices":[{"delta":{"content":"..."}}]}
   * - 结束: data: [DONE]
   *
   * @param onChunk - 每收到一个 chunk 就调用
   * @returns 累积的完整响应（方便调用方）
   */
  async chatStream(
    messages: Message[],
    onChunk: (chunk: StreamChunk) => void,
    tools?: ToolDefinition[],
  ): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      max_tokens: 16384,
      stream_options: { include_usage: true },
    }

    if (tools && tools.length > 0) {
      body.tools = tools
      body.tool_choice = 'auto'
    }

    const response = await this.fetchWithRetry(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`GLM API stream error ${response.status}: ${text}`)
    }

    // 累积结果
    let content = ''
    const toolCallsMap = new Map<number, ToolCall>()
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

    // 解析 SSE 流
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6)
          if (data === '[DONE]') {
            onChunk({ delta: '', done: true, tool_calls: null, usage })
            break
          }

          try {
            const parsed = JSON.parse(data)
            const choice = parsed.choices?.[0]

            if (choice) {
              const textDelta = choice.delta?.content
              if (textDelta) {
                content += textDelta
                onChunk({ delta: textDelta, done: false, tool_calls: null })
              }

              if (choice.delta?.tool_calls) {
                for (const tc of choice.delta.tool_calls) {
                  const idx = tc.index ?? 0
                  if (!toolCallsMap.has(idx)) {
                    toolCallsMap.set(idx, {
                      id: tc.id || '',
                      type: 'function',
                      function: { name: '', arguments: '' },
                    })
                  }
                  const existing = toolCallsMap.get(idx)!
                  if (tc.id) existing.id = tc.id
                  if (tc.function?.name) existing.function.name += tc.function.name
                  if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
                }
              }
            }

            if (parsed.usage) {
              usage = {
                prompt_tokens: parsed.usage.prompt_tokens || 0,
                completion_tokens: parsed.usage.completion_tokens || 0,
                total_tokens: parsed.usage.total_tokens || 0,
              }
            }
          } catch {
            // 跳过无法解析的行
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    // 组装最终结果
    const toolCalls = toolCallsMap.size > 0
      ? Array.from(toolCallsMap.values())
      : null

    return {
      content: content || null,
      tool_calls: toolCalls,
      usage,
    }
  }
}
