/**
 * ThreadStore — Thread 持久化存储
 *
 * 使用 Neon PostgreSQL 作为主存储，JSON 文件作为备份。
 * 当数据库不可用时，自动降级到 JSON 文件存储。
 */

import { readFile, writeFile, unlink } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { readdir } from 'fs/promises'
import { getDb, isDbAvailable } from '../db/connection.js'
import type { Thread } from '../types.js'

export class ThreadStore {
	private dataDir: string
	private useDb: boolean = true

	constructor(dataDir?: string) {
		this.dataDir = dataDir || './chitu-data/threads'
		if (!existsSync(this.dataDir)) {
			mkdirSync(this.dataDir, { recursive: true })
		}
	}

	/** 保存 Thread（PostgreSQL 主存储 + JSON 备份） */
	async save(thread: Thread): Promise<void> {
		// 尝试写入数据库
		if (this.useDb) {
			try {
				const sql = getDb()
				await sql`
					INSERT INTO threads (id, title, status, items, current_plan, created_at, updated_at, owner_id, org_id)
					VALUES (
						${thread.id},
						${thread.title || 'Untitled'},
						${thread.status},
						${JSON.stringify(thread.items || [])}::jsonb,
						${thread.currentPlan ? JSON.stringify(thread.currentPlan) : null}::jsonb,
						${thread.createdAt},
						${thread.updatedAt},
						${thread.ownerId || null},
						${thread.orgId || null}
					)
					ON CONFLICT (id) DO UPDATE SET
						title = EXCLUDED.title,
						status = EXCLUDED.status,
						items = EXCLUDED.items,
						current_plan = EXCLUDED.current_plan,
						updated_at = EXCLUDED.updated_at,
						owner_id = EXCLUDED.owner_id,
						org_id = EXCLUDED.org_id
				`
			} catch (err: any) {
				console.warn(`[ThreadStore] 数据库写入失败，降级到文件: ${err.message}`)
				this.useDb = false
			}
		}

		// JSON 文件备份
		try {
			const filePath = `${this.dataDir}/${thread.id}.json`
			await writeFile(filePath, JSON.stringify(thread, null, 2), 'utf-8')
		} catch (err: any) {
			console.warn(`[ThreadStore] JSON 备份写入失败: ${err.message}`)
		}
	}

	/** 加载 Thread（优先从数据库，降级从文件） */
	async load(threadId: string): Promise<Thread | undefined> {
		// 尝试从数据库加载
		if (this.useDb) {
			try {
				const sql = getDb()
				const rows = await sql`
					SELECT id, title, status, items, current_plan, created_at, updated_at, owner_id, org_id
					FROM threads WHERE id = ${threadId}
				` as any[]
				if (rows.length > 0) {
					return this.rowToThread(rows[0])
				}
			} catch (err: any) {
				console.warn(`[ThreadStore] 数据库读取失败，降级到文件: ${err.message}`)
				this.useDb = false
			}
		}

		// 降级：从 JSON 文件加载
		const filePath = `${this.dataDir}/${threadId}.json`
		if (!existsSync(filePath)) return undefined
		const raw = await readFile(filePath, 'utf-8')
		return JSON.parse(raw) as Thread
	}

	/** 列出所有 Thread（摘要信息) */
	async list(): Promise<Array<{ id: string; title: string; updatedAt: number }>> {
		// 尝试从数据库列出
		if (this.useDb) {
			try {
				const sql = getDb()
				const rows = await sql`
					SELECT id, title, updated_at
					FROM threads ORDER BY updated_at DESC
				` as any[]

				return rows.map(row => ({
					id: row.id,
					title: row.title || 'Untitled',
					updatedAt: row.updated_at,
				}))
			} catch (err: any) {
				console.warn(`[ThreadStore] 数据库列出失败，降级到文件: ${err.message}`)
				this.useDb = false
			}
		}

		// 降级：从 JSON 文件列出
		if (!existsSync(this.dataDir)) return []

		const files = await readdir(this.dataDir)
		const threads: Array<{ id: string; title: string; updatedAt: number }> = []

		for (const file of files) {
			if (!file.endsWith('.json')) continue
			try {
				const raw = await readFile(`${this.dataDir}/${file}`, 'utf-8')
				const data = JSON.parse(raw) as Thread
				threads.push({
					id: data.id,
					title: data.title || 'Untitled',
					updatedAt: data.updatedAt || 0,
				})
			} catch {
				continue
			}
		}

		return threads.sort((a, b) => b.updatedAt - a.updatedAt)
	}

	/** 删除 Thread */
	async delete(threadId: string): Promise<void> {
		// 从数据库删除
		if (this.useDb) {
			try {
				const sql = getDb()
				await sql`DELETE FROM threads WHERE id = ${threadId}`
			} catch (err: any) {
				console.warn(`[ThreadStore] 数据库删除失败: ${err.message}`)
				this.useDb = false
			}
		}

		// 删除 JSON 备份
		const filePath = `${this.dataDir}/${threadId}.json`
		if (existsSync(filePath)) {
			await unlink(filePath)
		}
	}

	/** 数据库行转 Thread 对象 */
	private rowToThread(row: any): Thread {
		const items = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || [])
		const currentPlan = row.current_plan
			? (typeof row.current_plan === 'string' ? JSON.parse(row.current_plan) : row.current_plan)
			: undefined

		return {
			id: row.id,
			title: row.title || 'Untitled',
			status: row.status || 'created',
			items,
			currentPlan,
			createdAt: Number(row.created_at),
			updatedAt: Number(row.updated_at),
			ownerId: row.owner_id || undefined,
			orgId: row.org_id || undefined,
		}
	}
}
