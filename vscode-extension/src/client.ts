/**
 * JSON-RPC 2.0 WebSocket 客户端
 *
 * 与赤兔 App Server 通信的核心模块
 * 处理连接管理、请求/响应匹配、事件通知
 */

import WebSocket from 'ws'

/** JSON-RPC 请求 */
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number | string
  method: string
  params?: Record<string, unknown>
}

/** JSON-RPC 响应 */
interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** JSON-RPC 通知 */
interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

/** 事件回调 */
export type EventCallback = (method: string, params: Record<string, unknown>) => void

/** 连接状态变化回调 */
export type StatusCallback = (status: 'connected' | 'disconnected' | 'connecting') => void

export class ChituClient {
  private ws: WebSocket | null = null
  private serverUrl: string
  private token: string
  private requestId = 0
  private pendingRequests = new Map<number | string, {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
  }>()
  private eventCallbacks: EventCallback[] = []
  private statusCallbacks: StatusCallback[] = []
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private initialized = false

  constructor(serverUrl: string, token: string) {
    this.serverUrl = serverUrl
    this.token = token
  }

  /** 连接到 App Server */
  async connect(): Promise<void> {
    this.notifyStatus('connecting')

    return new Promise((resolve, reject) => {
      let url = this.serverUrl
      if (this.token) {
        url += `?token=${encodeURIComponent(this.token)}`
      }

      this.ws = new WebSocket(url)

      this.ws.on('open', async () => {
        this.notifyStatus('connected')
        // 发送 initialize 握手
        try {
          await this.sendRequest('initialize', {})
          this.initialized = true
          resolve()
        } catch (err) {
          reject(err)
        }
      })

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString())
      })

      this.ws.on('close', () => {
        this.notifyStatus('disconnected')
        this.initialized = false
        this.rejectAllPending('Connection closed')
        this.scheduleReconnect()
      })

      this.ws.on('error', (err: Error) => {
        reject(new Error(`WebSocket 连接失败: ${err.message}`))
      })
    })
  }

  /** 断开连接 */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
    this.initialized = false
  }

  /** 更新配置并重连 */
  async updateConfig(serverUrl: string, token: string): Promise<void> {
    this.serverUrl = serverUrl
    this.token = token
    this.disconnect()
    await this.connect()
  }

  /** 发送 JSON-RPC 请求并等待响应 */
  sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket 未连接'))
        return
      }

      const id = ++this.requestId
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        ...(params ? { params } : {}),
      }

      this.pendingRequests.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(request))

      // 30 秒超时
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`请求超时: ${method}`))
        }
      }, 30_000)
    })
  }

  /** 发送 JSON-RPC 通知（不等响应） */
  sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    }
    this.ws.send(JSON.stringify(notification))
  }

  /** 注册事件回调 */
  onEvent(callback: EventCallback): void {
    this.eventCallbacks.push(callback)
  }

  /** 注册状态变更回调 */
  onStatusChange(callback: StatusCallback): void {
    this.statusCallbacks.push(callback)
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.initialized
  }

  // ===== 内部方法 =====

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as JsonRpcResponse | JsonRpcNotification

      // 响应（有 id 字段）
      if ('id' in msg && msg.id !== null && msg.id !== undefined) {
        const pending = this.pendingRequests.get(msg.id)
        if (pending) {
          this.pendingRequests.delete(msg.id)
          if (msg.error) {
            pending.reject(new Error(msg.error.message))
          } else {
            pending.resolve(msg.result)
          }
        }
        return
      }

      // 通知（有 method 字段）
      if ('method' in msg && msg.method) {
        for (const cb of this.eventCallbacks) {
          cb(msg.method, msg.params || {})
        }
      }
    } catch {
      // 忽略解析错误
    }
  }

  private notifyStatus(status: 'connected' | 'disconnected' | 'connecting'): void {
    for (const cb of this.statusCallbacks) {
      cb(status)
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error(reason))
    }
    this.pendingRequests.clear()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect().catch(() => {
        // 重连失败，会再次 scheduleReconnect
      })
    }, 5000)
  }
}
