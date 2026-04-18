/**
 * PostgresMemoryStorage — 基于 Neon PostgreSQL 的记忆存储
 *
 * 替代原来的 JSON 文件存储。保持相同的接口。
 *
 * 学习重点：
 * - 关系型存储 vs 文件存储：支持按类别查询、去重更高效
 * - 上限控制：防止记忆表无限增长
 */

import { randomUUID } from 'crypto'
import { getDb, isDbAvailable } from '../db/connection.js'
import { MemoryStorage as JsonMemoryStorage, type Memory, type MemoryCategory } from './storage.js'

/** 记忆数量上限 */
const MAX_MEMORIES = 100

/** 注入到对话中的记忆数量上限 */
const MAX_INJECTED = 20

/** 单条记忆内容最大长度 */
const MAX_CONTENT_LENGTH = 500

export interface IMemoryStorage {
	load(): Promise<Memory[]>
	save(memories: Memory[]): Promise<void>
	addMemories(newMemories: Omit<Memory, 'id' | 'createdAt'>[]): Promise<Memory[]>
	formatForInjection(memories: Memory[]): string | null
	clear(): Promise<void>
}

/** PostgreSQL 实现的 MemoryStorage */
class PostgresMemoryStorage implements IMemoryStorage {
	async load(): Promise<Memory[]> {
		const sql = getDb()
		const rows = await sql`
			SELECT id, category, content, source_thread_id, created_at
			FROM memories
			ORDER BY created_at ASC
		` as any[]
		return rows.map((r: any) => ({
			id: r.id as string,
			category: r.category as MemoryCategory,
			content: r.content as string,
			sourceThreadId: r.source_thread_id as string,
			createdAt: Number(r.created_at),
		}))
	}

	async save(memories: Memory[]): Promise<void> {
		const sql = getDb()
		const trimmed = memories.length > MAX_MEMORIES
			? memories.slice(-MAX_MEMORIES)
			: memories

		// 清空再重新插入（简单但有效）
		await sql`DELETE FROM memories`
		for (const mem of trimmed) {
			await sql`
				INSERT INTO memories (id, category, content, source_thread_id, created_at)
				VALUES (${mem.id}, ${mem.category}, ${mem.content}, ${mem.sourceThreadId}, ${mem.createdAt})
			`
		}
	}

	async addMemories(newMemories: Omit<Memory, 'id' | 'createdAt'>[]): Promise<Memory[]> {
		const sql = getDb()
		const existing = await this.load()
		const added: Memory[] = []

		for (const mem of newMemories) {
			const newNormalized = mem.content.toLowerCase().trim()

			// 检查去重（数据库层面）
			const duplicates = await sql`
				SELECT id FROM memories
				WHERE category = ${mem.category}
				AND (LOWER(TRIM(content)) = ${newNormalized}
					OR LOWER(TRIM(content)) LIKE ${'%' + newNormalized + '%'}
					OR ${newNormalized} LIKE '%' || LOWER(TRIM(content)) || '%')
			` as any[]
			if (duplicates.length > 0) continue

			const memory: Memory = {
				id: randomUUID(),
				category: mem.category,
				content: mem.content.slice(0, MAX_CONTENT_LENGTH),
				sourceThreadId: mem.sourceThreadId,
				createdAt: Date.now(),
			}

			await sql`
				INSERT INTO memories (id, category, content, source_thread_id, created_at)
				VALUES (${memory.id}, ${memory.category}, ${memory.content}, ${memory.sourceThreadId}, ${memory.createdAt})
			`
			added.push(memory)
		}

		// 超过上限时删除最旧的
		const count = await sql`SELECT COUNT(*) as cnt FROM memories` as any[]
		const total = Number(count[0].cnt)
		if (total > MAX_MEMORIES) {
			await sql`
				DELETE FROM memories WHERE id IN (
					SELECT id FROM memories ORDER BY created_at ASC LIMIT ${total - MAX_MEMORIES}
				)
			`
		}

		return added
	}

	formatForInjection(memories: Memory[]): string | null {
		if (memories.length === 0) return null

		const toInject = memories.slice(-MAX_INJECTED)

		const lines: string[] = [
			'# Memories from previous conversations',
			'The following are things learned from previous conversations. Use them to be more effective.',
			'',
		]

		const grouped = new Map<MemoryCategory, Memory[]>()
		for (const m of toInject) {
			const group = grouped.get(m.category)
			if (group) {
				group.push(m)
			} else {
				grouped.set(m.category, [m])
			}
		}

		const categoryLabels: Record<MemoryCategory, string> = {
			preference: 'User Preferences',
			architecture: 'Architecture Decisions',
			convention: 'Project Conventions',
			failure: 'Known Issues & Fixes',
			fact: 'Key Facts',
		}

		for (const [category, items] of grouped) {
			lines.push(`## ${categoryLabels[category]}`)
			for (const item of items) {
				lines.push(`- ${item.content}`)
			}
			lines.push('')
		}

		return lines.join('\n')
	}

	async clear(): Promise<void> {
		const sql = getDb()
		await sql`DELETE FROM memories`
	}
}

/**
 * 创建 MemoryStorage — 自动选择 PostgreSQL 或 JSON 文件
 */
export async function createMemoryStorage(): Promise<IMemoryStorage | JsonMemoryStorage> {
	const dbAvailable = await isDbAvailable()
	if (dbAvailable) {
		console.log('[memories] 使用 PostgreSQL 存储')
		return new PostgresMemoryStorage()
	}
	console.warn('[memories] 数据库不可用，降级为 JSON 文件存储')
	return new JsonMemoryStorage()
}
