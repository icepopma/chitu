/**
 * Agent Spawn — 子 Agent 派发系统
 *
 * 参考 Codex codex-rs/core/src/spawn.rs 的设计：
 * - 每个子任务创建独立的 Agent Loop 实例
 * - 深度限制（最多 3 层嵌套）防止失控
 * - 子 Agent 通过回调与父 Agent 通信
 * - 共享父 Thread 的文件系统但使用独立的上下文窗口
 *
 * 学习重点：
 * - spawn 模式：主 Agent 将复杂任务拆分给子 Agent 并行/串行执行
 * - 深度限制：防止递归 spawn 导致资源耗尽
 * - AsyncMessageQueue：子 Agent 与父 Agent 间的异步消息通信
 * - 子 Agent 拥有独立的 Agent Loop 实例和上下文
 */

import { randomUUID } from 'crypto'
import type { Tool, ToolResult } from '../tools/base.js'
import { runAgentLoop, buildSystemPrompt } from './loop.js'
import { LLMClient } from '../llm/client.js'
import { createToolRegistry } from '../tools/index.js'

// ===== 常量 =====

/** 最大嵌套深度：0=root, 1=子Agent, 2=孙Agent，不可再深 */
export const MAX_SPAWN_DEPTH = 2

// ===== 类型定义 =====

/** 子 Agent 任务描述 */
export interface SubAgentTask {
  /** 任务唯一 ID */
  id: string
  /** 任务描述（给子 Agent 的指令） */
  description: string
  /** 父 Agent ID */
  parentAgentId: string
  /** 当前嵌套深度 */
  depth: number
  /** 创建时间 */
  createdAt: number
}

/** 子 Agent 执行结果 */
export interface SubAgentResult {
  /** 对应的任务 ID */
  taskId: string
  /** 执行结果文本 */
  content: string
  /** 执行时长（毫秒） */
  durationMs: number
  /** Token 消耗 */
  totalTokens: number
  /** 循环次数 */
  iterations: number
  /** 是否成功 */
  success: boolean
  /** 错误信息（如果失败） */
  error?: string
}

/** AgentSpawner 配置 */
export interface SpawnerConfig {
  /** 最大嵌套深度（默认 MAX_SPAWN_DEPTH） */
  maxDepth: number
}

/** AgentSpawner 回调 */
export interface SpawnerCallbacks {
  /** 子 Agent 开始执行时回调 */
  onSubAgentStarted?: (task: SubAgentTask) => void
  /** 子 Agent 执行完成时回调 */
  onSubAgentCompleted?: (result: SubAgentResult) => void
}

/** 异步消息队列 — Agent 间通信 */
export class AsyncMessageQueue<T = string> {
  private queue: T[] = []
  private waiting: Array<(value: T) => void> = []
  private closed = false

  /** 发送消息到队列 */
  send(message: T): void {
    if (this.closed) return
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!
      resolve(message)
    } else {
      this.queue.push(message)
    }
  }

  /** 接收一条消息（异步等待） */
  receive(): Promise<T> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift()!)
    }
    if (this.closed) {
      return Promise.reject(new Error('Message queue closed'))
    }
    return new Promise<T>((resolve) => {
      this.waiting.push(resolve)
    })
  }

  /** 关闭队列，所有等待中的 receive 会收到 rejection */
  close(): void {
    this.closed = true
    for (const waiter of this.waiting) {
      // 不会 resolve，队列关闭后不再接收
    }
    this.waiting = []
  }

  /** 当前队列中的消息数量 */
  get length(): number {
    return this.queue.length
  }
}

// ===== AgentSpawner =====

/**
 * 子 Agent 管理器
 *
 * 负责：
 * 1. 管理活跃的子 Agent 列表
 * 2. 检查深度限制
 * 3. 创建独立的 Agent Loop 实例
 * 4. 收集子 Agent 的执行结果
 */
export class AgentSpawner {
  private agentId: string
  private config: SpawnerConfig
  private callbacks: SpawnerCallbacks
  /** 活跃的子 Agent 任务 */
  private activeTasks = new Map<string, SubAgentTask>()
  /** 子 Agent 到父 Agent 的消息队列 */
  private messageQueues = new Map<string, AsyncMessageQueue<string>>()

  constructor(agentId: string, config: SpawnerConfig, callbacks: SpawnerCallbacks) {
    this.agentId = agentId
    this.config = config
    this.callbacks = callbacks
  }

  /**
   * 派发一个子 Agent 执行任务
   *
   * 流程：
   * 1. 检查深度限制
   * 2. 创建子 Agent 的工具集（受深度限制）
   * 3. 启动独立的 Agent Loop
   * 4. 收集结果并通过回调通知父 Agent
   */
  async spawn(taskDescription: string, currentDepth: number): Promise<SubAgentResult> {
    // 深度检查
    if (currentDepth >= this.config.maxDepth) {
      return {
        taskId: '',
        content: `无法派发子 Agent：已达到最大深度限制 (${this.config.maxDepth} 层)`,
        durationMs: 0,
        totalTokens: 0,
        iterations: 0,
        success: false,
        error: 'MAX_DEPTH_EXCEEDED',
      }
    }

    // 创建任务
    const task: SubAgentTask = {
      id: randomUUID(),
      description: taskDescription,
      parentAgentId: this.agentId,
      depth: currentDepth + 1,
      createdAt: Date.now(),
    }
    this.activeTasks.set(task.id, task)
    this.callbacks.onSubAgentStarted?.(task)

    // 为子 Agent 创建消息队列
    const queue = new AsyncMessageQueue<string>()
    this.messageQueues.set(task.id, queue)

    const startTime = Date.now()

    try {
      // 创建子 Agent 的工具集
      const allTools = createToolRegistry().list()
      const childTools = this.buildChildTools(allTools, task.depth)

      // 创建子 Agent 专用的系统提示
      const childSystemPrompt = this.buildChildSystemPrompt(task.depth)

      // 创建独立的 LLM Client
      const client = new LLMClient()

      // 运行独立的 Agent Loop
      const result = await runAgentLoop(taskDescription, {
        client,
        tools: childTools,
        systemPrompt: childSystemPrompt,
        maxIterations: 30, // 子 Agent 循环次数限制更严格
      })

      const durationMs = Date.now() - startTime
      const subResult: SubAgentResult = {
        taskId: task.id,
        content: result.content,
        durationMs,
        totalTokens: result.totalTokens,
        iterations: result.iterations,
        success: !result.cancelled,
      }

      this.callbacks.onSubAgentCompleted?.(subResult)
      return subResult
    } catch (err: any) {
      const durationMs = Date.now() - startTime
      const subResult: SubAgentResult = {
        taskId: task.id,
        content: `子 Agent 执行出错: ${err.message}`,
        durationMs,
        totalTokens: 0,
        iterations: 0,
        success: false,
        error: err.message,
      }
      this.callbacks.onSubAgentCompleted?.(subResult)
      return subResult
    } finally {
      this.activeTasks.delete(task.id)
      queue.close()
      this.messageQueues.delete(task.id)
    }
  }

  /** 获取活跃的子 Agent 数量 */
  get activeCount(): number {
    return this.activeTasks.size
  }

  /** 获取指定任务的消息队列 */
  getMessageQueue(taskId: string): AsyncMessageQueue<string> | undefined {
    return this.messageQueues.get(taskId)
  }

  /**
   * 构建子 Agent 的工具集
   *
   * - 深度 < MAX_SPAWN_DEPTH：包含 spawn 工具（可以继续派发）
   * - 深度 = MAX_SPAWN_DEPTH：不包含 spawn 工具（不能再派发）
   */
  private buildChildTools(baseTools: Tool[], depth: number): Tool[] {
    if (depth >= this.config.maxDepth) {
      // 已达最大深度，不能继续 spawn
      return baseTools
    }

    // 未达最大深度，添加 spawn 工具
    const childSpawner = new AgentSpawner(
      `child-agent-${depth}`,
      this.config,
      this.callbacks,
    )
    const spawnTool = createSpawnTool(childSpawner, `child-agent-${depth}`, '', depth)
    return [...baseTools, spawnTool]
  }

  /**
   * 构建子 Agent 专用系统提示
   *
   * 在标准系统提示基础上增加子 Agent 角色说明
   */
  private buildChildSystemPrompt(depth: number): string {
    const basePrompt = buildSystemPrompt()
    const depthInfo = depth >= this.config.maxDepth
      ? '你是最后一级子 Agent，不能再派发子任务。请直接完成任务。'
      : `你是第 ${depth} 级子 Agent，如需处理子任务可以派发下一级子 Agent（当前深度: ${depth}/${this.config.maxDepth}）。`

    return `${basePrompt}\n\n# 子 Agent 角色\n你是被父 Agent 派发的子 Agent。${depthInfo}\n- 你拥有独立的上下文窗口，专注于完成被分配的任务\n- 完成后直接返回结果，不需要做额外的说明\n- 你的工作目录与父 Agent 相同\n`
  }
}

// ===== Spawn Tool =====

/**
 * 创建 agent_spawn 工具
 *
 * 这个工具让 Agent 能派发子 Agent 来处理子任务。
 * 工具会检查深度限制，超限时返回错误。
 */
export function createSpawnTool(
  spawner: AgentSpawner,
  agentId: string,
  threadId: string,
  currentDepth: number,
): Tool {
  return {
    name: 'agent_spawn',
    description:
      '派发一个子 Agent 来处理子任务。子 Agent 拥有独立的 Agent Loop 实例和上下文窗口，' +
      '但共享同一工作目录。子 Agent 执行完后返回结果。' +
      '适用于：需要并行处理的独立子任务、需要隔离上下文避免干扰的操作。' +
      `当前深度 ${currentDepth}，最大允许深度 ${MAX_SPAWN_DEPTH}。`,
    parameters: {
      type: 'object',
      properties: {
        task_description: {
          type: 'string',
          description: '子 Agent 的任务描述。需要清晰、具体，让子 Agent 能独立完成。',
        },
      },
      required: ['task_description'],
    },

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const taskDescription = args.task_description as string
      if (!taskDescription) {
        return {
          content: '错误：缺少 task_description 参数',
          isError: true,
          exitCode: 1,
        }
      }

      if (currentDepth >= MAX_SPAWN_DEPTH) {
        return {
          content: `无法派发子 Agent：已达到最大深度限制 (${MAX_SPAWN_DEPTH} 层)。请直接完成当前任务。`,
          isError: true,
          exitCode: 1,
        }
      }

      const result = await spawner.spawn(taskDescription, currentDepth)

      if (!result.success) {
        return {
          content: `子 Agent 执行失败: ${result.error || result.content}\n耗时: ${result.durationMs}ms`,
          isError: true,
          exitCode: 1,
        }
      }

      return {
        content: `子 Agent 完成任务:\n${result.content}\n---\n耗时: ${result.durationMs}ms | Token: ${result.totalTokens} | 循环: ${result.iterations}次`,
        isError: false,
        exitCode: 0,
      }
    },
  }
}
