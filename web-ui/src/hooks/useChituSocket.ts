/**
 * useChituSocket — WebSocket JSON-RPC 客户端（单例）
 *
 * 对齐 Codex App Server 协议
 * 单例模式：多个组件共享同一个 WebSocket 连接
 *
 * StrictMode 安全：
 * - 连接是模块级单例，effect 只负责触发首次连接
 * - 不在 cleanup 里 close/断开 — 连接生命周期独立于 React 组件
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../lib/store'
import type { Item } from '../types'

const SERVER_URL = 'ws://localhost:8080'

// ===== 单例 WebSocket 管理 =====

let wsInstance: WebSocket | null = null
let rpcId = 0
const pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
let notificationHandler: ((method: string, params: any) => void) | null = null
let connectedCallbacks = new Set<(v: boolean) => void>()
let initializedCallbacks = new Set<(v: boolean) => void>()

function sendRequest<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!wsInstance || wsInstance.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket 未连接'))
      return
    }
    const id = ++rpcId
    pendingRequests.set(id, { resolve, reject })
    wsInstance.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }))
  })
}

/** 确保 WebSocket 已连接（幂等，重复调用安全） */
function ensureConnected(url: string) {
  // 已连接或正在连接 → 不做任何事
  if (wsInstance?.readyState === WebSocket.OPEN) return
  if (wsInstance?.readyState === WebSocket.CONNECTING) return

  const ws = new WebSocket(url)
  wsInstance = ws

  ws.onopen = async () => {
    connectedCallbacks.forEach(cb => cb(true))
    try {
      await sendRequest('initialize', {
        protocolVersion: '1.0.0',
        clientInfo: { name: 'chitu-web', version: '0.1.0' },
      })
      initializedCallbacks.forEach(cb => cb(true))

      const result = await sendRequest<{ threads: any[] }>('thread/list')
      if (result?.threads) {
        const { setThreads } = useAppStore.getState()
        setThreads(result.threads.map((t: any) => ({ id: t.id, title: t.title || '新对话', updatedAt: t.updatedAt || 0 })))
      }
    } catch (err) {
      console.error('[ws] 初始化失败:', err)
    }
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.id !== undefined) {
        const pending = pendingRequests.get(msg.id)
        if (pending) {
          pendingRequests.delete(msg.id)
          if (msg.error) pending.reject(new Error(msg.error.message || 'RPC Error'))
          else pending.resolve(msg.result)
        }
      }
      if (msg.method && notificationHandler) {
        notificationHandler(msg.method, msg.params)
      }
    } catch (err) {
      console.error('[ws] 解析消息失败:', err)
    }
  }

  ws.onclose = () => {
    connectedCallbacks.forEach(cb => cb(false))
    initializedCallbacks.forEach(cb => cb(false))
    wsInstance = null
  }

  ws.onerror = () => {
    console.error('[ws] 连接错误')
  }
}

// ===== React Hook =====

export function useChituSocket(options?: { url?: string }) {
  const url = options?.url || SERVER_URL
  const [connected, setConnected] = useState(wsInstance?.readyState === WebSocket.OPEN)
  const [initialized, setInitialized] = useState(false)

  // 注册状态回调（cleanup 只移除回调，不断开连接）
  useEffect(() => {
    connectedCallbacks.add(setConnected)
    initializedCallbacks.add(setInitialized)
    return () => {
      connectedCallbacks.delete(setConnected)
      initializedCallbacks.delete(setInitialized)
    }
  }, [])

  const {
    addThread, selectThread, clearItems, setTurnStatus,
    addItem, updateItem, setItems,
    setPendingApproval, updateThreadTitle,
    currentThreadId, threads,
  } = useAppStore()

  const currentThreadIdRef = useRef(currentThreadId)
  useEffect(() => { currentThreadIdRef.current = currentThreadId }, [currentThreadId])

  // 设置通知处理器
  useEffect(() => {
    notificationHandler = (method: string, params: any) => {
      switch (method) {
        case 'thread/started':
          if (params?.thread) {
            addThread({ id: params.thread.id, title: params.thread.title || '新对话', updatedAt: Date.now() })
          }
          break
        case 'turn/started':
          setTurnStatus('in_progress')
          break
        case 'item/started':
          if (params?.item) addItem(params.item as Item)
          break
        case 'item/completed':
          if (params?.item) updateItem((params.item as Item).id, params.item as Item)
          break
        case 'turn/completed':
          if (params?.turn) setTurnStatus(params.turn.status || 'completed')
          break
        case 'approval/requested':
          if (params) {
            setPendingApproval({
              id: params.id,
              toolName: params.toolName || 'exec',
              command: params.command || '',
              riskLevel: params.riskLevel || 'write',
              threadId: params.threadId || '',
            })
          }
          break
      }
    }
  }, [addThread, setTurnStatus, addItem, updateItem])

  const connect = useCallback(() => ensureConnected(url), [url])

  const createThread = useCallback(async (title?: string) => {
    const result = await sendRequest<{ thread: any }>('thread/create', { title })
    if (result?.thread) {
      selectThread(result.thread.id)
      clearItems()
      return result.thread
    }
  }, [selectThread, clearItems])

  const resumeThread = useCallback(async (threadId: string) => {
    const result = await sendRequest<{ thread: any }>('thread/resume', { threadId })
    if (result?.thread) {
      selectThread(threadId)
      if (result.thread.items) setItems(result.thread.items)
      return result.thread
    }
  }, [selectThread, setItems])

  const sendMessage = useCallback(async (message: string) => {
    const threadId = currentThreadIdRef.current
    if (!threadId) throw new Error('没有选中的线程')

    // 首次发消息时，用消息内容更新线程标题
    const thread = threads.find((t) => t.id === threadId)
    if (thread && thread.title === '新对话') {
      const title = message.length > 30 ? message.slice(0, 30) + '...' : message
      updateThreadTitle(threadId, title)
    }

    clearItems()
    setTurnStatus('in_progress')
    await sendRequest('turn/start', { threadId, message })
  }, [clearItems, setTurnStatus, updateThreadTitle, threads])

  const interruptTurn = useCallback(async () => {
    const threadId = currentThreadIdRef.current
    if (!threadId) return
    await sendRequest('turn/interrupt', { threadId })
    setTurnStatus('idle')
  }, [setTurnStatus])

  /** 响应审批请求 */
  const respondApproval = useCallback(async (approvalId: string, approved: boolean) => {
    await sendRequest('approval/respond', { id: approvalId, approved })
    setPendingApproval(null)
  }, [setPendingApproval])

  // 触发连接（幂等，StrictMode 调两次也安全）
  useEffect(() => {
    connect()
  }, [connect])

  return { connect, createThread, resumeThread, sendMessage, interruptTurn, respondApproval, connected, initialized }
}
