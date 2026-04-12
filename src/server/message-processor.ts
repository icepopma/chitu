/**
 * Message Processor — JSON-RPC ↔ ThreadManager 翻译层
 *
 * Codex 文章第 4 篇的核心组件：
 * "Codex 消息处理器可将客户端 JSON-RPC 请求转换为 Codex 核心操作，
 *  监听 Codex 核心的内部事件流，然后将这些低级事件转换为
 *  一小组稳定的用户界面就绪型 JSON-RPC 通知。"
 *
 * 职责：
 * 1. 收到 JSON-RPC 请求 → 路由到 ThreadManager 方法
 * 2. 监听 ThreadManager AppEvent → 转成 JSON-RPC 通知 → 推给客户端
 * 3. 管理 initialize 握手状态
 * 4. Turn 异步执行（turn/start 立即返回，Agent Loop 后台跑）
 */

import type { WebSocket } from 'ws'
import type { AppEvent, Thread, Item, Turn } from '../types.js'
import { ThreadManager } from '../thread/manager.js'
import { classifyCommand } from '../tools/policy.js'
import {
  type JsonRpcRequest,
  createResponse,
  createError,
  createNotification,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
  NOT_INITIALIZED,
  INTERNAL_ERROR,
} from './json-rpc.js'

export class MessageProcessor {
  private manager: ThreadManager
  /** 所有已连接的客户端 */
  private clients = new Set<WebSocket>()
  /** 已握手的连接 */
  private initialized = new WeakSet<WebSocket>()
  /** 活跃的 Turn：threadId → AbortController */
  private activeTurns = new Map<string, AbortController>()
  /** 等待审批的请求：approvalId → { resolve, command, riskLevel } */
  private pendingApprovals = new Map<string, {
    resolve: (approved: boolean) => void
    command: string
    riskLevel: string
  }>()

  constructor(manager: ThreadManager) {
    this.manager = manager
    // 在构造时设置事件监听，所有事件广播给所有客户端
    this.manager.onEvent((event) => this.broadcastEvent(event))
  }

  /** 注册新客户端 */
  addClient(ws: WebSocket): void {
    this.clients.add(ws)
  }

  /** 移除客户端（断线不中断 Turn） */
  removeClient(ws: WebSocket): void {
    this.clients.delete(ws)
    this.initialized.delete(ws)
    // 注意：不断线不中断活跃的 Turn！
    // Codex: "在服务器上保留状态和进度，即使标签页消失，任务也会继续运行"
  }

  /** 处理收到的 JSON-RPC 消息 */
  async handleMessage(ws: WebSocket, request: JsonRpcRequest): Promise<void> {
    const { id, method, params } = request
    const reqId = id ?? 0

    // initialize 不需要先握手
    if (method === 'initialize') {
      return this.handleInitialize(ws, reqId)
    }

    // 其他方法必须先握手
    if (!this.initialized.has(ws)) {
      this.send(ws, createError(reqId, NOT_INITIALIZED, 'Not initialized. Call initialize first.'))
      return
    }

    try {
      switch (method) {
        case 'thread/create':
          return await this.handleThreadCreate(ws, reqId, params)
        case 'thread/list':
          return await this.handleThreadList(ws, reqId)
        case 'thread/resume':
          return await this.handleThreadResume(ws, reqId, params)
        case 'thread/archive':
          return await this.handleThreadArchive(ws, reqId, params)
        case 'thread/delete':
          return await this.handleThreadDelete(ws, reqId, params)
        case 'thread/rename':
          return await this.handleThreadRename(ws, reqId, params)
        case 'thread/fork':
          return await this.handleThreadFork(ws, reqId, params)
        case 'turn/start':
          return await this.handleTurnStart(ws, reqId, params)
        case 'turn/interrupt':
          return await this.handleTurnInterrupt(ws, reqId, params)
        case 'approval/respond':
          return await this.handleApprovalRespond(ws, reqId, params)
        default:
          this.send(ws, createError(reqId, METHOD_NOT_FOUND, `Method not found: ${method}`))
      }
    } catch (err: any) {
      this.send(ws, createError(reqId, INTERNAL_ERROR, err.message))
    }
  }

  // ===== 路由方法 =====

  private handleInitialize(ws: WebSocket, id: number | string): void {
    this.initialized.add(ws)
    this.send(ws, createResponse(id, {
      protocolVersion: '1.0.0',
      serverInfo: { name: 'chitu-app-server', version: '0.1.0' },
      capabilities: {},
    }))
  }

  private async handleThreadCreate(ws: WebSocket, id: number | string, params?: Record<string, unknown>): Promise<void> {
    const title = (params?.title as string) || undefined
    const thread = await this.manager.create(title)
    this.send(ws, createResponse(id, { thread }))
  }

  private async handleThreadList(ws: WebSocket, id: number | string): Promise<void> {
    const threads = await this.manager.listThreads()
    this.send(ws, createResponse(id, { threads }))
  }

  private async handleThreadResume(ws: WebSocket, id: number | string, params?: Record<string, unknown>): Promise<void> {
    const threadId = params?.threadId as string
    if (!threadId) {
      this.send(ws, createError(id, INVALID_PARAMS, 'Missing threadId'))
      return
    }
    const thread = await this.manager.resume(threadId)
    if (!thread) {
      this.send(ws, createError(id, INVALID_PARAMS, `Thread ${threadId} not found`))
      return
    }
    this.send(ws, createResponse(id, { thread }))
  }

  private async handleThreadArchive(ws: WebSocket, id: number | string, params?: Record<string, unknown>): Promise<void> {
    const threadId = params?.threadId as string
    if (!threadId) {
      this.send(ws, createError(id, INVALID_PARAMS, 'Missing threadId'))
      return
    }
    await this.manager.archive(threadId)
    this.send(ws, createResponse(id, {}))
  }

  private async handleThreadDelete(ws: WebSocket, id: number | string, params?: Record<string, unknown>): Promise<void> {
    const threadId = params?.threadId as string
    if (!threadId) {
      this.send(ws, createError(id, INVALID_PARAMS, 'Missing threadId'))
      return
    }
    await this.manager.deleteThread(threadId)
    this.send(ws, createResponse(id, {}))
  }

  private async handleThreadRename(ws: WebSocket, id: number | string, params?: Record<string, unknown>): Promise<void> {
    const threadId = params?.threadId as string
    const title = params?.title as string
    if (!threadId || !title) {
      this.send(ws, createError(id, INVALID_PARAMS, 'Missing threadId or title'))
      return
    }
    await this.manager.renameThread(threadId, title)
    this.send(ws, createResponse(id, {}))
  }

  private async handleThreadFork(ws: WebSocket, id: number | string, params?: Record<string, unknown>): Promise<void> {
    const threadId = params?.threadId as string
    if (!threadId) {
      this.send(ws, createError(id, INVALID_PARAMS, 'Missing threadId'))
      return
    }
    const forked = await this.manager.fork(threadId)
    if (!forked) {
      this.send(ws, createError(id, INVALID_PARAMS, `Thread ${threadId} not found`))
      return
    }
    this.send(ws, createResponse(id, { thread: forked }))
  }

  /**
   * turn/start — 核心方法
   *
   * 关键设计（对齐 Codex）：
   * 1. 立即返回响应（不等待 Agent Loop 完成）
   * 2. Agent Loop 在后台异步运行
   * 3. 事件通过 JSON-RPC 通知异步推送
   * 4. 客户端断线不影响 Turn 执行
   */
  private async handleTurnStart(ws: WebSocket, id: number | string, params?: Record<string, unknown>): Promise<void> {
    const threadId = params?.threadId as string
    const message = params?.message as string

    if (!threadId || !message) {
      this.send(ws, createError(id, INVALID_PARAMS, 'Missing threadId or message'))
      return
    }

    // 创建 AbortController，用于 turn/interrupt
    const controller = new AbortController()
    this.activeTurns.set(threadId, controller)

    // 立即返回响应（不等待 Turn 完成！）
    this.send(ws, createResponse(id, { threadId, status: 'started' }))

    // 后台运行 Agent Loop
    this.manager.runTurn(threadId, message, {
      signal: controller.signal,
      onApprovalNeeded: this.createApprovalCallback(threadId),
    }).catch((err) => {
      // runTurn 内部已处理错误（emit turn/completed with failed）
      // 这里只清理 AbortController
      console.error(`Turn failed for thread ${threadId}:`, err.message)
    }).finally(() => {
      this.activeTurns.delete(threadId)
    })
  }

  private async handleTurnInterrupt(ws: WebSocket, id: number | string, params?: Record<string, unknown>): Promise<void> {
    const threadId = params?.threadId as string
    if (!threadId) {
      this.send(ws, createError(id, INVALID_PARAMS, 'Missing threadId'))
      return
    }
    const controller = this.activeTurns.get(threadId)
    if (!controller) {
      this.send(ws, createError(id, INVALID_PARAMS, `No active turn for thread ${threadId}`))
      return
    }
    controller.abort()
    this.activeTurns.delete(threadId)
    this.send(ws, createResponse(id, { interrupted: true }))
  }

  /**
   * 创建审批回调（给 Agent Loop 用）
   *
   * 当 Agent 需要审批时：
   * 1. 生成唯一 approvalId
   * 2. 通过 JSON-RPC 通知推给前端
   * 3. 返回 Promise，等待前端通过 approval/respond 响应
   * 4. 30 秒超时自动拒绝
   */
  createApprovalCallback(threadId: string): (toolName: string, args: Record<string, unknown>) => Promise<boolean> {
    return async (toolName: string, args: Record<string, unknown>): Promise<boolean> => {
      const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const command = toolName === 'exec' ? (args.command as string) : JSON.stringify(args)
      const riskLevel = toolName === 'exec' ? classifyCommand(command) : 'write'

      // 广播审批通知给所有客户端
      const notifData = JSON.stringify(createNotification('approval/requested', {
        id: approvalId,
        toolName,
        command,
        riskLevel,
        threadId,
      }))
      for (const client of this.clients) {
        if (client.readyState === 1) client.send(notifData)
      }

      // 返回 Promise，等待前端响应
      return new Promise<boolean>((resolve) => {
        // 30 秒超时自动拒绝
        const timer = setTimeout(() => {
          this.pendingApprovals.delete(approvalId)
          resolve(false)
        }, 30_000)

        this.pendingApprovals.set(approvalId, {
          resolve: (approved: boolean) => {
            clearTimeout(timer)
            resolve(approved)
          },
          command,
          riskLevel,
        })
      })
    }
  }

  /** 处理 approval/respond — 前端回复审批请求 */
  private handleApprovalRespond(ws: WebSocket, id: number | string, params?: Record<string, unknown>): void {
    const approvalId = params?.id as string
    const approved = params?.approved as boolean

    if (!approvalId) {
      this.send(ws, createError(id, INVALID_PARAMS, 'Missing approval id'))
      return
    }

    const pending = this.pendingApprovals.get(approvalId)
    if (!pending) {
      this.send(ws, createError(id, INVALID_PARAMS, `No pending approval for id ${approvalId}`))
      return
    }

    this.pendingApprovals.delete(approvalId)
    pending.resolve(approved)
    this.send(ws, createResponse(id, { approved }))
  }

  // ===== 事件广播 =====

  /** 把 AppEvent 转成 JSON-RPC 通知，推给所有已连接的客户端 */
  private broadcastEvent(event: AppEvent): void {
    const notification = createNotification(event.type, eventToParams(event))
    const data = JSON.stringify(notification)
    for (const ws of this.clients) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(data)
      }
    }
  }

  /** 安全发送消息 */
  private send(ws: WebSocket, data: unknown): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data))
    }
  }
}

/** 把 AppEvent 转成 JSON-RPC 通知的 params */
function eventToParams(event: AppEvent): Record<string, unknown> {
  switch (event.type) {
    case 'thread/started':
      return { thread: event.thread }
    case 'turn/started':
      return { turn: event.turn, thread: event.thread }
    case 'turn/completed':
      return { turn: event.turn, thread: event.thread }
    case 'item/started':
      return { item: event.item }
    case 'item/completed':
      return { item: event.item }
    case 'item/delta':
      return { itemId: event.itemId, delta: event.delta }
    case 'approval/requested':
      return { id: event.id, command: event.command, riskLevel: event.riskLevel, thread: event.thread }
    case 'plan/updated':
      return { plan: event.plan, explanation: event.explanation }
  }
}
