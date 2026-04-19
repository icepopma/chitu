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
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ThreadManager } from '../thread/manager.js'
import { MessageProcessor } from './message-processor.js'
import { HookDispatcher } from '../hooks/dispatcher.js'
import { parseMessage, createError, PARSE_ERROR } from './json-rpc.js'
import { loadMilestonePlan } from '../tools/milestone-plan/parser.js'
import { chituMetrics } from '../monitoring/metrics.js'
import { logger } from '../monitoring/logger.js'
import { FileWatcher, FileChangeBuffer, SkillsWatcher } from '../watcher/index.js'
import { authenticateConnection, extractTokenFromRequest } from '../auth/index.js'
import { buildAnalytics } from './dashboard-analytics.js'

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
    } else if (req.url?.startsWith('/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }))
    } else if (req.url?.startsWith('/metrics')) {
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' })
      res.end(chituMetrics.render())
    } else if (req.url?.startsWith('/dashboard')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(buildDashboardData(manager, projectRoot, processor), null, 2))
    } else {
      res.writeHead(426, { 'Content-Type': 'text/plain' })
      res.end('Upgrade Required. Use WebSocket or /status /dashboard endpoint.')
    }
  })

  // M10: WebSocket 认证 — verifyClient 在握手阶段验证 token
  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: (info, callback) => {
      const token = extractTokenFromRequest(info.req)
      const result = authenticateConnection(token)
      if (!result.success) {
        logger.warn('WebSocket auth rejected', { reason: result.reason })
        callback(false, 401, result.reason || 'Unauthorized')
      } else {
        callback(true)
      }
    },
  })

  wss.on('connection', (ws: WebSocket) => {
    logger.info('WebSocket client connected')
    processor.addClient(ws)
    chituMetrics.connectionAdded()

    ws.on('message', async (data) => {
      const raw = data.toString()
      const request = parseMessage(raw)

      if (!request) {
        ws.send(JSON.stringify(createError(0, PARSE_ERROR, 'Invalid JSON-RPC message')))
        return
      }

      logger.debug('WebSocket message received', { method: request.method, id: request.id })
      await processor.handleMessage(ws, request)
    })

    ws.on('close', () => {
      logger.info('WebSocket client disconnected')
      processor.removeClient(ws)
      chituMetrics.connectionRemoved()
    })

    ws.on('error', (err) => {
      logger.error('WebSocket connection error', { error: err.message })
    })
  })

  httpServer.listen(port)

  logger.info('Chitu App Server started', { port, dataDir: options?.dataDir || './chitu-data/threads' })
  console.log(`\n🚀 Chitu App Server`)
  console.log(`   WebSocket: ws://localhost:${port}`)
  console.log(`   Health:    http://localhost:${port}/health`)
  console.log(`   Metrics:   http://localhost:${port}/metrics`)
  console.log(`   Status:    http://localhost:${port}/status`)
  console.log(`   数据目录: ${options?.dataDir || './chitu-data/threads'}\n`)

  // M7: 文件监听 — FileWatcher + FileChangeBuffer + SkillsWatcher
  const fileChangeBuffer = new FileChangeBuffer()

  const fileWatcher = new FileWatcher({
    rootDir: projectRoot,
    onChange: (events) => fileChangeBuffer.push(events),
  })
  fileWatcher.start()

  const skillsWatcher = new SkillsWatcher({
    projectRoot,
    onSkillsChanged: (skills) => {
      logger.info('Skills hot-reloaded', { count: skills.length })
    },
  })
  skillsWatcher.start()

  // 注入到 ThreadManager，让 Agent Loop 能访问 buffer
  manager.setFileChangeBuffer(fileChangeBuffer)

  return { wss, httpServer, manager, processor, fileWatcher, skillsWatcher, fileChangeBuffer }
}

/** 聚合 dashboard 数据 */
function buildDashboardData(manager: ThreadManager, projectRoot: string, processor: MessageProcessor) {
  const dataDir = join(projectRoot, 'chitu-data')
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
  const taskDurationMs = taskStartedAt ? ((hasActive ? now : (lastCompletedAt || now)) - taskStartedAt - processor.getPausedDuration()) : undefined

  // 最近事件：优先内存缓冲，不够时从磁盘补充
  const memEvents = processor.getRecentEvents()
  let recentEvents: Array<{ type: string; timestamp: number; data: any }>
  if (memEvents.length >= 10) {
    recentEvents = memEvents.slice(-30)
  } else {
    const fileEvents = loadRecentRolloutEvents(projectRoot, 30)
    // 合并去重
    const seen = new Set<string>()
    const merged: typeof memEvents = []
    for (const e of [...fileEvents, ...memEvents]) {
      const ts = typeof e.timestamp === 'number' ? e.timestamp : 0
      const key = `${ts}:${e.type}`
      if (!seen.has(key)) {
        seen.add(key)
        merged.push({ type: e.type, timestamp: ts, data: e.data })
      }
    }
    merged.sort((a, b) => a.timestamp - b.timestamp)
    recentEvents = merged.slice(-30)
  }

  // M15: 集成 analytics（工具使用、每日活动、记忆、token 成本）
  const analytics = buildAnalytics(dataDir)

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
    analytics,
    timestamp: Date.now(),
  }
}

/** 读取最近 N 条 rollout events（从多个线程文件中聚合） */
function loadRecentRolloutEvents(projectRoot: string, limit: number): Array<{ type: string; timestamp: number; data: any }> {
  const rolloutDir = join(projectRoot, 'chitu-data', 'rollouts')
  try {
    // 按修改时间排序，最新的文件优先
    const files = readdirSync(rolloutDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f, mtime: statSync(join(rolloutDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map(f => f.name)
    const events: Array<{ type: string; timestamp: number; data: any }> = []
    // 读最近 5 个文件（覆盖多个线程的活动）
    for (const file of files.slice(0, 5)) {
      const content = readFileSync(join(rolloutDir, file), 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)
      // 只取最后 limit 条，跳过 item/delta（太多太碎）
      const recentLines = lines.slice(-limit * 3)
      for (const line of recentLines) {
        try {
          const raw = JSON.parse(line)
          // 标准化字段名：rollout 里存的是 ts，前端期望 timestamp
          events.push({
            type: raw.type,
            timestamp: raw.ts || raw.timestamp || 0,
            data: raw.data,
          })
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
