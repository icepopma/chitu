/**
 * 测试脚本：验证 WebSocket App Server 端到端流程
 *
 * 运行方式：npx tsx src/test-server.ts
 *
 * 测试完整消息流（对齐 Codex 协议）：
 * 1. initialize 握手
 * 2. thread/create
 * 3. turn/start（异步，立即返回）
 * 4. 收到事件通知：turn/started → item/started/completed → turn/completed
 * 5. 验证所有通知都收到了
 */

import 'dotenv/config'
import WebSocket from 'ws'
import { createAppServer } from './server/index.js'

// 收到的所有通知
const notifications: Array<{ method: string; params: any }> = []
let rpcId = 0

/** 发送 JSON-RPC 请求 */
function sendRequest(ws: WebSocket, method: string, params?: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++rpcId
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for response to ${method}`)), 30000)

    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString())
      // 如果是针对这个 id 的 response
      if (msg.id === id && msg.result !== undefined) {
        clearTimeout(timeout)
        ws.off('message', handler)
        resolve(msg.result)
      }
      // 如果是错误
      if (msg.id === id && msg.error) {
        clearTimeout(timeout)
        ws.off('message', handler)
        reject(new Error(`RPC error: ${msg.error.message}`))
      }
    }
    ws.on('message', handler)
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }))
  })
}

/** 等待特定通知 */
function waitForNotification(method: string, timeout = 60000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${method}`)), timeout)

    // 先检查已收到的
    const existing = notifications.find(n => n.method === method)
    if (existing) {
      clearTimeout(timer)
      resolve(existing.params)
      return
    }

    // 等待新的
    const interval = setInterval(() => {
      const found = notifications.find(n => n.method === method)
      if (found) {
        clearTimeout(timer)
        clearInterval(interval)
        resolve(found.params)
      }
    }, 100)
  })
}

async function main() {
  console.log('=== Step 6：WebSocket App Server 端到端测试 ===\n')

  // 1. 启动服务器（随机端口避免冲突）
  const testPort = 18080 + Math.floor(Math.random() * 1000)
  const { wss, manager } = createAppServer({ port: testPort, dataDir: './test-data/threads' })

  // 2. 收集所有通知
  const ws = new WebSocket(`ws://localhost:${testPort}`)

  await new Promise<void>(resolve => ws.on('open', resolve))

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (!msg.id && msg.method) {
      notifications.push({ method: msg.method, params: msg.params })
      console.log(`   ← 通知: ${msg.method}`)
    }
  })

  // 3. initialize 握手
  console.log('1. initialize 握手...')
  const initResult = await sendRequest(ws, 'initialize', {
    protocolVersion: '1.0.0',
    clientInfo: { name: 'test-client', version: '0.1.0' },
  })
  console.log(`   → 协议版本: ${initResult.protocolVersion}`)
  console.log(`   → 服务器: ${initResult.serverInfo.name}\n`)

  // 4. thread/create
  console.log('2. thread/create...')
  const { thread } = await sendRequest(ws, 'thread/create', { title: '测试线程' })
  console.log(`   → 线程 ID: ${thread.id}`)
  console.log(`   → 标题: ${thread.title}\n`)

  // 5. turn/start（异步，立即返回）
  console.log('3. turn/start（异步）...')
  const turnResult = await sendRequest(ws, 'turn/start', {
    threadId: thread.id,
    message: '请用 exec 命令执行 echo "Hello from WebSocket!" 然后告诉我结果',
  })
  console.log(`   → 立即返回: threadId=${turnResult.threadId}, status=${turnResult.status}`)
  console.log('   （Agent Loop 在后台运行...）\n')

  // 6. 等待事件通知
  console.log('4. 等待事件通知...')

  // 等待 turn/completed
  const completedParams = await waitForNotification('turn/completed')
  console.log(`\n   turn/completed → status: ${completedParams.turn.status}`)

  // 7. 验证通知序列
  console.log('\n5. 验证通知序列：')
  const checks = [
    { name: '有 thread/started (来自 thread/create)', pass: notifications.some(n => n.method === 'thread/started') },
    { name: '有 turn/started', pass: notifications.some(n => n.method === 'turn/started') },
    { name: '有 item/started (user_message)', pass: notifications.some(n => n.method === 'item/started' && n.params?.item?.type === 'user_message') },
    { name: '有 item/completed (tool_call)', pass: notifications.some(n => n.method === 'item/completed' && n.params?.item?.type === 'tool_call') },
    { name: '有 item/completed (tool_result)', pass: notifications.some(n => n.method === 'item/completed' && n.params?.item?.type === 'tool_result') },
    { name: '有 item/completed (assistant_message)', pass: notifications.some(n => n.method === 'item/completed' && n.params?.item?.type === 'assistant_message') },
    { name: '有 turn/completed', pass: notifications.some(n => n.method === 'turn/completed') },
  ]

  for (const check of checks) {
    console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`)
  }

  const allPass = checks.every(c => c.pass)
  console.log(`\n   总计: ${checks.filter(c => c.pass).length}/${checks.length} 通过`)

  // 8. thread/list
  console.log('\n6. thread/list...')
  const { threads } = await sendRequest(ws, 'thread/list')
  console.log(`   → ${threads.length} 个线程`)

  // 清理
  ws.close()
  wss.close()
  // 清理测试数据
  await manager.deleteThread(thread.id)

  console.log(`\n=== ${allPass ? '测试通过 ✅' : '测试失败 ❌'} ===`)
  if (!allPass) process.exit(1)
}

main().catch(err => {
  console.error('❌ 测试失败:', err.message)
  process.exit(1)
})
