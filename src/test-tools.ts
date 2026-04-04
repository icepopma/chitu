/**
 * 测试脚本：验证 Tool 系统
 *
 * 运行方式：ZHIPU_API_KEY=xxx npx tsx src/test-tools.ts
 *
 * 测试流程：
 * 1. 把 exec 工具定义发给 GLM
 * 2. 问 GLM 一个需要执行命令的问题
 * 3. GLM 应该返回 tool_call，我们要执行它
 * 4. 把结果发回给 GLM
 *
 * 注意：这里还不是 Agent Loop！只是手动模拟了一次循环。
 * Agent Loop 会在下一步自动完成这个循环。
 */

import { LLMClient } from './llm/client.js'
import { createToolRegistry } from './tools/index.js'

async function main() {
  console.log('=== 第二步：测试 Tool 系统 ===\n')

  const client = new LLMClient()
  const registry = createToolRegistry()

  console.log('已注册工具:', registry.list().map(t => t.name))
  console.log('工具定义数量:', registry.toDefinitions().length)

  // 1. 问 GLM 一个需要执行命令的问题
  console.log('\n--- 给 GLM 发送工具定义 + 问题 ---')
  const response = await client.chat(
    [
      {
        role: 'system',
        content: '你是一个助手，可以通过执行 shell 命令来帮助用户。请使用 exec 工具来完成任务。',
      },
      {
        role: 'user',
        content: '帮我看看当前目录下有哪些文件？',
      },
    ],
    registry.toDefinitions(),
  )

  // 2. 检查 GLM 是否返回了工具调用
  if (!response.tool_calls || response.tool_calls.length === 0) {
    console.log('GLM 直接回复了（没有调工具）:', response.content)
    console.log('\n⚠️  预期 GLM 应该调用 exec 工具')
    return
  }

  console.log(`✓ GLM 返回了 ${response.tool_calls.length} 个工具调用`)

  // 3. 执行每个工具调用
  for (const tc of response.tool_calls) {
    console.log(`\n工具: ${tc.function.name}`)
    const args = JSON.parse(tc.function.arguments)
    console.log(`参数: ${JSON.stringify(args)}`)

    const tool = registry.get(tc.function.name)
    if (!tool) {
      console.log(`❌ 未知工具: ${tc.function.name}`)
      continue
    }

    console.log('执行中...')
    const result = await tool.execute(args)
    console.log(`结果:\n${result.content.slice(0, 500)}`)
    console.log(`是否出错: ${result.isError ? '是' : '否'}`)

    // 4. 把结果发回给 GLM，让它生成最终回复
    console.log('\n--- 把工具结果发回给 GLM ---')
    const finalResponse = await client.chat([
      {
        role: 'system',
        content: '你是一个助手，可以通过执行 shell 命令来帮助用户。',
      },
      {
        role: 'user',
        content: '帮我看看当前目录下有哪些文件？',
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: response.tool_calls,
      },
      {
        role: 'tool',
        tool_call_id: tc.id,
        content: result.content,
      },
    ])

    console.log('GLM 最终回复:', finalResponse.content)
  }

  console.log('\n=== 测试完成 ===')
  console.log('✓ Tool 定义 → GLM → tool_call → 执行 → 结果发回 → 最终回复')
  console.log('✓ 这就是 Agent Loop 的一次循环！')
}

main().catch(err => {
  console.error('❌ 测试失败:', err.message)
  process.exit(1)
})
