/**
 * Test helpers — test server lifecycle, WebSocket client, JSON-RPC utilities
 *
 * Provides:
 * - startTestServer() / stopTestServer(): spin up the app on a random port
 * - createWsClient(): connect a WebSocket client to the test server
 * - jsonRpcRequest(): send a JSON-RPC request and await the response
 * - createTempDir() / removeTempDir(): isolated data directories per test
 */

import { WebSocket } from 'ws'
import { createServer, type Server } from 'http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { ThreadManager } from '../../src/thread/manager.js'
import { MessageProcessor } from '../../src/server/message-processor.js'
import { parseMessage, createError, PARSE_ERROR } from '../../src/server/json-rpc.js'
import { authenticateConnection, extractTokenFromRequest } from '../../src/auth/index.js'

/** A running test server with all its parts */
export interface TestServer {
  httpServer: Server
  wss: WebSocketServer
  manager: ThreadManager
  processor: MessageProcessor
  port: number
  url: string
  /** Call to shut down the server */
  close: () => Promise<void>
}

/** Original env values that we restore after each test suite */
const envStack: Array<Record<string, string | undefined>> = []

/**
 * Push current env values for the given keys, so we can restore them later.
 */
export function pushEnv(keys: string[]): void {
  const snapshot: Record<string, string | undefined> = {}
  for (const key of keys) {
    snapshot[key] = process.env[key]
  }
  envStack.push(snapshot)
}

/**
 * Restore env values that were saved by pushEnv.
 */
export function popEnv(): void {
  const snapshot = envStack.pop()
  if (!snapshot) return
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

/**
 * Create a temporary directory for test data.
 * Returns the absolute path.
 */
export function createTempDir(prefix = 'chitu-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/**
 * Remove a temporary directory recursively.
 */
export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * Start a test server on a random available port.
 *
 * This mirrors the logic in `createAppServer()` but:
 * - Uses a random port (port 0)
 * - Disables auth by default
 * - Uses a temp data directory
 * - Skips file watchers (not needed for tests)
 * - Returns a `close()` function for cleanup
 */
export async function startTestServer(options?: {
  dataDir?: string
  authDisabled?: boolean
}): Promise<TestServer> {
  const dataDir = options?.dataDir || createTempDir()

  // Set auth disabled for the test server
  const prevAuth = process.env.CHITU_AUTH_DISABLED
  if (options?.authDisabled !== false) {
    process.env.CHITU_AUTH_DISABLED = 'true'
  }

  const manager = new ThreadManager(dataDir)
  const processor = new MessageProcessor(manager)

  const httpServer = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (req.url?.startsWith('/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
    } else {
      res.writeHead(426, { 'Content-Type': 'text/plain' })
      res.end('Upgrade Required')
    }
  })

  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: (info, callback) => {
      const token = extractTokenFromRequest(info.req)
      const result = authenticateConnection(token)
      if (!result.success) {
        callback(false, 401, result.reason || 'Unauthorized')
      } else {
        callback(true)
      }
    },
  })

  wss.on('connection', (ws: WebSocket) => {
    processor.addClient(ws)

    ws.on('message', async (data) => {
      const raw = data.toString()
      const request = parseMessage(raw)
      if (!request) {
        ws.send(JSON.stringify(createError(0, PARSE_ERROR, 'Invalid JSON-RPC message')))
        return
      }
      await processor.handleMessage(ws, request)
    })

    ws.on('close', () => {
      processor.removeClient(ws)
    })
  })

  // Listen on port 0 to get a random available port
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })

  const addr = httpServer.address()
  const port = typeof addr === 'object' && addr ? addr.port : 8080

  // Restore auth env
  if (prevAuth === undefined) {
    delete process.env.CHITU_AUTH_DISABLED
  } else {
    process.env.CHITU_AUTH_DISABLED = prevAuth
  }

  const close = async () => {
    await new Promise<void>((resolve, reject) => {
      wss.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    if (!options?.dataDir) {
      removeTempDir(dataDir)
    }
  }

  return {
    httpServer,
    wss,
    manager,
    processor,
    port,
    url: `ws://localhost:${port}`,
    close,
  }
}

/**
 * Create a WebSocket client connected to the given URL.
 * Optionally appends a token query parameter.
 */
export function createWsClient(url: string, token?: string): Promise<WebSocket> {
  const fullUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url
  const ws = new WebSocket(fullUrl)

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('WebSocket connection timed out'))
    }, 5000)

    ws.once('open', () => {
      clearTimeout(timeout)
      resolve(ws)
    })

    ws.once('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(timeout)
      reject(new Error(`WebSocket handshake rejected with status ${res.statusCode}`))
    })
  })
}

/**
 * Send a JSON-RPC request over WebSocket and wait for a response with the same id.
 *
 * Resolves with the parsed response object.
 * Rejects if no matching response arrives within the timeout.
 */
export function jsonRpcRequest(
  ws: WebSocket,
  method: string,
  params?: Record<string, unknown>,
  id?: number | string,
): Promise<any> {
  const reqId = id ?? randomUUID()
  const message = {
    jsonrpc: '2.0',
    id: reqId,
    method,
    ...(params !== undefined ? { params } : {}),
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off('message', handler)
      reject(new Error(`JSON-RPC response timed out for method="${method}" id="${reqId}"`))
    }, 5000)

    function handler(data: any) {
      try {
        const parsed = JSON.parse(data.toString())
        if (parsed.id === reqId) {
          clearTimeout(timeout)
          ws.off('message', handler)
          resolve(parsed)
        }
      } catch {
        // Ignore non-JSON or unmatched messages
      }
    }

    ws.on('message', handler)
    ws.send(JSON.stringify(message))
  })
}

/**
 * Collect the next N JSON-RPC messages received on the WebSocket.
 * Useful for checking notifications.
 */
export function collectMessages(
  ws: WebSocket,
  count: number,
  timeoutMs = 5000,
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const messages: any[] = []

    const timer = setTimeout(() => {
      ws.off('message', handler)
      reject(new Error(`Timed out waiting for ${count} messages (got ${messages.length})`))
    }, timeoutMs)

    function handler(data: any) {
      try {
        messages.push(JSON.parse(data.toString()))
        if (messages.length >= count) {
          clearTimeout(timer)
          ws.off('message', handler)
          resolve(messages)
        }
      } catch {
        // Ignore
      }
    }

    ws.on('message', handler)
  })
}

/**
 * Gracefully close a WebSocket connection.
 */
export function closeWs(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    ws.once('close', () => resolve())
    ws.close()
  })
}
