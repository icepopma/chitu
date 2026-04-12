/**
 * 核心类型定义
 *
 * 来源：Codex App Server 文章第 3 课的对话原语
 *
 * Thread = 完整的对话（多轮）
 * Turn = 一轮对话（多步任务）
 * Item = 每一步操作
 */

// ===== Thread =====

export type ThreadStatus = 'created' | 'active' | 'idle' | 'archived'

export interface Thread {
  id: string
  title: string
  status: ThreadStatus
  items: Item[]
  currentPlan?: PlanStep[]
  createdAt: number
  updatedAt: number
}

// ===== Turn =====

export type TurnStatus = 'in_progress' | 'completed' | 'interrupted' | 'failed'

export interface Turn {
  id: string
  threadId: string
  status: TurnStatus
  startedAt: number
  completedAt?: number
}

// ===== Item =====

export type ItemType =
  | 'user_message'      // 用户发的消息
  | 'assistant_message' // Agent 回复
  | 'tool_call'        // Agent 调用工具
  | 'tool_result'      // 工具执行结果

export type ItemStatus = 'started' | 'completed'

export interface Item {
  id: string
  type: ItemType
  status: ItemStatus
  content: string
  // tool 相关
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolCallId?: string
  isError?: boolean
  exitCode?: number    // 工具退出码（0=成功，非0=失败）
  // 时间戳
  startedAt: number
  completedAt?: number
}

// ===== Plan（对齐 Codex update_plan 工具） =====

export type StepStatus = 'pending' | 'in_progress' | 'completed'

export interface PlanStep {
  step: string
  status: StepStatus
}

export interface UpdatePlanArgs {
  explanation?: string
  plan: PlanStep[]
}

// ===== 事件（对齐 Codex App Server 协议） =====

export type AppEvent =
  | { type: 'thread/started'; thread: Thread }
  | { type: 'turn/started'; turn: Turn; thread: Thread }
  | { type: 'turn/completed'; turn: Turn; thread: Thread }
  | { type: 'item/started'; item: Item; thread: Thread }
  | { type: 'item/completed'; item: Item; thread: Thread }
  | { type: 'item/delta'; itemId: string; delta: string; thread: Thread }
  | { type: 'approval/requested'; id: string; command: string; riskLevel: string; thread: Thread }
  | { type: 'plan/updated'; plan: PlanStep[]; explanation?: string; thread: Thread }

/** 事件回调 —— 未来的 Message Processor 会监听这个 */
export type EventHandler = (event: AppEvent) => void
