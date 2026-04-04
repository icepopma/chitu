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
   * 调用 GLM-5
   *
   * @param messages - 对话历史
   * @param tools - 可用工具列表（可选）
   * @returns LLM 的回复
   */
  async chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
      max_tokens: 4096,
    }

    // 如果提供了工具定义，加到请求里
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
}
