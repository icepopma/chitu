/**
 * 配置系统快速验证
 * npx tsx src/test-config.ts
 */

import 'dotenv/config'
import { loadConfig, validateConfig, formatValidationErrors } from './config/index.js'

// 测试 1: 默认加载
const result = loadConfig()
console.log('=== 默认配置 ===')
console.log('port:', result.config.server.port)
console.log('model:', result.config.llm.model)
console.log('maxIterations:', result.config.agent.maxIterations)
console.log()

// 测试 2: 环境变量覆盖优先级
const envOverrides = Object.entries(result.sources).filter(([k, v]) => v === 'env')
console.log('=== 环境变量覆盖项 ===')
for (const [key, src] of envOverrides) {
	console.log(`  ${key} ← ${src}`)
}
console.log()

// 测试 3: 验证
const errors = validateConfig(result.config)
if (errors.length > 0) {
	console.log('=== 验证错误 ===')
	console.log(formatValidationErrors(errors))
} else {
	console.log('✅ 配置验证通过（无 API Key 时有 llm.apiKey 错误是正常的）')
}
console.log()

// 测试 4: CLI 覆盖优先级测试
const result2 = loadConfig({ server: { port: 3000, dataDir: '/tmp/test' } })
console.log('=== CLI 覆盖 ===')
console.log('port:', result2.config.server.port, '(期望 3000)')
console.log('port来源:', result2.sources['server.port'], '(期望 cli)')
console.log()

console.log('✅ 配置系统验证完成')
