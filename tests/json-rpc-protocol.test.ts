/**
 * JSON-RPC 2.0 Protocol Tests
 *
 * Tests the protocol layer without any LLM or DB dependency.
 * Covers: initialize handshake, error codes, malformed messages, multi-client.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { startTestServer, createWsClient, jsonRpcRequest, closeWs } from './helpers/setup.js'
import type { TestServer } from './helpers/setup.js'
import { createHmac } from 'node:crypto'

describe('JSON-RPC Protocol', () => {
  let server: TestServer

  beforeEach(async () => {
    server = await startTestServer()
  })

  afterEach(async () => {
    await server.close()
  })

  it('initialize handshake returns correct response with protocolVersion', async () => {
    const ws = await createWsClient(server.url)
    try {
      const response = await jsonRpcRequest(ws, 'initialize')

      expect(response.jsonrpc).toBe('2.0')
      expect(response.result).toBeDefined()
      expect(response.result.protocolVersion).toBe('1.0.0')
      expect(response.result.serverInfo).toBeDefined()
      expect(response.result.serverInfo.name).toBe('chitu-app-server')
      expect(response.result.serverInfo.version).toBe('0.1.0')
      expect(response.result.capabilities).toBeDefined()
      expect(response.error).toBeUndefined()
    } finally {
      await closeWs(ws)
    }
  })

  it('initialize preserves the request id', async () => {
    const ws = await createWsClient(server.url)
    try {
      const response = await jsonRpcRequest(ws, 'initialize', undefined, 42)
      expect(response.id).toBe(42)
    } finally {
      await closeWs(ws)
    }
  })

  it('unknown method returns METHOD_NOT_FOUND error (-32601)', async () => {
    const ws = await createWsClient(server.url)
    try {
      // Must initialize first (other methods require handshake)
      await jsonRpcRequest(ws, 'initialize')

      const response = await jsonRpcRequest(ws, 'nonexistent/method')
      expect(response.error).toBeDefined()
      expect(response.error.code).toBe(-32601)
      expect(response.error.message).toContain('Method not found')
    } finally {
      await closeWs(ws)
    }
  })

  it('method without prior initialize returns NOT_INITIALIZED error (-32002)', async () => {
    const ws = await createWsClient(server.url)
    try {
      // Skip initialize, directly call a method
      const response = await jsonRpcRequest(ws, 'thread/list')
      expect(response.error).toBeDefined()
      expect(response.error.code).toBe(-32002)
      expect(response.error.message).toContain('Not initialized')
    } finally {
      await closeWs(ws)
    }
  })

  it('missing required params returns INVALID_PARAMS error (-32602)', async () => {
    const ws = await createWsClient(server.url)
    try {
      await jsonRpcRequest(ws, 'initialize')

      // thread/resume requires threadId
      const response = await jsonRpcRequest(ws, 'thread/resume', {})
      expect(response.error).toBeDefined()
      expect(response.error.code).toBe(-32602)
      expect(response.error.message).toContain('Missing threadId')
    } finally {
      await closeWs(ws)
    }
  })

  it('malformed JSON returns PARSE_ERROR (-32700)', async () => {
    const ws = await createWsClient(server.url)
    try {
      const response = await new Promise<any>((resolve) => {
        const handler = (data: any) => {
          try {
            const parsed = JSON.parse(data.toString())
            resolve(parsed)
            ws.off('message', handler)
          } catch {
            // Ignore
          }
        }
        ws.on('message', handler)
        ws.send('this is not valid json')
      })

      expect(response.error).toBeDefined()
      expect(response.error.code).toBe(-32700)
    } finally {
      await closeWs(ws)
    }
  })

  it('message with missing jsonrpc field is treated as parse error', async () => {
    const ws = await createWsClient(server.url)
    try {
      const response = await new Promise<any>((resolve) => {
        const handler = (data: any) => {
          try {
            const parsed = JSON.parse(data.toString())
            resolve(parsed)
            ws.off('message', handler)
          } catch {
            // Ignore
          }
        }
        ws.on('message', handler)
        // Valid JSON but missing jsonrpc: "2.0"
        ws.send(JSON.stringify({ id: 1, method: 'initialize' }))
      })

      expect(response.error).toBeDefined()
      expect(response.error.code).toBe(-32700)
    } finally {
      await closeWs(ws)
    }
  })

  it('message with missing method field is treated as parse error', async () => {
    const ws = await createWsClient(server.url)
    try {
      const response = await new Promise<any>((resolve) => {
        const handler = (data: any) => {
          try {
            const parsed = JSON.parse(data.toString())
            resolve(parsed)
            ws.off('message', handler)
          } catch {
            // Ignore
          }
        }
        ws.on('message', handler)
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1 }))
      })

      expect(response.error).toBeDefined()
      expect(response.error.code).toBe(-32700)
    } finally {
      await closeWs(ws)
    }
  })

  it('multiple clients can connect simultaneously', async () => {
    const clients = await Promise.all([
      createWsClient(server.url),
      createWsClient(server.url),
      createWsClient(server.url),
    ])

    try {
      // All clients can initialize independently
      const responses = await Promise.all(
        clients.map((ws) => jsonRpcRequest(ws, 'initialize')),
      )

      for (const response of responses) {
        expect(response.result).toBeDefined()
        expect(response.result.protocolVersion).toBe('1.0.0')
      }
    } finally {
      await Promise.all(clients.map(closeWs))
    }
  })

  it('thread/create without prior initialize is rejected', async () => {
    const ws = await createWsClient(server.url)
    try {
      const response = await jsonRpcRequest(ws, 'thread/create')
      expect(response.error).toBeDefined()
      expect(response.error.code).toBe(-32002)
    } finally {
      await closeWs(ws)
    }
  })

  it('multiple missing params are reported (thread/rename needs threadId + title)', async () => {
    const ws = await createWsClient(server.url)
    try {
      await jsonRpcRequest(ws, 'initialize')

      const response = await jsonRpcRequest(ws, 'thread/rename', {})
      expect(response.error).toBeDefined()
      expect(response.error.code).toBe(-32602)
    } finally {
      await closeWs(ws)
    }
  })
})
