/**
 * 测试脚本：验证 GLM-5 API 是否能调通
 *
 * 运行方式：npx tsx src/test-llm.ts
 */

import 'dotenv/config'
import { LLMClient } from './llm/client.js'

async function main() {
  console.log('=== 第一步：调通 GLM-5 API ===\n')

  // 1. 创建客户端
  const client = new LLMClient()
  console.log('✓ 客户端创建成功')

  // 2. 最简单的调用：发一句话，拿回复
  console.log('\n--- 测试 1：纯文字对话 ---')
  const response1 = await client.chat([
    { role: 'user', content: '用一句话解释什么是 Agent（AI 领域）' }
  ])
  console.log('GLM 回复:', response1.content)
  console.log('Token 用量:', response1.usage)

  // 3. 带 function calling 的调用
  console.log('\n--- 测试 2：Function Calling ---')
  const response2 = await client.chat(
    [
      { role: 'system', content: '你是一个助手，可以获取天气信息。' },
      { role: 'user', content: '北京今天天气怎么样？' }
    ],
    [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: '获取指定城市的天气',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string', description: '城市名称' }
            },
            required: ['city']
          }
        }
      }
    ]
  )

  if (response2.tool_calls) {
    console.log('✓ GLM 返回了工具调用！')
    for (const tc of response2.tool_calls) {
      console.log(`  工具名: ${tc.function.name}`)
      console.log(`  参数: ${tc.function.arguments}`)
    }
  } else {
    console.log('GLM 直接回复:', response2.content)
  }

  console.log('\n=== 测试完成 ===')
}

main().catch(err => {
  console.error('❌ 测试失败:', err.message)
  process.exit(1)
})
