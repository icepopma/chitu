/**
 * 记忆持久化存储
 *
 * 使用 Neon PostgreSQL 作为主存储。
 * 当数据库不可用时，自动降级到 JSON 文件存储。
 *
 * 对齐 Codex codex-rs/core/src/memories/storage.rs
 * 存储：Neon PostgreSQL（主）+ JSON 文件（降级备份）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'
import { getDb } from '../db/connection.js'

/** 记忆条目 */
export interface Memory {
	id: string
	category: MemoryCategory
	content: string
	sourceThreadId: string
	createdAt: number
}

/** 记忆类别（对齐 Codex memories/prompts.rs 的提取维度） */
export type MemoryCategory =
	| 'preference'
	| 'architecture'
	| 'convention'
	| 'failure'
	| 'fact'

/** JSON 文件存储格式（降级用） */
interface MemoryStore {
	memories: Memory[]
	updatedAt: number
}

/** 记忆数量上限 */
const MAX_MEMORIES = 100

/** 注入到对话中的记忆数量上限（避免上下文膨胀） */
const MAX_INJECTED = 20

/** 单条记忆内容最大长度 */
const MAX_CONTENT_LENGTH = 500

/** 默认存储目录 */
const DEFAULT_DATA_DIR = join(process.cwd(), 'chitu-data', 'memories')

/**
 * 记忆存储管理器
 *
 * PostgreSQL 主存储 + JSON 文件降级
 */
export class MemoryStorage {
	private filePath: string
	private useDb: boolean = true

	constructor(dataDir?: string) {
		const dir = dataDir || DEFAULT_DATA_DIR
		this.filePath = join(dir, 'memories.json')
	}

	/** 加载所有记忆（优先从数据库） */
	load(): Memory[] {
		// 同步方法，尝试从数据库加载
		if (this.useDb) {
			try {
				// neon() 的 sql 模板标签是异步的，但 load() 是同步接口
				// 对于同步调用场景，使用 JSON 文件降级
				// 异步版本使用 loadAsync()
			} catch {
				this.useDb = false
			}
		}

		// JSON 文件降级
		return this.loadFromFile()
	}

	/** 异步加载所有记忆（优先从数据库） */
	async loadAsync(): Promise<Memory[]> {
		if (this.useDb) {
			try {
				const sql = getDb()
				const rows = await sql`
					SELECT id, category, content, source_thread_id, created_at
					FROM memories ORDER BY created_at ASC
				` as any[]

				return rows.map(row => ({
					id: row.id,
					category: row.category as MemoryCategory,
					content: row.content,
					sourceThreadId: row.source_thread_id,
					createdAt: Number(row.created_at),
				}))
			} catch (err: any) {
				console.warn(`[MemoryStorage] 数据库读取失败，降级到文件: ${err.message}`)
				this.useDb = false
			}
		}

		return this.loadFromFile()
	}

	/** 保存记忆列表（PostgreSQL + JSON 备份） */
	save(memories: Memory[]): void {
		const trimmed = memories.length > MAX_MEMORIES
			? memories.slice(-MAX_MEMORIES)
			: memories

		// JSON 文件备份（同步写入保证可靠）
		this.saveToFile(trimmed)

		// 异步写入数据库（不阻塞）
		if (this.useDb) {
			this.saveToDb(trimmed).catch(err => {
				console.warn(`[MemoryStorage] 数据库保存失败: ${err.message}`)
				this.useDb = false
			})
		}
	}

	/** 添加新记忆（去重：相同类别 + 内容重叠） */
	addMemories(newMemories: Omit<Memory, 'id' | 'createdAt'>[]): Memory[] {
		const existing = this.load()
		const added: Memory[] = []

		for (const mem of newMemories) {
			const newNormalized = mem.content.toLowerCase().trim()
			const isDuplicate = existing.some(m => {
				if (m.category !== mem.category) return false
				const existingNormalized = m.content.toLowerCase().trim()
				return existingNormalized === newNormalized ||
					existingNormalized.includes(newNormalized) ||
					newNormalized.includes(existingNormalized)
			})
			if (isDuplicate) continue

			const memory: Memory = {
				id: randomUUID(),
				category: mem.category,
				content: mem.content.slice(0, MAX_CONTENT_LENGTH),
				sourceThreadId: mem.sourceThreadId,
				createdAt: Date.now(),
			}
			existing.push(memory)
			added.push(memory)
		}

		this.save(existing)
		return added
	}

	/** 格式化记忆为注入文本（限制数量，避免上下文膨胀） */
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

	/** 清空所有记忆（测试用） */
	async clear(): Promise<void> {
		this.saveToFile([])

		if (this.useDb) {
			try {
				const sql = getDb()
				await sql`DELETE FROM memories`
			} catch {
				this.useDb = false
			}
		}
	}

	// ===== JSON 文件操作（降级/备份） =====

	private loadFromFile(): Memory[] {
		try {
			if (!existsSync(this.filePath)) return []
			const raw = readFileSync(this.filePath, 'utf-8')
			const store: MemoryStore = JSON.parse(raw)
			return store.memories || []
		} catch {
			const backupPath = this.filePath + '.corrupt.' + Date.now()
			try { renameSync(this.filePath, backupPath) } catch {}
			console.error(`[memories] 存储文件损坏，已备份到 ${backupPath}`)
			return []
		}
	}

	private saveToFile(memories: Memory[]): void {
		const dir = dirname(this.filePath)
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true })
		}

		const store: MemoryStore = {
			memories,
			updatedAt: Date.now(),
		}
		const tmpPath = this.filePath + '.tmp'
		writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8')
		renameSync(tmpPath, this.filePath)
	}

	/** 异步批量写入数据库（全量替换） */
	private async saveToDb(memories: Memory[]): Promise<void> {
		const sql = getDb()

		// 使用事务：先清空再插入
		await sql`BEGIN`
		try {
			await sql`DELETE FROM memories`

			for (const mem of memories) {
				await sql`
					INSERT INTO memories (id, category, content, source_thread_id, created_at)
					VALUES (${mem.id}, ${mem.category}, ${mem.content}, ${mem.sourceThreadId}, ${mem.createdAt})
				`
			}

			await sql`COMMIT`
		} catch (err) {
			await sql`ROLLBACK`
			throw err
		}
	}
}
