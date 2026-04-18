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
        setThreads(result.threads.map((t: any) => ({
          id: t.id,
          title: t.title || '新对话',
          updatedAt: t.updatedAt || 0,
        })))
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
    addThread, removeThread, selectThread, clearItems, setTurnStatus,
    addItem, updateItem, appendItemContent, setItems, setThreads,
    setPendingApproval, updateThreadTitle, setCurrentPlan,
    currentThreadId,
  } = useAppStore()

  const currentThreadIdRef = useRef(currentThreadId)
  useEffect(() => { currentThreadIdRef.current = currentThreadId }, [currentThreadId])

  // 设置通知处理器（含 delta 批量缓冲）
  const deltaBuffer = useRef<Array<{ itemId: string; delta: string }>>([])
  const deltaFlushScheduled = useRef(false)
  const autoApproveRef = useRef(false)

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
          // 后端可能在此事件中更新了线程标题（自动重命名）
          if (params?.thread?.id && params.thread.title) {
            updateThreadTitle(params.thread.id, params.thread.title)
          }
          break
        case 'item/started':
          if (params?.item) addItem(params.item as Item)
          break
        case 'item/delta':
          if (params?.itemId && params?.delta) {
            // 用 rAF 批量更新，避免高频 delta 导致过度渲染
            deltaBuffer.current.push({ itemId: params.itemId, delta: params.delta })
            if (!deltaFlushScheduled.current) {
              deltaFlushScheduled.current = true
              requestAnimationFrame(() => {
                for (const { itemId, delta } of deltaBuffer.current) {
                  appendItemContent(itemId, delta)
                }
                deltaBuffer.current.length = 0
                deltaFlushScheduled.current = false
              })
            }
          }
          break
        case 'item/completed':
          if (params?.item) {
            const completedId = (params.item as Item).id
            // 清空该 item 的 pending delta，避免 rAF 追加到已完成内容
            deltaBuffer.current = deltaBuffer.current.filter(d => d.itemId !== completedId)
            updateItem(completedId, params.item as Item)
          }
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
        case 'plan/updated':
          if (params?.plan) {
            setCurrentPlan(params.plan)
          }
          break
      }
    }
  }, [addThread, setTurnStatus, addItem, updateItem, appendItemContent, removeThread])

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

  const sendMessage = useCallback(async (message: string, autoApprove?: boolean) => {
    const threadId = currentThreadIdRef.current
    if (!threadId) throw new Error('没有选中的线程')

    autoApproveRef.current = !!autoApprove
    clearItems()
    setTurnStatus('in_progress')
    await sendRequest('turn/start', { threadId, message, autoApprove })
  }, [clearItems, setTurnStatus])

  const deleteThread = useCallback(async (threadId: string) => {
    try {
      await sendRequest('thread/delete', { threadId })
      removeThread(threadId)
    } catch (err) {
      console.error('[ws] 删除线程失败:', err)
    }
  }, [removeThread])

  const forkThread = useCallback(async (threadId: string) => {
    const result = await sendRequest<{ thread: any }>('thread/fork', { threadId })
    if (result?.thread) {
      addThread({ id: result.thread.id, title: result.thread.title || '新对话', updatedAt: Date.now() })
      selectThread(result.thread.id)
      clearItems()
      return result.thread
    }
  }, [addThread, selectThread, clearItems])

  const interruptTurn = useCallback(async () => {
    autoApproveRef.current = false // 停止自主运行
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

  return { connect, createThread, deleteThread, forkThread, resumeThread, sendMessage, interruptTurn, respondApproval, connected, initialized }
}
