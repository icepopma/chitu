/**
 * Dashboard Analytics — 从 rollout JSONL 和 memories 提取统计数据
 *
 * M15: 增强监控面板
 * - 工具使用频率统计（从 rollout JSONL 提取）
 * - 每日活动统计（消息数/turn 数按天聚合）
 * - 记忆状态（条目数、按类别统计）
 * - Token 成本估算（按模型/按天）
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryStorage, type MemoryCategory } from '../memories/storage.js'

// === 类型定义 ===

export interface ToolUsageStat {
  name: string
  count: number
  lastUsed: number
}

export interface DailyActivity {
  date: string
  messages: number
  turns: number
  toolCalls: number
}

export interface MemoryStat {
  total: number
  byCategory: Record<string, number>
  recentItems: Array<{ category: string; content: string; createdAt: number }>
}

export interface TokenCostEstimate {
  totalTokens: number
  estimatedCostUsd: number
  byDay: Array<{ date: string; tokens: number; costUsd: number }>
}

export interface DashboardAnalytics {
  toolUsage: ToolUsageStat[]
  dailyActivity: DailyActivity[]
  memory: MemoryStat
  tokenCost: TokenCostEstimate
}

// === Token 成本估算（GLM-5 定价参考） ===

const COST_PER_1K_INPUT = 0.001   // $0.001 / 1K input tokens
const COST_PER_1K_OUTPUT = 0.002  // $0.002 / 1K output tokens
const AVG_INPUT_RATIO = 0.6       // 估算 input/output 比例

// === 分析函数 ===

/** 从 rollout JSONL 提取工具使用频率 */
export function extractToolUsage(dataDir: string): ToolUsageStat[] {
  const rolloutDir = join(dataDir, 'rollouts')
  if (!existsSync(rolloutDir)) return []

  const toolMap = new Map<string, { count: number; lastUsed: number }>()

  const files = readdirSync(rolloutDir).filter(f => f.endsWith('.jsonl'))
  for (const file of files) {
    const content = readFileSync(join(rolloutDir, file), 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const raw = JSON.parse(line)
        if (raw.type === 'item/completed' && raw.data?.item?.type === 'tool_call') {
          const toolName = raw.data.item.toolName || raw.data.item.content?.toolName
          if (toolName) {
            const existing = toolMap.get(toolName)
            const ts = raw.ts || 0
            toolMap.set(toolName, {
              count: (existing?.count || 0) + 1,
              lastUsed: Math.max(existing?.lastUsed || 0, ts),
            })
          }
        }
      } catch { /* skip */ }
    }
  }

  return Array.from(toolMap.entries())
    .map(([name, { count, lastUsed }]) => ({ name, count, lastUsed }))
    .sort((a, b) => b.count - a.count)
}

/** 从 rollout JSONL 提取每日活动统计 */
export function extractDailyActivity(dataDir: string): DailyActivity[] {
  const rolloutDir = join(dataDir, 'rollouts')
  if (!existsSync(rolloutDir)) return []

  const dayMap = new Map<string, { messages: number; turns: number; toolCalls: number }>()

  const files = readdirSync(rolloutDir).filter(f => f.endsWith('.jsonl'))
  for (const file of files) {
    const content = readFileSync(join(rolloutDir, file), 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const raw = JSON.parse(line)
        const ts = raw.ts || 0
        if (ts === 0) continue
        const date = new Date(ts).toISOString().slice(0, 10)
        const entry = dayMap.get(date) || { messages: 0, turns: 0, toolCalls: 0 }

        if (raw.type === 'item/completed') {
          const itemType = raw.data?.item?.type
          if (itemType === 'user_message' || itemType === 'assistant_message') {
            entry.messages++
          } else if (itemType === 'tool_call') {
            entry.toolCalls++
          }
        } else if (raw.type === 'turn/completed') {
          entry.turns++
        }

        dayMap.set(date, entry)
      } catch { /* skip */ }
    }
  }

  return Array.from(dayMap.entries())
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** 从 memories 读取记忆状态 */
export function extractMemoryStats(dataDir: string): MemoryStat {
  const memStorage = new MemoryStorage(dataDir)
  const memories = memStorage.load()
  const byCategory: Record<string, number> = {}
  const categories: MemoryCategory[] = ['preference', 'architecture', 'convention', 'failure', 'fact']

  for (const cat of categories) {
    const count = memories.filter(m => m.category === cat).length
    if (count > 0) byCategory[cat] = count
  }

  return {
    total: memories.length,
    byCategory,
    recentItems: memories.slice(-5).map(m => ({
      category: m.category,
      content: m.content.slice(0, 120) + (m.content.length > 120 ? '...' : ''),
      createdAt: m.createdAt,
    })),
  }
}

/** 从 rollout JSONL 估算 token 成本 */
export function extractTokenCost(dataDir: string): TokenCostEstimate {
  const rolloutDir = join(dataDir, 'rollouts')
  if (!existsSync(rolloutDir)) return { totalTokens: 0, estimatedCostUsd: 0, byDay: [] }

  let totalTokens = 0
  const dayMap = new Map<string, number>()

  const files = readdirSync(rolloutDir).filter(f => f.endsWith('.jsonl'))
  for (const file of files) {
    const content = readFileSync(join(rolloutDir, file), 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const raw = JSON.parse(line)
        // 从 assistant_message 的 content 长度估算 token
        if (raw.type === 'item/completed' && raw.data?.item?.type === 'assistant_message') {
          const text = raw.data.item.content || ''
          // 粗略估算：1 token ≈ 4 字符（中文约 2 字符）
          const estimatedTokens = Math.ceil(text.length / 3)
          totalTokens += estimatedTokens

          const ts = raw.ts || 0
          if (ts > 0) {
            const date = new Date(ts).toISOString().slice(0, 10)
            dayMap.set(date, (dayMap.get(date) || 0) + estimatedTokens)
          }
        }
      } catch { /* skip */ }
    }
  }

  const inputTokens = Math.round(totalTokens * AVG_INPUT_RATIO)
  const outputTokens = totalTokens - inputTokens
  const estimatedCostUsd = (inputTokens / 1000) * COST_PER_1K_INPUT + (outputTokens / 1000) * COST_PER_1K_OUTPUT

  const byDay = Array.from(dayMap.entries())
    .map(([date, tokens]) => {
      const dayInput = Math.round(tokens * AVG_INPUT_RATIO)
      const dayOutput = tokens - dayInput
      return {
        date,
        tokens,
        costUsd: Math.round(((dayInput / 1000) * COST_PER_1K_INPUT + (dayOutput / 1000) * COST_PER_1K_OUTPUT) * 10000) / 10000,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    totalTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
    byDay,
  }
}

/** 聚合所有 analytics 数据 */
export function buildAnalytics(dataDir: string): DashboardAnalytics {
  return {
    toolUsage: extractToolUsage(dataDir),
    dailyActivity: extractDailyActivity(dataDir),
    memory: extractMemoryStats(join(dataDir, 'memories')),
    tokenCost: extractTokenCost(dataDir),
  }
}
