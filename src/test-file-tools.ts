/**
 * 测试脚本：验证 Agent 用文件工具自主完成任务
 *
 * 运行方式：npx tsx src/test-file-tools.ts
 *
 * Agent 会自主完成一个多步任务：
 * 1. 创建一个文件
 * 2. 修改文件内容
 * 3. 读回文件验证
 * 4. 报告结果
 */

import 'dotenv/config'
import { LLMClient } from './llm/client.js'
import { createToolRegistry } from './tools/index.js'
import { runAgentLoop } from './agent/loop.js'

async function main() {
  console.log('=== 第四步：文件工具 + Agent Loop 测试 ===\n')

  const client = new LLMClient()
  const registry = createToolRegistry()

  console.log('已注册工具:', registry.list().map(t => t.name))
  console.log()

  const task = `请完成以下任务：
1. 先用 exec 创建目录 /tmp/chitu-test/
2. 用 write_file 创建文件 /tmp/chitu-test/hello.txt，内容写 "Hello from Chitu Agent!"
3. 用 edit_file 把 "Hello" 替换成 "你好"
4. 用 read_file 读取文件内容，确认修改成功
5. 告诉我最终文件的内容是什么`

  console.log('任务:\n' + task + '\n')

  const result = await runAgentLoop(task, {
    client,
    tools: registry.list(),
    systemPrompt: '你是一个自主 Agent，可以通过工具完成用户的任务。用中文回复。',
    maxIterations: 15,
    onStep(step) {
      console.log(`[循环第 ${step.iteration} 轮]`)
      if (step.toolCalls) {
        for (const tc of step.toolCalls) {
          const args = JSON.parse(tc.function.arguments)
          const display = tc.function.name === 'exec'
            ? (args.command as string)?.slice(0, 80)
            : JSON.stringify(args).slice(0, 100)
          console.log(`  → ${tc.function.name}(${display})`)
        }
      }
      if (step.toolResults) {
        for (const tr of step.toolResults) {
          const preview = tr.result.slice(0, 80).replace(/\n/g, ' ')
          console.log(`  ← ${tr.toolName}: ${preview}${tr.result.length > 80 ? '...' : ''}`)
        }
      }
      if (step.content && !step.toolCalls) {
        console.log(`  ✓ 最终回复: ${step.content.slice(0, 300)}`)
      }
    },
  })

  console.log(`\n========== 结果 ==========`)
  console.log(`循环次数: ${result.iterations}`)
  console.log(`Token 用量: ${result.totalTokens}`)
  console.log(`\nAgent 最终回复:\n${result.content}`)
  console.log('\n=== 测试完成 ===')
}

main().catch(err => {
  console.error('❌ 测试失败:', err.message)
  process.exit(1)
})
