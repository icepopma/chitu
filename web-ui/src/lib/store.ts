import { create } from 'zustand'
import type { Item, ThreadSummary, TurnStatus, ApprovalRequest, PlanStep, User } from '../types'

interface AppState {
  // 连接
  connected: boolean
  initialized: boolean

  // 认证
  user: User | null
  token: string | null
  isAuthenticated: boolean

  // 线程
  threads: ThreadSummary[]
  currentThreadId: string | null

  // 消息
  items: Item[]

  // Turn
  turnStatus: TurnStatus | 'idle'

  // 审批
  pendingApproval: ApprovalRequest | null

  // 计划
  currentPlan: PlanStep[] | null

  // Actions
  setConnected: (v: boolean) => void
  setInitialized: (v: boolean) => void
  setThreads: (threads: ThreadSummary[]) => void
  addThread: (thread: ThreadSummary) => void
  selectThread: (id: string | null) => void
  removeThread: (id: string) => void
  updateThreadTitle: (id: string, title: string) => void
  setItems: (items: Item[]) => void
  addItem: (item: Item) => void
  updateItem: (itemId: string, update: Partial<Item>) => void
  appendItemContent: (itemId: string, delta: string) => void
  clearItems: () => void
  setTurnStatus: (status: TurnStatus | 'idle') => void
  setPendingApproval: (req: ApprovalRequest | null) => void
  setCurrentPlan: (plan: PlanStep[] | null) => void

  // Auth actions
  setUser: (user: User | null) => void
  setToken: (token: string | null) => void
  logout: () => void
}

export const useAppStore = create<AppState>()((set) => ({
  connected: false,
  initialized: false,
  user: null,
  token: null,
  isAuthenticated: false,
  threads: [],
  currentThreadId: null,
  items: [],
  turnStatus: 'idle',
  pendingApproval: null,
  currentPlan: null,

  setConnected: (v) => set({ connected: v }),
  setInitialized: (v) => set({ initialized: v }),
  setThreads: (threads) => set({ threads }),
  addThread: (thread) => set((s) => {
    // 去重：避免 RPC 响应和通知重复添加同一个线程
    if (s.threads.some(t => t.id === thread.id)) return {}
    return { threads: [thread, ...s.threads] }
  }),
  selectThread: (id) => set({ currentThreadId: id, items: [], currentPlan: null }),
  removeThread: (id) => set((s) => ({
    threads: s.threads.filter((t) => t.id !== id),
    currentThreadId: s.currentThreadId === id ? null : s.currentThreadId,
  })),
  updateThreadTitle: (id, title) => set((s) => ({
    threads: s.threads.map((t) => t.id === id ? { ...t, title } : t),
  })),
  setItems: (items) => set({ items }),
  addItem: (item) => set((s) => ({ items: [...s.items, item] })),
  updateItem: (itemId, update) => set((s) => ({
    items: s.items.map((i) => i.id === itemId ? { ...i, ...update } : i),
  })),
  appendItemContent: (itemId, delta) => set((s) => {
    const idx = s.items.findIndex(i => i.id === itemId)
    if (idx === -1) return {}
    const newItems = [...s.items]
    newItems[idx] = { ...newItems[idx], content: newItems[idx].content + delta }
    return { items: newItems }
  }),
  clearItems: () => set({ items: [], currentPlan: null }),
  setTurnStatus: (status) => set({ turnStatus: status }),
  setPendingApproval: (req) => set({ pendingApproval: req }),
  setCurrentPlan: (plan) => set({ currentPlan: plan }),

  setUser: (user) => {
    if (user && user.id === 'guest') {
      localStorage.setItem('chitu_guest', JSON.stringify(user))
    } else {
      localStorage.removeItem('chitu_guest')
    }
    set({ user, isAuthenticated: !!user })
  },
  setToken: (token) => {
    if (token) {
      localStorage.setItem('chitu_token', token)
    } else {
      localStorage.removeItem('chitu_token')
    }
    set({ token })
  },
  logout: () => {
    localStorage.removeItem('chitu_token')
    set({ user: null, token: null, isAuthenticated: false })
  },
}))
