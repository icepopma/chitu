/**
 * 测试脚本：验证事件系统
 *
 * 运行方式：npx tsx src/test-events.ts
 *
 * 验证 ThreadManager 在 runTurn 过程中 emit 的事件序列
 * 对齐 Codex App Server 协议
 */

import 'dotenv/config'
import { ThreadManager } from './thread/manager.js'
import type { AppEvent } from './types.js'

async function main() {
  console.log('=== 事件系统测试 ===\n')

  const manager = new ThreadManager('./test-data/threads')

  // 收集所有事件
  const events: AppEvent[] = []
  manager.onEvent((event) => {
    events.push(event)
  })

  // 创建线程
  console.log('1. 创建线程...')
  const thread = await manager.create('事件测试')
  console.log(`   thread/started: ${thread.id}\n`)

  // 运行一轮对话
  console.log('2. 运行对话...')
  const task = '请用 exec 命令执行 echo "Hello Events!" 然后告诉我结果'

  const result = await manager.runTurn(thread.id, task, {
    maxIterations: 10,
  })

  console.log(`   Agent 回复: ${result.content.slice(0, 100)}`)
  console.log(`   Turn 状态: ${result.turn.status}\n`)

  // 验证事件序列
  console.log('3. 事件序列（应该对齐 Codex 协议）：')
  console.log('   ─────────────────────────────────')
  for (const event of events) {
    switch (event.type) {
      case 'thread/started':
        console.log(`   thread/started         → 线程 ${event.thread.id.slice(0, 8)}`)
        break
      case 'turn/started':
        console.log(`   turn/started           → Turn ${event.turn.id.slice(0, 8)}`)
        break
      case 'item/started':
        console.log(`   item/started           → ${event.item.type}`)
        break
      case 'item/completed':
        const preview = event.item.content.slice(0, 40).replace(/\n/g, ' ')
        const tool = event.item.toolName ? ` [${event.item.toolName}]` : ''
        console.log(`   item/completed         → ${event.item.type}${tool}: ${preview}...`)
        break
      case 'turn/completed':
        console.log(`   turn/completed         → ${event.turn.status}`)
        break
    }
  }
  console.log('   ─────────────────────────────────\n')

  // 验证事件顺序是否符合 Codex 协议
  console.log('4. 验证事件顺序：')
  const checks = [
    { name: '第一个事件是 thread/started', pass: events[0]?.type === 'thread/started' },
    { name: '第二个事件是 turn/started', pass: events[1]?.type === 'turn/started' },
    { name: 'turn/started 后紧跟 item/started (user_message)', pass: events[2]?.type === 'item/started' && events[2]?.item.type === 'user_message' },
    { name: '有 item/started (tool_call)', pass: events.some(e => e.type === 'item/started' && e.item.type === 'tool_call') },
    { name: '有 item/completed (tool_result)', pass: events.some(e => e.type === 'item/completed' && e.item.type === 'tool_result') },
    { name: '有 item/completed (assistant_message)', pass: events.some(e => e.type === 'item/completed' && e.item.type === 'assistant_message') },
    { name: '最后一个事件是 turn/completed', pass: events[events.length - 1]?.type === 'turn/completed' },
  ]

  for (const check of checks) {
    console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`)
  }

  const allPass = checks.every(c => c.pass)
  console.log(`\n   总计: ${checks.filter(c => c.pass).length}/${checks.length} 通过`)

  // 清理
  await manager.deleteThread(thread.id)

  console.log(`\n=== ${allPass ? '测试通过' : '测试失败'} ===`)
  if (!allPass) process.exit(1)
}

main().catch(err => {
  console.error('❌ 测试失败:', err.message)
  process.exit(1)
})
