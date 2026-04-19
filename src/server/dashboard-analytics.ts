/**
 * Dashboard Analytics — 从 rollout JSONL 中提取统计数据
 *
 * 工具使用频率、每日活动统计、记忆状态、token 成本估算
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

interface DailyActivity {
  date: string
  messages: number
  turns: number
  toolCalls: number
}

interface ToolUsage {
  name: string
  count: number
  lastUsed: number
}

interface MemoryInfo {
  total: number
  byCategory: Record<string, number>
  recentItems: Array<{ category: string; content: string; createdAt: number }>
}

interface TokenCost {
  totalTokens: number
  estimatedCostUsd: number
  byDay: Array<{ date: string; tokens: number; costUsd: number }>
}

export interface AnalyticsData {
  toolUsage: ToolUsage[]
  dailyActivity: DailyActivity[]
  memory: MemoryInfo
  tokenCost: TokenCost
}

export function buildAnalytics(dataDir: string): AnalyticsData {
  const rolloutDir = join(dataDir, 'rollouts')
  const memoriesDir = join(dataDir, 'memories')

  const events = loadAllRolloutEvents(rolloutDir)

  return {
    toolUsage: aggregateToolUsage(events),
    dailyActivity: aggregateDailyActivity(events),
    memory: aggregateMemories(memoriesDir),
    tokenCost: aggregateTokenCost(events),
  }
}

type RawEvent = { type: string; ts: number; data: any }

function loadAllRolloutEvents(rolloutDir: string): RawEvent[] {
  if (!existsSync(rolloutDir)) return []
  const events: RawEvent[] = []
  const files = readdirSync(rolloutDir).filter(f => f.endsWith('.jsonl'))
  for (const file of files) {
    try {
      const content = readFileSync(join(rolloutDir, file), 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const raw = JSON.parse(line)
          events.push({ type: raw.type, ts: raw.ts || 0, data: raw.data })
        } catch { /* skip */ }
      }
    } catch { /* skip file */ }
  }
  return events
}

function aggregateDailyActivity(events: RawEvent[]): DailyActivity[] {
  const byDay = new Map<string, DailyActivity>()
  for (const e of events) {
    if (!e.ts) continue
    const date = new Date(e.ts).toISOString().slice(0, 10)
    if (!byDay.has(date)) {
      byDay.set(date, { date, messages: 0, turns: 0, toolCalls: 0 })
    }
    const day = byDay.get(date)!
    if (e.type === 'item/completed' || e.type === 'item/started') {
      const item = e.data?.item
      if (item?.type === 'assistant_message' || item?.type === 'user_message') day.messages++
      if (item?.type === 'tool_call') day.toolCalls++
    }
    if (e.type === 'turn/completed') day.turns++
  }
  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function aggregateToolUsage(events: RawEvent[]): ToolUsage[] {
  const byTool = new Map<string, ToolUsage>()
  for (const e of events) {
    if (e.type !== 'item/completed') continue
    const item = e.data?.item
    if (item?.type !== 'tool_call') continue
    const name = item.toolName || 'unknown'
    const existing = byTool.get(name)
    if (existing) {
      existing.count++
      if (e.ts > existing.lastUsed) existing.lastUsed = e.ts
    } else {
      byTool.set(name, { name, count: 1, lastUsed: e.ts })
    }
  }
  return Array.from(byTool.values()).sort((a, b) => b.count - a.count)
}

function aggregateMemories(memoriesDir: string): MemoryInfo {
  const result: MemoryInfo = { total: 0, byCategory: {}, recentItems: [] }
  if (!existsSync(memoriesDir)) return result
  try {
    const files = readdirSync(memoriesDir).filter(f => f.endsWith('.json'))
    result.total = files.length
    const recent: MemoryInfo['recentItems'] = []
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(memoriesDir, file), 'utf-8'))
        const cat = raw.category || 'general'
        result.byCategory[cat] = (result.byCategory[cat] || 0) + 1
        if (raw.content) {
          recent.push({ category: cat, content: String(raw.content).slice(0, 120), createdAt: raw.createdAt || 0 })
        }
      } catch { /* skip */ }
    }
    recent.sort((a, b) => b.createdAt - a.createdAt)
    result.recentItems = recent.slice(0, 5)
  } catch { /* skip */ }
  return result
}

function aggregateTokenCost(events: RawEvent[]): TokenCost {
  const COST_PER_1K = 0.01
  let totalTokens = 0
  const byDay = new Map<string, { date: string; tokens: number }>()

  for (const e of events) {
    if (e.type !== 'turn/completed') continue
    const approxTokens = 2000
    totalTokens += approxTokens
    if (!e.ts) continue
    const date = new Date(e.ts).toISOString().slice(0, 10)
    const existing = byDay.get(date)
    if (existing) {
      existing.tokens += approxTokens
    } else {
      byDay.set(date, { date, tokens: approxTokens })
    }
  }

  const sorted = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date))
  return {
    totalTokens,
    estimatedCostUsd: Math.round(totalTokens * COST_PER_1K / 1000 * 100) / 100,
    byDay: sorted.map(d => ({
      ...d,
      costUsd: Math.round(d.tokens * COST_PER_1K / 1000 * 100) / 100,
    })),
  }
}
