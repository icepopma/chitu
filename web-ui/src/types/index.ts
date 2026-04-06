/**
 * 前端类型定义 — 对齐 Chitu 后端 types.ts
 */

export type ItemType = 'user_message' | 'assistant_message' | 'tool_call' | 'tool_result'
export type ItemStatus = 'started' | 'completed'
export type TurnStatus = 'in_progress' | 'completed' | 'interrupted' | 'failed'
export type ThreadStatus = 'created' | 'active' | 'idle' | 'archived'

export interface Item {
  id: string
  type: ItemType
  status: ItemStatus
  content: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolCallId?: string
  isError?: boolean
  startedAt: number
  completedAt?: number
}

export interface Turn {
  id: string
  threadId: string
  status: TurnStatus
  startedAt: number
  completedAt?: number
}

export interface Thread {
  id: string
  title: string
  status: ThreadStatus
  items: Item[]
  createdAt: number
  updatedAt: number
}

export interface ThreadSummary {
  id: string
  title: string
  updatedAt: number
}

/** JSON-RPC 通知的 params 中的 item（可能只有部分字段） */
export interface PartialItem {
  id: string
  type?: ItemType
  status?: ItemStatus
  content?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolCallId?: string
  isError?: boolean
  startedAt?: number
  completedAt?: number
}

/** 审批请求 */
export interface ApprovalRequest {
  id: string
  toolName: string
  command: string
  riskLevel: 'read' | 'write' | 'dangerous'
  threadId: string
}
