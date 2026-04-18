/**
 * FileChangeBuffer — 文件变更事件的缓冲区
 *
 * 连接 FileWatcher 和 Agent Loop：
 * - FileWatcher 收集变更事件 → 存入 buffer
 * - Agent Loop 每次 turn 开始 → 从 buffer 取出 pending 变更 → 注入上下文
 * - 取出后清空 buffer（消费模式）
 *
 * 学习重点：
 * - 生产者-消费者模式的简单实现
 * - buffer 有上限防止内存泄漏
 * - 提供 formatForInjection() 格式化为 LLM 可理解的文本
 */

import type { FileChangeEvent } from './file-watcher.js'
import { logger } from '../monitoring/logger.js'

/** Buffer 上限（最多保留最近 100 个变更事件） */
const MAX_BUFFER_SIZE = 100

export class FileChangeBuffer {
	private events: FileChangeEvent[] = []
	private listeners: Array<(events: FileChangeEvent[]) => void> = []

	/** 添加文件变更事件（由 FileWatcher 调用） */
	push(events: FileChangeEvent[]): void {
		this.events.push(...events)

		// 超过上限时丢弃最旧的事件
		if (this.events.length > MAX_BUFFER_SIZE) {
			const dropped = this.events.length - MAX_BUFFER_SIZE
			this.events = this.events.slice(-MAX_BUFFER_SIZE)
			logger.debug('FileChangeBuffer: dropped old events', { dropped })
		}

		// 通知实时监听器（用于 SkillsWatcher 等即时响应场景）
		for (const listener of this.listeners) {
			try {
				listener(events)
			} catch (err: any) {
				logger.error('FileChangeBuffer listener error', { error: err.message })
			}
		}
	}

	/** 取出并清空所有 pending 事件（由 Agent Loop 调用） */
	flush(): FileChangeEvent[] {
		const events = this.events
		this.events = []
		return events
	}

	/** 查看当前 pending 事件（不清空） */
	peek(): FileChangeEvent[] {
		return [...this.events]
	}

	/** 是否有 pending 事件 */
	get hasEvents(): boolean {
		return this.events.length > 0
	}

	/** 注册实时监听器 */
	onEvent(listener: (events: FileChangeEvent[]) => void): void {
		this.listeners.push(listener)
	}

	/** 移除监听器 */
	offEvent(listener: (events: FileChangeEvent[]) => void): void {
		this.listeners = this.listeners.filter(l => l !== listener)
	}
}

/**
 * 将文件变更事件格式化为 LLM 可理解的注入文本
 *
 * 格式参考 Codex 文件变更通知：
 * 简洁列出变更文件和类型，让 Agent 知道外部发生了什么变化
 */
export function formatFileChangeEvents(events: FileChangeEvent[]): string {
	if (events.length === 0) return ''

	const lines = events.map(e => {
		const typeLabel = e.type === 'create' ? '新增' : e.type === 'delete' ? '删除' : '修改'
		return `- ${typeLabel}: ${e.path}`
	})

	return [
		'# 文件变更通知',
		'',
		'以下文件在你工作期间被外部修改（编辑器保存、git pull 等）：',
		'',
		...lines,
		'',
		'如果这些变更影响你正在执行的任务，请重新读取相关文件以获取最新内容。',
	].join('\n')
}
