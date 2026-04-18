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
import type { Thread, Turn, Item, AppEvent, EventHandler, PlanStep } from '../types.js'
import { ThreadStore } from './store.js'
import { RolloutRecorder } from '../rollout/recorder.js'
import { runAgentLoop, buildSystemPrompt } from '../agent/loop.js'
import type { AgentResult } from '../agent/loop.js'
import { LLMClient } from '../llm/client.js'
import { createToolRegistry } from '../tools/index.js'
import { captureEnvSnapshot, diffEnvSnapshots, type EnvSnapshot, type EnvDiff } from '../utils/env-diff.js'
import { MemoryExtractor } from '../memories/extractor.js'
import { HookDispatcher } from '../hooks/dispatcher.js'

/** 服务器运行状态 */
export interface ServerStatus {
  uptime: number
  startedAt: number
  totalThreads: number
  totalTurns: number
  activeTurns: number
  totalTokens: number
  totalIterations: number
}

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
  /** 审批回调 — 高风险命令需要用户确认时调用 */
  onApprovalNeeded?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>
  /** v14.4: Hook 分发器 */
  hookDispatcher?: HookDispatcher
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
  private recorder: RolloutRecorder
  private handler?: EventHandler
  /** 每个 thread 最后一次 turn 的环境快照（用于 13.9 回合间差异检测） */
  private envSnapshots = new Map<string, EnvSnapshot>()
  /** v14.4: Hook 分发器 */
  private hookDispatcher?: HookDispatcher
  /** v16: 运行状态追踪 */
  private startedAt = Date.now()
  private _totalTurns = 0
  private _totalTokens = 0
  private _totalIterations = 0

  constructor(dataDir?: string) {
    this.store = new ThreadStore(dataDir)
    this.recorder = new RolloutRecorder(dataDir ? `${dataDir}/../rollouts` : undefined)
  }

  /** 设置 Hook 分发器 */
  setHookDispatcher(dispatcher: HookDispatcher): void {
    this.hookDispatcher = dispatcher
  }

  /** 设置事件监听器（Message Processor 用这个接收事件） */
  onEvent(handler: EventHandler): void {
    this.handler = handler
  }

  /** 发射事件（delta 事件不写 JSONL，避免高频磁盘 I/O） */
  private emit(event: AppEvent): void {
    if (event.type !== 'item/delta') {
      const threadId = this.getThreadIdFromEvent(event)
      if (threadId) {
        this.recorder.record(threadId, event).catch(() => {})
      }
    }
    this.handler?.(event)
  }

  /** 从事件中提取 threadId */
  private getThreadIdFromEvent(event: AppEvent): string | undefined {
    switch (event.type) {
      case 'thread/started': return event.thread.id
      case 'turn/started': return event.thread.id
      case 'turn/completed': return event.thread.id
      case 'item/started': return event.thread.id
      case 'item/completed': return event.thread.id
      case 'approval/requested': return event.thread.id
      case 'plan/updated': return event.thread.id
    }
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

    // v14.4: session_start hook
    if (this.hookDispatcher) {
      this.hookDispatcher.dispatchSessionEvent('session_start', { threadId: thread.id }).catch(() => {})
    }

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
      this.envSnapshots.delete(threadId)

      // v14.4: session_end hook
      if (this.hookDispatcher) {
        await this.hookDispatcher.dispatchSessionEvent('session_end', { threadId })
      }
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

  /** 删除线程（同时删除事件记录和环境快照） */
  async deleteThread(threadId: string): Promise<void> {
    await this.store.delete(threadId)
    await this.recorder.delete(threadId)
    this.envSnapshots.delete(threadId)
  }

  /** 重命名线程 */
  async renameThread(threadId: string, title: string): Promise<void> {
    const thread = await this.store.load(threadId)
    if (thread) {
      thread.title = title
      thread.updatedAt = Date.now()
      await this.store.save(thread)
    }
  }

  /**
   * fork — 从现有线程派生新线程
   *
   * 对齐 Codex thread/fork：复制现有线程状态到新 ID
   * 新线程从原线程的当前状态开始，可以走不同的方向
   */
  async fork(threadId: string): Promise<Thread | undefined> {
    const source = await this.store.load(threadId)
    if (!source) return undefined

    const now = Date.now()
    const forked: Thread = {
      id: randomUUID(),
      title: `${source.title} (fork)`,
      status: 'created',
      items: [...source.items],
      createdAt: now,
      updatedAt: now,
    }
    await this.store.save(forked)
    this.emit({ type: 'thread/started', thread: forked })

    // v13.9: 复制环境快照到派生线程，保持差异检测连续性
    const sourceSnapshot = this.envSnapshots.get(threadId)
    if (sourceSnapshot) {
      this.envSnapshots.set(forked.id, { ...sourceSnapshot })
    }
    return forked
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

    // 2. 自动重命名：标题为默认值时用首条消息更新
    if (thread.title === '新对话' || thread.title === 'Untitled') {
      thread.title = userInput.length > 30 ? userInput.slice(0, 30) + '...' : userInput
    }

    // 记录 turn 开始前的 items 数量（用于记忆提取时只取当前 turn 的 items）
    const itemsBeforeTurn = thread.items.length

    // v14.4: user_prompt_submit hook — 可修改用户输入
    const dispatcher = options?.hookDispatcher ?? this.hookDispatcher
    let effectiveInput = userInput
    if (dispatcher) {
      const hookResult = await dispatcher.dispatchUserPromptSubmit({
        prompt: userInput,
        threadId,
      })
      if (hookResult.modifiedPrompt) {
        effectiveInput = hookResult.modifiedPrompt
      }
    }

    // 3. 添加 user_message Item（用可能被 hook 修改过的输入）
    const userItem = this.addItem(thread, {
      id: randomUUID(),
      type: 'user_message',
      status: 'completed',
      content: effectiveInput,
      startedAt: Date.now(),
      completedAt: Date.now(),
    })

    thread.status = 'active'

    // 3. 构建 Agent Loop 的对话历史
    const client = options?.client || new LLMClient()
    const tools = createToolRegistry().list()

    // 从已有 items 重建对话历史
    const messages = this.buildMessages(thread)

    // 3b. v13.9: 回合间环境差异检测
    const currentEnv = captureEnvSnapshot()
    let envDelta: EnvDiff | null | undefined = undefined
    const previousEnv = this.envSnapshots.get(threadId)
    if (previousEnv) {
      const diff = diffEnvSnapshots(previousEnv, currentEnv)
      envDelta = diff ?? null
    }
    this.envSnapshots.set(threadId, currentEnv)

    // 4. 运行 Agent Loop
    let agentResult: AgentResult

    let streamingItemId: string | null = null

    /** 完成流式消息，发射 item/completed 并存入 thread.items */
    const completeStreamingItem = (content: string, isError = false) => {
      if (!streamingItemId) return
      const item: Item = {
        id: streamingItemId,
        type: 'assistant_message',
        status: 'completed',
        content,
        isError: isError || undefined,
        startedAt: Date.now(),
        completedAt: Date.now(),
      }
      this.emit({ type: 'item/completed', item, thread })
      thread.items.push(item)
      thread.updatedAt = Date.now()
      streamingItemId = null
    }

    try {
      agentResult = await runAgentLoop(effectiveInput, {
        client,
        tools,
        systemPrompt: options?.systemPrompt || buildSystemPrompt(),
        maxIterations: options?.maxIterations || 50,
        signal: options?.signal,
        onApprovalNeeded: options?.onApprovalNeeded,
        hookDispatcher: dispatcher,
        envDelta,
        onStreamDelta: (itemId, delta) => {
          if (!streamingItemId) {
            streamingItemId = itemId
            this.emit({
              type: 'item/started',
              item: {
                id: itemId,
                type: 'assistant_message',
                status: 'started',
                content: '',
                startedAt: Date.now(),
              },
              thread,
            })
          }
          this.emit({ type: 'item/delta', itemId, delta, thread })
        },
        onStep: (step) => {
          if (step.toolCalls) {
            completeStreamingItem(step.content || '')

            for (const tc of step.toolCalls) {
              let toolArgs: Record<string, unknown> = {}
              try {
                toolArgs = JSON.parse(tc.function.arguments)
              } catch {
                // LLM 流式传输中 tool_call arguments 可能拼接不完整
              }

              this.addItem(thread, {
                id: randomUUID(),
                type: 'tool_call',
                status: 'completed',
                content: tc.function.arguments,
                toolName: tc.function.name,
                toolArgs,
                toolCallId: tc.id,
                startedAt: Date.now(),
                completedAt: Date.now(),
              })

              if (tc.function.name === 'update_plan' && Array.isArray(toolArgs.plan)) {
                const plan = toolArgs.plan as PlanStep[]
                const explanation = typeof toolArgs.explanation === 'string' ? toolArgs.explanation : undefined
                thread.currentPlan = plan
                this.emit({
                  type: 'plan/updated',
                  plan,
                  explanation,
                  thread,
                })
              }
            }
          }

          if (step.toolResults) {
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

          // 非流式路径（无 onStreamDelta）
          if (step.content && !step.toolCalls && !streamingItemId) {
            this.addItem(thread, {
              id: randomUUID(),
              type: 'assistant_message',
              status: 'completed',
              content: step.content,
              startedAt: Date.now(),
              completedAt: Date.now(),
            })
          }

          // 流式路径：最后一轮完成
          if (step.content && !step.toolCalls && streamingItemId) {
            completeStreamingItem(step.content)
          }
        },
      })
    } catch (err: any) {
      completeStreamingItem('', true)

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

    // v14.3: 记忆提取 — turn 成功完成后异步提取（不阻塞返回）
    // 只提取当前 turn 的 items，避免重复处理历史
    if (turn.status === 'completed' && !agentResult.cancelled) {
      const turnItems = thread.items.slice(itemsBeforeTurn)
      if (turnItems.length >= 2) {
        const extractor = new MemoryExtractor(client)
        extractor.extractFromItems(turnItems, threadId).catch(err => {
          console.warn('[memories] 提取失败（非致命）:', err.message)
        })
      }
    }

    // 更新运行状态
    this._totalTurns++
    this._totalTokens += agentResult.totalTokens
    this._totalIterations += agentResult.iterations

    return {
      content: agentResult.content,
      turn,
      iterations: agentResult.iterations,
      totalTokens: agentResult.totalTokens,
      cancelled: agentResult.cancelled,
    }
  }

  /** 获取服务器运行状态 */
  getStatus(): ServerStatus {
    return {
      uptime: Date.now() - this.startedAt,
      startedAt: this.startedAt,
      totalThreads: this._totalTurns > 0 ? 1 : 0,
      totalTurns: this._totalTurns,
      activeTurns: 0,
      totalTokens: this._totalTokens,
      totalIterations: this._totalIterations,
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
