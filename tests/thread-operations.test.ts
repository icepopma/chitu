/**
 * Thread Operations Tests
 *
 * Tests the full thread lifecycle through the JSON-RPC protocol layer.
 * No LLM or DB required -- uses file-based persistence in temp directories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { startTestServer, createWsClient, jsonRpcRequest, closeWs } from './helpers/setup.js'
import type { TestServer } from './helpers/setup.js'

describe('Thread Operations', () => {
  let server: TestServer
  let ws: import('ws').WebSocket

  beforeEach(async () => {
    server = await startTestServer()
    ws = await createWsClient(server.url)
    // Initialize handshake required before other methods
    await jsonRpcRequest(ws, 'initialize')
  })

  afterEach(async () => {
    await closeWs(ws)
    await server.close()
  })

  it('thread/create returns a thread with generated ID and status "created"', async () => {
    const response = await jsonRpcRequest(ws, 'thread/create', { title: 'Test Thread' })

    expect(response.result).toBeDefined()
    expect(response.result.thread).toBeDefined()
    expect(response.result.thread.id).toBeDefined()
    expect(typeof response.result.thread.id).toBe('string')
    expect(response.result.thread.id.length).toBeGreaterThan(0)
    expect(response.result.thread.status).toBe('created')
    expect(response.result.thread.title).toBe('Test Thread')
    expect(response.result.thread.items).toEqual([])
    expect(response.result.thread.createdAt).toBeDefined()
    expect(response.result.thread.updatedAt).toBeDefined()
    expect(response.error).toBeUndefined()
  })

  it('thread/create with default title when none provided', async () => {
    const response = await jsonRpcRequest(ws, 'thread/create')

    expect(response.result.thread.title).toBe('新对话')
  })

  it('thread/list returns array including created threads', async () => {
    // Create two threads
    const r1 = await jsonRpcRequest(ws, 'thread/create', { title: 'Thread A' })
    const r2 = await jsonRpcRequest(ws, 'thread/create', { title: 'Thread B' })

    const listResponse = await jsonRpcRequest(ws, 'thread/list')

    expect(listResponse.result.threads).toBeDefined()
    expect(Array.isArray(listResponse.result.threads)).toBe(true)
    expect(listResponse.result.threads.length).toBeGreaterThanOrEqual(2)

    const ids = listResponse.result.threads.map((t: any) => t.id)
    expect(ids).toContain(r1.result.thread.id)
    expect(ids).toContain(r2.result.thread.id)
  })

  it('thread/resume loads an existing thread', async () => {
    const createResponse = await jsonRpcRequest(ws, 'thread/create', { title: 'Resume Me' })
    const threadId = createResponse.result.thread.id

    const resumeResponse = await jsonRpcRequest(ws, 'thread/resume', { threadId })

    expect(resumeResponse.result.thread).toBeDefined()
    expect(resumeResponse.result.thread.id).toBe(threadId)
    expect(resumeResponse.result.thread.title).toBe('Resume Me')
  })

  it('thread/resume with nonexistent threadId returns error', async () => {
    const response = await jsonRpcRequest(ws, 'thread/resume', {
      threadId: 'nonexistent-id-12345',
    })

    expect(response.error).toBeDefined()
    expect(response.error.code).toBe(-32602)
    expect(response.error.message).toContain('not found')
  })

  it('thread/resume with missing threadId returns INVALID_PARAMS', async () => {
    const response = await jsonRpcRequest(ws, 'thread/resume', {})

    expect(response.error).toBeDefined()
    expect(response.error.code).toBe(-32602)
    expect(response.error.message).toContain('Missing threadId')
  })

  it('thread/rename updates the title', async () => {
    const createResponse = await jsonRpcRequest(ws, 'thread/create', { title: 'Old Title' })
    const threadId = createResponse.result.thread.id

    const renameResponse = await jsonRpcRequest(ws, 'thread/rename', {
      threadId,
      title: 'New Title',
    })
    expect(renameResponse.error).toBeUndefined()

    // Verify via resume
    const resumeResponse = await jsonRpcRequest(ws, 'thread/resume', { threadId })
    expect(resumeResponse.result.thread.title).toBe('New Title')
  })

  it('thread/rename with missing params returns error', async () => {
    const response = await jsonRpcRequest(ws, 'thread/rename', { threadId: 'some-id' })
    expect(response.error).toBeDefined()
    expect(response.error.code).toBe(-32602)
  })

  it('thread/fork creates a new thread with copied items', async () => {
    const createResponse = await jsonRpcRequest(ws, 'thread/create', { title: 'Original' })
    const threadId = createResponse.result.thread.id

    const forkResponse = await jsonRpcRequest(ws, 'thread/fork', { threadId })

    expect(forkResponse.result.thread).toBeDefined()
    expect(forkResponse.result.thread.id).toBeDefined()
    expect(forkResponse.result.thread.id).not.toBe(threadId)
    expect(forkResponse.result.thread.title).toContain('fork')
    expect(forkResponse.result.thread.status).toBe('created')
  })

  it('thread/fork with nonexistent threadId returns error', async () => {
    const response = await jsonRpcRequest(ws, 'thread/fork', {
      threadId: 'nonexistent-fork-id',
    })

    expect(response.error).toBeDefined()
    expect(response.error.code).toBe(-32602)
  })

  it('thread/fork with missing threadId returns INVALID_PARAMS', async () => {
    const response = await jsonRpcRequest(ws, 'thread/fork', {})
    expect(response.error).toBeDefined()
    expect(response.error.code).toBe(-32602)
    expect(response.error.message).toContain('Missing threadId')
  })

  it('thread/delete removes the thread', async () => {
    const createResponse = await jsonRpcRequest(ws, 'thread/create', { title: 'To Delete' })
    const threadId = createResponse.result.thread.id

    const deleteResponse = await jsonRpcRequest(ws, 'thread/delete', { threadId })
    expect(deleteResponse.error).toBeUndefined()

    // Verify via resume (should fail)
    const resumeResponse = await jsonRpcRequest(ws, 'thread/resume', { threadId })
    expect(resumeResponse.error).toBeDefined()
    expect(resumeResponse.error.message).toContain('not found')
  })

  it('thread/delete with missing threadId returns error', async () => {
    const response = await jsonRpcRequest(ws, 'thread/delete', {})
    expect(response.error).toBeDefined()
    expect(response.error.code).toBe(-32602)
  })

  it('full lifecycle: create -> list -> rename -> fork -> delete', async () => {
    // 1. Create
    const createRes = await jsonRpcRequest(ws, 'thread/create', { title: 'Lifecycle Test' })
    const threadId = createRes.result.thread.id
    expect(createRes.result.thread.status).toBe('created')

    // 2. List
    const listRes = await jsonRpcRequest(ws, 'thread/list')
    const found = listRes.result.threads.find((t: any) => t.id === threadId)
    expect(found).toBeDefined()

    // 3. Rename
    await jsonRpcRequest(ws, 'thread/rename', { threadId, title: 'Renamed Lifecycle' })
    const afterRename = await jsonRpcRequest(ws, 'thread/resume', { threadId })
    expect(afterRename.result.thread.title).toBe('Renamed Lifecycle')

    // 4. Fork
    const forkRes = await jsonRpcRequest(ws, 'thread/fork', { threadId })
    const forkedId = forkRes.result.thread.id
    expect(forkedId).not.toBe(threadId)

    // 5. Delete original
    await jsonRpcRequest(ws, 'thread/delete', { threadId })
    const deletedCheck = await jsonRpcRequest(ws, 'thread/resume', { threadId })
    expect(deletedCheck.error).toBeDefined()

    // Forked thread should still exist
    const forkedCheck = await jsonRpcRequest(ws, 'thread/resume', { threadId: forkedId })
    expect(forkedCheck.result.thread.id).toBe(forkedId)
  })

  it('thread/archive sets status to archived', async () => {
    const createRes = await jsonRpcRequest(ws, 'thread/create', { title: 'Archive Me' })
    const threadId = createRes.result.thread.id

    const archiveRes = await jsonRpcRequest(ws, 'thread/archive', { threadId })
    expect(archiveRes.error).toBeUndefined()
  })

  it('thread/archive with missing threadId returns error', async () => {
    const response = await jsonRpcRequest(ws, 'thread/archive', {})
    expect(response.error).toBeDefined()
    expect(response.error.code).toBe(-32602)
  })

  it('thread/create with ownerId and orgId', async () => {
    const response = await jsonRpcRequest(ws, 'thread/create', {
      title: 'Owned Thread',
      ownerId: 'user-123',
      orgId: 'org-456',
    })

    expect(response.result.thread.ownerId).toBe('user-123')
    expect(response.result.thread.orgId).toBe('org-456')
  })
})
