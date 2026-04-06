/**
 * ThreadManager — 线程操作的核心逻辑
 *
 * 操作：create / resume / archive / list / get
 * runTurn: 把 Agent Loop 的每一步转成 Item，记录到 Thread
 *
 * 事件系统：每个关键操作都会 emit AppEvent
 * 未来的 Message Processor 监听这些事件，转成 JSON-RPC 通知推给客户端
 */

import { randomUUID } from 'crypto'
import type { Thread, Turn, Item, AppEvent, EventHandler } from '../types.js'
import { ThreadStore } from './store.js'
import { runAgentLoop, buildSystemPrompt } from '../agent/loop.js'
import type { AgentResult } from '../agent/loop.js'
import { LLMClient } from '../llm/client.js'
import { createToolRegistry } from '../tools/index.js'

/** runTurn 的配置选项 */
export interface RunTurnOptions {
  /** LLM 客户端（不传则自动创建） */
  client?: LLMClient
  /** 系统提示词 */
  systemPrompt?: string
  /** 最大循环次数 */
  maxIterations?: number
  /** 取消信号 */
  signal?: AbortSignal
}

/** runTurn 的返回结果 */
export interface RunTurnResult {
  /** Agent 最终回复 */
  content: string
  /** 这一轮的 Turn */
  turn: Turn
  /** 循环次数 */
  iterations: number
  /** Token 用量 */
  totalTokens: number
  /** 是否被取消 */
  cancelled: boolean
}

export class ThreadManager {
  private store: ThreadStore
  private handler?: EventHandler

  constructor(dataDir?: string) {
    this.store = new ThreadStore(dataDir)
  }

  /** 设置事件监听器（Message Processor 用这个接收事件） */
  onEvent(handler: EventHandler): void {
    this.handler = handler
  }

  /** 发射事件 */
  private emit(event: AppEvent): void {
    this.handler?.(event)
  }

  /** 创建新线程 */
  async create(title?: string): Promise<Thread> {
    const now = Date.now()
    const thread: Thread = {
      id: randomUUID(),
      title: title || '新对话',
      status: 'created',
      items: [],
      createdAt: now,
      updatedAt: now,
    }
    await this.store.save(thread)
    this.emit({ type: 'thread/started', thread })
    return thread
  }

  /** 恢复线程（重连场景） */
  async resume(threadId: string): Promise<Thread | undefined> {
    const thread = await this.store.load(threadId)
    if (thread && (thread.status === 'idle' || thread.status === 'active')) {
      thread.status = 'active'
      thread.updatedAt = Date.now()
      await this.store.save(thread)
    }
    return thread
  }

  /** 归档线程 */
  async archive(threadId: string): Promise<void> {
    const thread = await this.store.load(threadId)
    if (thread) {
      thread.status = 'archived'
      thread.updatedAt = Date.now()
      await this.store.save(thread)
    }
  }

  /** 列出所有线程（摘要） */
  async listThreads() {
    return this.store.list()
  }

  /** 获取单个线程 */
  async getThread(threadId: string): Promise<Thread | undefined> {
    return this.store.load(threadId)
  }

  /** 删除线程 */
  async deleteThread(threadId: string): Promise<void> {
    await this.store.delete(threadId)
  }

  /**
   * runTurn — 核心方法
   *
   * 把 Agent Loop 的每一步都转成 Item，记录到 Thread
   * 每一步都 emit 事件，外部可以监听
   *
   * 事件流程（对齐 Codex 协议）：
   *   turn/started
   *   item/started → item/completed  (user_message)
   *   item/started → item/completed  (tool_call)
   *   item/started → item/completed  (tool_result)
   *   ...
   *   item/started → item/completed  (assistant_message)
   *   turn/completed
   */
  async runTurn(
    threadId: string,
    userInput: string,
    options?: RunTurnOptions,
  ): Promise<RunTurnResult> {
    const thread = await this.store.load(threadId)
    if (!thread) throw new Error(`线程 ${threadId} 不存在`)
    if (thread.status === 'archived') throw new Error(`线程 ${threadId} 已归档`)

    // 1. 创建 Turn
    const turn: Turn = {
      id: randomUUID(),
      threadId,
      status: 'in_progress',
      startedAt: Date.now(),
    }
    this.emit({ type: 'turn/started', turn, thread })

    // 2. 添加 user_message Item
    const userItem = this.addItem(thread, {
      id: randomUUID(),
      type: 'user_message',
      status: 'completed',
      content: userInput,
      startedAt: Date.now(),
      completedAt: Date.now(),
    })

    thread.status = 'active'

    // 3. 构建 Agent Loop 的对话历史
    const client = options?.client || new LLMClient()
    const tools = createToolRegistry().list()

    // 从已有 items 重建对话历史
    const messages = this.buildMessages(thread)

    // 4. 运行 Agent Loop
    let agentResult: AgentResult

    try {
      agentResult = await runAgentLoop(userInput, {
        client,
        tools,
        systemPrompt: options?.systemPrompt || buildSystemPrompt(),
        maxIterations: options?.maxIterations || 50,
        signal: options?.signal,
        onStep: (step) => {
          if (step.toolCalls) {
            // Agent 调用了工具 → 添加 tool_call Items
            for (const tc of step.toolCalls) {
              this.addItem(thread, {
                id: randomUUID(),
                type: 'tool_call',
                status: 'completed',
                content: tc.function.arguments,
                toolName: tc.function.name,
                toolArgs: JSON.parse(tc.function.arguments),
                toolCallId: tc.id,
                startedAt: Date.now(),
                completedAt: Date.now(),
              })
            }
          }

          if (step.toolResults) {
            // 工具执行结果 → 添加 tool_result Items
            for (const tr of step.toolResults) {
              this.addItem(thread, {
                id: randomUUID(),
                type: 'tool_result',
                status: 'completed',
                content: tr.result,
                toolName: tr.toolName,
                isError: tr.isError,
                exitCode: tr.exitCode,
                startedAt: Date.now(),
                completedAt: Date.now(),
              })
            }
          }

          // 如果没有 tool_calls，说明是最终回复
          if (step.content && !step.toolCalls) {
            this.addItem(thread, {
              id: randomUUID(),
              type: 'assistant_message',
              status: 'completed',
              content: step.content,
              startedAt: Date.now(),
              completedAt: Date.now(),
            })
          }
        },
      })
    } catch (err: any) {
      turn.status = 'failed'
      turn.completedAt = Date.now()
      this.addItem(thread, {
        id: randomUUID(),
        type: 'assistant_message',
        status: 'completed',
        content: `错误: ${err.message}`,
        isError: true,
        startedAt: Date.now(),
        completedAt: Date.now(),
      })
      this.emit({ type: 'turn/completed', turn, thread })
      await this.store.save(thread)
      throw err
    }

    // 5. 完成 Turn
    turn.status = options?.signal?.aborted ? 'interrupted' : 'completed'
    turn.completedAt = Date.now()

    thread.status = 'idle'
    thread.updatedAt = Date.now()
    this.emit({ type: 'turn/completed', turn, thread })
    await this.store.save(thread)

    return {
      content: agentResult.content,
      turn,
      iterations: agentResult.iterations,
      totalTokens: agentResult.totalTokens,
      cancelled: agentResult.cancelled,
    }
  }

  /** 添加 Item 到 Thread，并 emit 事件 */
  private addItem(thread: Thread, item: Item): Item {
    // 先发 started
    item.status = 'started'
    this.emit({ type: 'item/started', item, thread })

    // 完成
    item.status = 'completed'
    if (!item.completedAt) item.completedAt = Date.now()
    thread.items.push(item)
    thread.updatedAt = Date.now()

    // 发 completed
    this.emit({ type: 'item/completed', item, thread })

    return item
  }

  /** 从 Thread 的 Items 重建对话历史（给 Agent Loop 用） */
  private buildMessages(thread: Thread): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = []

    for (const item of thread.items) {
      switch (item.type) {
        case 'user_message':
          messages.push({ role: 'user', content: item.content })
          break
        case 'assistant_message':
          messages.push({ role: 'assistant', content: item.content })
          break
        case 'tool_call':
          // tool_call 的 content 是 arguments JSON
          messages.push({ role: 'assistant', content: `[调用工具 ${item.toolName}: ${item.content}]` })
          break
        case 'tool_result':
          messages.push({ role: 'user', content: `[工具 ${item.toolName} 结果: ${item.content}]` })
          break
      }
    }

    return messages
  }
}
