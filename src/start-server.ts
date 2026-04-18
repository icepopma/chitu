/**
 * 启动 App Server
 * npx tsx src/start-server.ts
 */

import 'dotenv/config'
import { createAppServer } from './server/index.js'
import { loadConfig, validateConfig, formatValidationErrors } from './config/index.js'

const result = loadConfig()
const errors = validateConfig(result.config)

if (errors.length > 0) {
	console.error(formatValidationErrors(errors))
	// API Key 缺失是致命错误，其他只是警告
	const apiKeyMissing = errors.some(e => e.field === 'llm.apiKey')
	if (apiKeyMissing) {
		console.error('致命错误：API Key 未设置，无法启动。')
		process.exit(1)
	}
}

if (result.warnings.length > 0) {
	for (const w of result.warnings) {
		console.warn(`[config] ${w}`)
	}
}

console.log('[config] 配置来源：')
for (const [path, source] of Object.entries(result.sources)) {
	if (source !== 'default') {
		console.log(`  ${path} ← ${source}`)
	}
}

createAppServer({ port: result.config.server.port, dataDir: result.config.server.dataDir })
