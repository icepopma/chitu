/**
 * 测试脚本：验证 ThreadManager
 *
 * 运行方式：npx tsx src/test-thread.ts
 *
 * 测试内容：
 * 1. 创建线程
 * 2. 运行一轮对话（Agent 执行任务）
 * 3. 验证 Thread 里的 Items 记录完整
 * 4. 列出所有线程
 * 5. 归档线程
 */

import 'dotenv/config'
import { ThreadManager } from './thread/manager.js'

async function main() {
  console.log('=== 第五步：Thread/Turn/Item 测试 ===\n')

  const manager = new ThreadManager('./test-data/threads')

  // 1. 创建线程
  console.log('1. 创建线程...')
  const thread = await manager.create('测试线程')
  console.log(`   线程 ID: ${thread.id}`)
  console.log(`   状态: ${thread.status}`)
  console.log(`   Items 数量: ${thread.items.length}`)
  console.log()

  // 2. 运行一轮对话
  console.log('2. 运行对话（Agent 自主执行任务）...')
  const task = '请用 exec 命令执行 echo "Hello from ThreadManager!" 然后告诉我结果'

  const result = await manager.runTurn(thread.id, task, {
    maxIterations: 10,
  })

  console.log()
  console.log('   Agent 回复:', result.content.slice(0, 200))
  console.log(`   循环次数: ${result.iterations}`)
  console.log(`   Token 用量: ${result.totalTokens}`)
  console.log(`   Turn 状态: ${result.turn.status}`)
  console.log()

  // 3. 重新加载线程，验证 Items
  console.log('3. 验证线程 Items...')
  const loaded = await manager.getThread(thread.id)
  if (!loaded) {
    console.error('   ❌ 加载线程失败')
    process.exit(1)
  }

  console.log(`   线程状态: ${loaded.status}`)
  console.log(`   Items 总数: ${loaded.items.length}`)
  console.log()
  console.log('   Items 列表:')
  for (const item of loaded.items) {
    const preview = item.content.slice(0, 60).replace(/\n/g, ' ')
    const extra = item.toolName ? ` [${item.toolName}]` : ''
    console.log(`   - ${item.type}${extra}: ${preview}${item.content.length > 60 ? '...' : ''}`)
  }
  console.log()

  // 4. 列出所有线程
  console.log('4. 列出所有线程:')
  const threads = await manager.listThreads()
  for (const t of threads) {
    console.log(`   - ${t.title} (${t.id.slice(0, 8)}...) 更新于 ${new Date(t.updatedAt).toLocaleString()}`)
  }
  console.log()

  // 5. 归档
  console.log('5. 归档线程...')
  await manager.archive(thread.id)
  const archived = await manager.getThread(thread.id)
  console.log(`   归档后状态: ${archived?.status}`)
  console.log()

  // 清理测试数据
  await manager.deleteThread(thread.id)
  console.log('   已清理测试数据')

  console.log('\n=== 测试完成 ===')
}

main().catch(err => {
  console.error('❌ 测试失败:', err.message)
  process.exit(1)
})
