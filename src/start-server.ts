/**
 * 启动 App Server
 * npx tsx src/start-server.ts
 */

import 'dotenv/config'
import { createAppServer } from './server/index.js'
import { loadConfig, validateConfig, formatValidationErrors } from './config/index.js'
import { runMigrations } from './db/migrate.js'
import { isDbAvailable } from './db/connection.js'
import { recoverInterruptedTurns } from './db/crash-recovery.js'

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

// M3: 自动运行数据库迁移（如果 NEON_DATABASE_URL 配置了）
if (process.env.NEON_DATABASE_URL) {
	const dbOk = await isDbAvailable()
	if (dbOk) {
		console.log('[db] Neon PostgreSQL 可用，运行迁移...')
		try {
			await runMigrations()
			console.log('[db] ✅ 迁移完成')
		} catch (err: any) {
			console.warn(`[db] ⚠️ 迁移失败，将降级到文件存储: ${err.message}`)
		}
	} else {
		console.warn('[db] ⚠️ 数据库连接失败，将降级到文件存储')
	}

	// M4: Crash Recovery — 扫描未完成的 turn 并标记为 interrupted
	console.log('[crash-recovery] 扫描未完成的 turn...')
	try {
		const interrupted = await recoverInterruptedTurns()
		if (interrupted.length > 0) {
			console.log(`[crash-recovery] ⚠️ 发现 ${interrupted.length} 个未完成的 turn，已标记为 interrupted:`)
			for (const t of interrupted) {
				console.log(`  turn=${t.turnId.slice(0, 8)}... thread=${t.threadId.slice(0, 8)}... started=${new Date(t.startedAt).toISOString()}`)
			}
		} else {
			console.log('[crash-recovery] ✅ 无未完成的 turn')
		}
	} catch (err: any) {
		console.warn(`[crash-recovery] ⚠️ 恢复失败（非致命）: ${err.message}`)
	}
} else {
	console.log('[db] NEON_DATABASE_URL 未配置，使用文件存储')
}

const { manager } = createAppServer({ port: result.config.server.port, dataDir: result.config.server.dataDir })

// M4: 启动后恢复 envSnapshots（异步，不阻塞启动）
manager.recoverEnvSnapshots().then(() => {
	console.log('[crash-recovery] ✅ envSnapshots 已从数据库恢复')
}).catch((err: any) => {
	console.warn(`[crash-recovery] ⚠️ envSnapshots 恢复失败（非致命）: ${err.message}`)
})
