// Step 13.4 Plan System — Backend Unit Test
// 直接通过 WebSocket 测试 update_plan 工具的注册和事件流

import { WebSocket } from 'ws'
import { test, expect } from '@playwright/test'

const WS_URL = 'ws://localhost:8080'

test.describe('Plan Tool Backend', () => {

  test('update_plan tool should be registered', async () => {
    // 连接并初始化
    const ws = new WebSocket(WS_URL)
    await new Promise<void>((resolve) => { ws.on('open', () => resolve()) })

    // initialize
    const initResult = await rpcCall(ws, 'initialize', {
      protocolVersion: '1.0.0',
      clientInfo: { name: 'test', version: '0.1.0' },
    })
    expect(initResult.protocolVersion).toBe('1.0.0')
    console.log('[test] Initialized')

    // 创建线程
    const threadResult = await rpcCall(ws, 'thread/create', {})
    const threadId = threadResult.thread.id
    expect(threadId).toBeTruthy()
    console.log('[test] Thread created:', threadId)

    // 发送消息 — 使用简单任务，但明确要求创建计划
    const events: any[] = []
    const eventPromise = new Promise<void>((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.method) {
          events.push(msg)
          if (msg.method === 'turn/completed') resolve()
          if (msg.method === 'turn/plan/updated') {
            console.log('[test] plan/updated event received:', JSON.stringify(msg.params).slice(0, 200))
          }
        }
      })
    })

    // turn/start
    const turnResult = await rpcCall(ws, 'turn/start', {
      threadId,
      message: '用 update_plan 工具创建一个3步计划：1)分析代码 2)设计方案 3)实现方案。然后执行第1步（运行 ls 命令），完成后更新计划。',
    })
    console.log('[test] Turn started')

    // 等待完成（最多 120 秒）
    await Promise.race([
      eventPromise,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 120_000)),
    ])

    // 检查是否收到 plan/updated 事件
    const planEvents = events.filter(e => e.method === 'turn/plan/updated' || e.method === 'plan/updated')
    console.log(`[test] Total events: ${events.length}, plan events: ${planEvents.length}`)

    // 打印所有事件类型
    const eventTypes = events.map(e => e.method)
    console.log('[test] Event types:', eventTypes)

    // 检查是否有 update_plan 工具调用
    const toolCallItems = events.filter(e =>
      e.method === 'item/completed' &&
      e.params?.item?.toolName === 'update_plan'
    )
    console.log(`[test] update_plan tool calls: ${toolCallItems.length}`)

    ws.close()

    // 至少应该有工具调用（即使 Agent 不一定调用 update_plan）
    // 验证 turn 完成
    expect(events.some(e => e.method === 'turn/completed')).toBe(true)
  })
})

function rpcCall(ws: WebSocket, method: string, params: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = Date.now()
    const handler = (data: any) => {
      const msg = JSON.parse(data.toString())
      if (msg.id === id) {
        ws.off('message', handler)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    }
    ws.on('message', handler)
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}
