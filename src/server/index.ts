/**
 * WebSocket App Server — 入口
 *
 * 传输层：WebSocket (ws 库)
 * 协议：JSON-RPC 2.0
 *
 * Codex 用 stdio (JSONL)，我们用 WebSocket（更适合浏览器场景）
 * 三种集成模式：本地 IDE / Web / TUI，统一走这个 WebSocket
 *
 * 架构（对齐 Codex 4 组件）：
 *   Transport (本文件) → Message Processor → Thread Manager → Core Threads
 */

import { WebSocketServer, type WebSocket } from 'ws'
import { createServer } from 'http'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ThreadManager } from '../thread/manager.js'
import { MessageProcessor } from './message-processor.js'
import { HookDispatcher } from '../hooks/dispatcher.js'
import { parseMessage, createError, PARSE_ERROR } from './json-rpc.js'
import { loadMilestonePlan } from '../tools/milestone-plan/parser.js'

export interface AppServerOptions {
  port?: number
  dataDir?: string
}

export function createAppServer(options?: AppServerOptions) {
  const port = options?.port || 8080
  const manager = new ThreadManager(options?.dataDir)
  manager.setHookDispatcher(new HookDispatcher())
  const processor = new MessageProcessor(manager)

  // HTTP server for /status, /dashboard endpoints + WebSocket upgrade
  const projectRoot = process.cwd()
  const httpServer = createServer((req, res) => {
    // CORS headers for dashboard access from frontend dev server
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.url?.startsWith('/status')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(manager.getStatus(), null, 2))
    } else if (req.url?.startsWith('/dashboard')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(buildDashboardData(manager, projectRoot), null, 2))
    } else {
      res.writeHead(426, { 'Content-Type': 'text/plain' })
      res.end('Upgrade Required. Use WebSocket or /status /dashboard endpoint.')
    }
  })

  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (ws: WebSocket) => {
    console.log('[ws] 客户端连接')
    processor.addClient(ws)

    ws.on('message', async (data) => {
      const raw = data.toString()
      const request = parseMessage(raw)

      if (!request) {
        ws.send(JSON.stringify(createError(0, PARSE_ERROR, 'Invalid JSON-RPC message')))
        return
      }

      console.log('[ws]', request.method, request.id ?? '(notification)')
      await processor.handleMessage(ws, request)
    })

    ws.on('close', () => {
      console.log('[ws] 客户端断开')
      processor.removeClient(ws)
    })

    ws.on('error', (err) => {
      console.error('[ws] 连接错误:', err.message)
    })
  })

  httpServer.listen(port)

  console.log(`\n🚀 Chitu App Server`)
  console.log(`   WebSocket: ws://localhost:${port}`)
  console.log(`   Status:    http://localhost:${port}/status`)
  console.log(`   数据目录: ${options?.dataDir || './chitu-data/threads'}\n`)

  return { wss, httpServer, manager, processor }
}

/** 聚合 dashboard 数据 */
function buildDashboardData(manager: ThreadManager, projectRoot: string) {
  const status = manager.getStatus()

  // 里程碑进度（含任务时长）
  const plan = loadMilestonePlan(projectRoot)
  const now = Date.now()
  const milestones = plan ? plan.milestones.map(m => {
    const durationMs = m.status === 'in_progress' && m.startedAt
      ? now - m.startedAt
      : (m.completedAt && m.startedAt ? m.completedAt - m.startedAt : undefined)
    return {
      id: m.id,
      title: m.title,
      status: m.status,
      scope: m.scope,
      keyFiles: m.keyFiles,
      acceptanceCriteria: m.acceptanceCriteria,
      verificationCommands: m.verificationCommands,
      notesCount: m.notes.length,
      decisionsCount: m.decisionLog.length,
      recentNotes: m.notes.slice(-3),
      recentDecisions: m.decisionLog.slice(-3),
      startedAt: m.startedAt,
      completedAt: m.completedAt,
      durationMs,
    }
  }) : []

  const completedCount = milestones.filter(m => m.status === 'completed').length
  const totalCount = milestones.length

  // 任务总时长：从第一个 milestone start 到最后一个 complete（或 now）
  const startedMilestones = milestones.filter(m => m.startedAt)
  const taskStartedAt = startedMilestones.length > 0 ? Math.min(...startedMilestones.map(m => m.startedAt!)) : undefined
  const lastCompletedAt = milestones.filter(m => m.completedAt).length > 0 ? Math.max(...milestones.filter(m => m.completedAt).map(m => m.completedAt!)) : undefined
  const hasActive = milestones.some(m => m.status === 'in_progress')
  const taskDurationMs = taskStartedAt ? ((hasActive ? now : (lastCompletedAt || now)) - taskStartedAt) : undefined

  // 最近的 rollout events
  const recentEvents = loadRecentRolloutEvents(projectRoot, 20)

  return {
    status,
    milestones: {
      total: totalCount,
      completed: completedCount,
      inProgress: milestones.filter(m => m.status === 'in_progress').length,
      pending: milestones.filter(m => m.status === 'pending').length,
      failed: milestones.filter(m => m.status === 'failed').length,
      progressPct: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
      items: milestones,
    },
    timing: {
      taskStartedAt,
      taskDurationMs,
      hasActive,
    },
    recentEvents,
    timestamp: Date.now(),
  }
}

/** 读取最近 N 条 rollout events */
function loadRecentRolloutEvents(projectRoot: string, limit: number): Array<{ type: string; timestamp: string; data: any }> {
  const rolloutDir = join(projectRoot, 'chitu-data', 'rollouts')
  try {
    const files = readdirSync(rolloutDir).filter(f => f.endsWith('.jsonl')).sort().reverse()
    const events: Array<{ type: string; timestamp: string; data: any }> = []
    for (const file of files.slice(0, 5)) {
      const content = readFileSync(join(rolloutDir, file), 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          events.push(JSON.parse(line))
        } catch { /* skip malformed */ }
      }
    }
    return events.slice(-limit)
  } catch {
    return []
  }
}

// 直接运行：npx tsx src/server/index.ts
if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') || '')) {
  const port = parseInt(process.env.PORT || '8080', 10)
  createAppServer({ port })
}
