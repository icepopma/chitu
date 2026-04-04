/**
 * 测试脚本：验证 Agent Loop
 *
 * 运行方式：npx tsx src/test-agent-loop.ts
 *
 * 这次不用手动模拟了！给 Agent 一个任务，它自己循环直到完成。
 */

import 'dotenv/config'
import { LLMClient } from './llm/client.js'
import { createToolRegistry } from './tools/index.js'
import { runAgentLoop } from './agent/loop.js'

async function main() {
  console.log('=== 第三步：Agent Loop 测试 ===\n')

  const client = new LLMClient()
  const registry = createToolRegistry()

  // 测试 1：简单任务（应该 1-2 轮就完成）
  console.log('--- 测试 1：简单任务 ---')
  console.log('任务: "列出当前目录的文件，然后告诉我有哪些"\n')

  const result1 = await runAgentLoop(
    '列出当前目录的文件，然后告诉我有哪些',
    {
      client,
      tools: registry.list(),
      systemPrompt: '你是一个助手，可以通过执行 shell 命令来帮助用户完成任务。用中文回复。',
      maxIterations: 10,
      onStep(step) {
        console.log(`[循环第 ${step.iteration} 轮]`)
        if (step.toolCalls) {
          for (const tc of step.toolCalls) {
            console.log(`  → 调用工具: ${tc.function.name}(${tc.function.arguments})`)
          }
        }
        if (step.toolResults) {
          for (const tr of step.toolResults) {
            console.log(`  ← 工具结果 (${tr.toolName}): ${tr.result.slice(0, 100)}...`)
          }
        }
        if (step.content) {
          console.log(`  ✓ 最终回复: ${step.content.slice(0, 200)}`)
        }
      },
    },
  )

  console.log(`\n结果: 循环了 ${result1.iterations} 次, 用了 ${result1.totalTokens} tokens`)
  console.log(`最终回复:\n${result1.content}\n`)

  // 测试 2：多步任务（需要 2+ 轮循环）
  console.log('\n--- 测试 2：多步任务 ---')
  console.log('任务: "看看 package.json 的内容，然后告诉我项目名叫什么、用了什么框架"\n')

  const result2 = await runAgentLoop(
    '看看 package.json 的内容，然后告诉我项目名叫什么、用了什么框架',
    {
      client,
      tools: registry.list(),
      systemPrompt: '你是一个助手，可以通过执行 shell 命令来帮助用户完成任务。用中文回复。',
      maxIterations: 10,
      onStep(step) {
        console.log(`[循环第 ${step.iteration} 轮]`)
        if (step.toolCalls) {
          for (const tc of step.toolCalls) {
            console.log(`  → 调用工具: ${tc.function.name}(${tc.function.arguments})`)
          }
        }
        if (step.content) {
          console.log(`  ✓ 最终回复: ${step.content.slice(0, 200)}`)
        }
      },
    },
  )

  console.log(`\n结果: 循环了 ${result2.iterations} 次, 用了 ${result2.totalTokens} tokens`)
  console.log(`最终回复:\n${result2.content}\n`)

  console.log('=== 测试完成 ===')
  console.log('✓ Agent 能自主循环直到任务完成')
  console.log('✓ 这就是 Agent Loop —— Agent 的心脏')
}

main().catch(err => {
  console.error('❌ 测试失败:', err.message)
  process.exit(1)
})
