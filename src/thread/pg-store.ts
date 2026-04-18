/**
 * PostgresThreadStore — 基于 Neon PostgreSQL 的 Thread 存储
 *
 * 替代原来的 JSON 文件存储。保持相同的接口，无缝切换。
 * 数据库不可用时自动降级为 JSON 文件存储。
 *
 * 学习重点：
 * - 适配器模式：相同的接口，不同的底层实现
 * - JSONB 存储 items 数组，兼顾灵活性和查询能力
 * - 优雅降级：数据库不可用时不影响基本功能
 */

import type { Thread } from '../types.js'
import { getDb, isDbAvailable } from '../db/connection.js'
import { ThreadStore as JsonThreadStore } from './store.js'

export interface IThreadStore {
	save(thread: Thread): Promise<void>
	load(threadId: string): Promise<Thread | undefined>
	list(): Promise<Array<{ id: string; title: string; updatedAt: number }>>
	delete(threadId: string): Promise<void>
}

/** PostgreSQL 实现的 ThreadStore */
class PostgresThreadStore implements IThreadStore {
	async save(thread: Thread): Promise<void> {
		const sql = getDb()
		await sql`
			INSERT INTO threads (id, title, status, items, current_plan, created_at, updated_at)
			VALUES (
				${thread.id},
				${thread.title},
				${thread.status},
				${JSON.stringify(thread.items)}::jsonb,
				${thread.currentPlan ? JSON.stringify(thread.currentPlan) : null}::jsonb,
				${thread.createdAt},
				${thread.updatedAt}
			)
			ON CONFLICT (id) DO UPDATE SET
				title = EXCLUDED.title,
				status = EXCLUDED.status,
				items = EXCLUDED.items,
				current_plan = EXCLUDED.current_plan,
				updated_at = EXCLUDED.updated_at
		`
	}

	async load(threadId: string): Promise<Thread | undefined> {
		const sql = getDb()
		const rows = await sql`
			SELECT id, title, status, items, current_plan, created_at, updated_at
			FROM threads WHERE id = ${threadId}
		` as any[]
		if (rows.length === 0) return undefined
		return this.rowToThread(rows[0])
	}

	async list(): Promise<Array<{ id: string; title: string; updatedAt: number }>> {
		const sql = getDb()
		const rows = await sql`
			SELECT id, title, updated_at FROM threads
			ORDER BY updated_at DESC
		` as any[]
		return rows.map((r: any) => ({
			id: r.id as string,
			title: r.title as string,
			updatedAt: Number(r.updated_at),
		}))
	}

	async delete(threadId: string): Promise<void> {
		const sql = getDb()
		await sql`DELETE FROM threads WHERE id = ${threadId}`
	}

	private rowToThread(row: Record<string, unknown>): Thread {
		return {
			id: row.id as string,
			title: row.title as string,
			status: row.status as Thread['status'],
			items: typeof row.items === 'string' ? JSON.parse(row.items) : (row.items as Thread['items']),
			currentPlan: row.current_plan
				? (typeof row.current_plan === 'string' ? JSON.parse(row.current_plan) : row.current_plan) as Thread['currentPlan']
				: undefined,
			createdAt: Number(row.created_at),
			updatedAt: Number(row.updated_at),
		}
	}
}

/**
 * 创建 ThreadStore — 自动选择 PostgreSQL 或 JSON 文件
 *
 * 数据库可用时使用 PostgreSQL，否则降级到 JSON 文件
 */
export async function createThreadStore(dataDir?: string): Promise<IThreadStore> {
	const dbAvailable = await isDbAvailable()
	if (dbAvailable) {
		console.log('[store] 使用 PostgreSQL 存储')
		return new PostgresThreadStore()
	}
	console.warn('[store] 数据库不可用，降级为 JSON 文件存储')
	return new JsonThreadStore(dataDir)
}
