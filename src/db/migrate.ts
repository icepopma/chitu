/**
 * 数据库迁移脚本
 *
 * 创建 threads、rollout_events、memories 表。
 * 支持幂等执行（IF NOT EXISTS）。
 *
 * 运行方式：npx tsx src/db/migrate.ts
 */

import { getDb } from './connection.js'

const MIGRATIONS = [
	{
		name: '001_create_threads',
		sql: `
			CREATE TABLE IF NOT EXISTS threads (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL DEFAULT 'Untitled',
				status TEXT NOT NULL DEFAULT 'created',
				items JSONB NOT NULL DEFAULT '[]',
				current_plan JSONB,
				created_at BIGINT NOT NULL,
				updated_at BIGINT NOT NULL
			);
		`,
	},
	{
		name: '002_create_rollout_events',
		sql: `
			CREATE TABLE IF NOT EXISTS rollout_events (
				id SERIAL PRIMARY KEY,
				thread_id TEXT NOT NULL,
				event_type TEXT NOT NULL,
				event_data JSONB NOT NULL,
				created_at BIGINT NOT NULL,
				FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS idx_rollout_events_thread_id ON rollout_events(thread_id);
			CREATE INDEX IF NOT EXISTS idx_rollout_events_created_at ON rollout_events(created_at);
		`,
	},
	{
		name: '003_create_memories',
		sql: `
			CREATE TABLE IF NOT EXISTS memories (
				id TEXT PRIMARY KEY,
				category TEXT NOT NULL,
				content TEXT NOT NULL,
				source_thread_id TEXT NOT NULL,
				created_at BIGINT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
			CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
		`,
	},
	{
		name: '004_create_threads_updated_at_index',
		sql: `
			CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at);
		`,
	},
	{
		name: '005_create_active_turns',
		sql: `
			CREATE TABLE IF NOT EXISTS active_turns (
				turn_id TEXT PRIMARY KEY,
				thread_id TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'in_progress',
				started_at BIGINT NOT NULL,
				completed_at BIGINT,
				env_snapshot JSONB,
				created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
				FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS idx_active_turns_thread_id ON active_turns(thread_id);
			CREATE INDEX IF NOT EXISTS idx_active_turns_status ON active_turns(status);
		`,
	},
]

export async function runMigrations(): Promise<void> {
	const sql = getDb()

	for (const migration of MIGRATIONS) {
		console.log(`[db] 运行迁移: ${migration.name}`)
		try {
			await sql.unsafe(migration.sql)
			console.log(`[db] ✅ ${migration.name} 完成`)
		} catch (err: any) {
			// 已经存在不算错误
			if (err.message?.includes('already exists')) {
				console.log(`[db] ⏭️ ${migration.name} 已存在，跳过`)
			} else {
				console.error(`[db] ❌ ${migration.name} 失败:`, err.message)
				throw err
			}
		}
	}

	console.log('[db] 所有迁移完成')
}

// 直接运行
if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') || '')) {
	runMigrations()
		.then(() => process.exit(0))
		.catch(err => {
			console.error('[db] 迁移失败:', err)
			process.exit(1)
		})
}
