import { create } from 'zustand'
import type { Item, ThreadSummary, TurnStatus } from '../types'

interface AppState {
  // 连接
  connected: boolean
  initialized: boolean

  // 线程
  threads: ThreadSummary[]
  currentThreadId: string | null

  // 消息
  items: Item[]

  // Turn
  turnStatus: TurnStatus | 'idle'

  // Actions
  setConnected: (v: boolean) => void
  setInitialized: (v: boolean) => void
  setThreads: (threads: ThreadSummary[]) => void
  addThread: (thread: ThreadSummary) => void
  selectThread: (id: string | null) => void
  setItems: (items: Item[]) => void
  addItem: (item: Item) => void
  updateItem: (itemId: string, update: Partial<Item>) => void
  clearItems: () => void
  setTurnStatus: (status: TurnStatus | 'idle') => void
}

export const useAppStore = create<AppState>()((set) => ({
  connected: false,
  initialized: false,
  threads: [],
  currentThreadId: null,
  items: [],
  turnStatus: 'idle',

  setConnected: (v) => set({ connected: v }),
  setInitialized: (v) => set({ initialized: v }),
  setThreads: (threads) => set({ threads }),
  addThread: (thread) => set((s) => ({ threads: [thread, ...s.threads] })),
  selectThread: (id) => set({ currentThreadId: id, items: [] }),
  setItems: (items) => set({ items }),
  addItem: (item) => set((s) => ({ items: [...s.items, item] })),
  updateItem: (itemId, update) => set((s) => ({
    items: s.items.map((i) => i.id === itemId ? { ...i, ...update } : i),
  })),
  clearItems: () => set({ items: [] }),
  setTurnStatus: (status) => set({ turnStatus: status }),
}))
