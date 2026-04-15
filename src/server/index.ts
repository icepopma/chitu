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
import { ThreadManager } from '../thread/manager.js'
import { MessageProcessor } from './message-processor.js'
import { HookDispatcher } from '../hooks/dispatcher.js'
import { parseMessage, createError, PARSE_ERROR } from './json-rpc.js'

export interface AppServerOptions {
  port?: number
  dataDir?: string
}

export function createAppServer(options?: AppServerOptions) {
  const port = options?.port || 8080
  const manager = new ThreadManager(options?.dataDir)
  manager.setHookDispatcher(new HookDispatcher())
  const processor = new MessageProcessor(manager)

  const wss = new WebSocketServer({ port })

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

  console.log(`\n🚀 Chitu App Server`)
  console.log(`   WebSocket: ws://localhost:${port}`)
  console.log(`   数据目录: ${options?.dataDir || './chitu-data/threads'}\n`)

  return { wss, manager, processor }
}

// 直接运行：npx tsx src/server/index.ts
if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') || '')) {
  const port = parseInt(process.env.PORT || '8080', 10)
  createAppServer({ port })
}
