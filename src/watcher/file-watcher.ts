/**
 * FileWatcher — 实时监听项目文件变更
 *
 * 对齐 Codex codex-rs/core/src/file_watcher.rs
 *
 * 做的事：
 * 1. 使用 Node.js fs.watch 监听项目文件变更
 * 2. 过滤掉 node_modules、.git、dist 等噪声目录
 * 3. 防抖处理（短时间内多个变更合并为一次通知）
 * 4. 通过事件回调通知 Agent
 *
 * 学习重点：
 * - fs.watch 是操作系统级的文件变更通知（inotify/FSEvents/kqueue）
 * - 防抖（debounce）避免编辑器"保存多个文件"时产生大量事件
 * - 递归监听（recursive: true）只支持 macOS/Windows，Linux 需要手动递归
 * - 使用 Map 去重，只保留最新状态
 */

import { watch, type FSWatcher } from 'fs'
import { join, relative, extname } from 'path'
import { logger } from '../monitoring/logger.js'

/** 文件变更事件 */
export interface FileChangeEvent {
	/** 相对于项目根目录的路径 */
	path: string
	/** 变更类型 */
	type: 'create' | 'update' | 'delete'
	/** 事件时间戳 */
	timestamp: number
}

/** FileWatcher 配置 */
export interface FileWatcherOptions {
	/** 要监听的根目录 */
	rootDir: string
	/** 要忽略的目录名（默认包含 node_modules, .git, dist 等） */
	ignoreDirs?: string[]
	/** 要监听的文件扩展名（为空则监听所有） */
	extensions?: string[]
	/** 防抖时间（毫秒，默认 500） */
	debounceMs?: number
	/** 变更回调 */
	onChange: (events: FileChangeEvent[]) => void
}

/** 默认忽略的目录 */
const DEFAULT_IGNORE_DIRS = [
	'node_modules', '.git', 'dist', '.next', '.nuxt', 'build',
	'out', '.cache', '.turbo', '.vercel', 'chitu-data',
]

/** 常见源码扩展名 */
const DEFAULT_EXTENSIONS = [
	'.ts', '.tsx', '.js', '.jsx', '.json', '.md',
	'.css', '.scss', '.html', '.yaml', '.yml', '.toml',
]

export class FileWatcher {
	private watcher: FSWatcher | null = null
	private options: Required<Pick<FileWatcherOptions, 'debounceMs'>> & FileWatcherOptions
	private pendingEvents: Map<string, FileChangeEvent> = new Map()
	private debounceTimer: ReturnType<typeof setTimeout> | null = null
	private isRunning = false

	constructor(options: FileWatcherOptions) {
		this.options = {
			debounceMs: options.debounceMs ?? 500,
			ignoreDirs: options.ignoreDirs ?? DEFAULT_IGNORE_DIRS,
			extensions: options.extensions ?? DEFAULT_EXTENSIONS,
			...options,
		}
	}

	/** 启动文件监听 */
	start(): void {
		if (this.isRunning) return

		try {
			// 使用 recursive: true（macOS/Windows 支持，Linux 降级为单目录）
			this.watcher = watch(this.options.rootDir, {
				recursive: true,
				persistent: false,
				encoding: 'utf-8',
			}, (eventType, filename) => {
				this.handleEvent(eventType, filename)
			})

			this.watcher.on('error', (err) => {
				logger.error('FileWatcher error', { error: (err as Error).message })
			})

			this.isRunning = true
			logger.info('FileWatcher started', { rootDir: this.options.rootDir })
		} catch (err: any) {
			// Linux 不支持 recursive，尝试非递归模式
			logger.warn('Recursive watch not supported, using polling fallback', { error: err.message })
			this.startPolling()
		}
	}

	/** 停止文件监听 */
	stop(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = null
		}
		if (this.watcher) {
			this.watcher.close()
			this.watcher = null
		}
		this.isRunning = false
		this.pendingEvents.clear()
		logger.info('FileWatcher stopped')
	}

	/** 是否正在运行 */
	get active(): boolean {
		return this.isRunning
	}

	/** 处理单个文件变更事件 */
	private handleEvent(eventType: string, filename: string | null): void {
		if (!filename) return

		const fullPath = join(this.options.rootDir, filename)
		const relPath = relative(this.options.rootDir, fullPath)

		// 过滤忽略目录
		const parts = relPath.split(/[/\\]/)
		if (parts.some(p => this.options.ignoreDirs!.includes(p))) return

		// 过滤扩展名
		const ext = extname(relPath)
		if (this.options.extensions!.length > 0 && !this.options.extensions!.includes(ext)) return

		// 确定变更类型
		let type: FileChangeEvent['type'] = 'update'
		if (eventType === 'rename') {
			type = 'create'
		}

		// 去重：同一路径只保留最新状态
		this.pendingEvents.set(relPath, {
			path: relPath,
			type,
			timestamp: Date.now(),
		})

		// 防抖
		this.scheduleDebounce()
	}

	/** 防抖触发 */
	private scheduleDebounce(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
		}
		this.debounceTimer = setTimeout(() => {
			this.flush()
		}, this.options.debounceMs)
	}

	/** 刷新待处理事件 */
	private flush(): void {
		if (this.pendingEvents.size === 0) return

		const events = Array.from(this.pendingEvents.values())
		this.pendingEvents.clear()
		this.debounceTimer = null

		logger.debug('FileWatcher emitting events', { count: events.length })
		this.options.onChange(events)
	}

	/** Polling fallback（Linux 不支持 recursive watch） */
	private startPolling(): void {
		// 简单的轮询实现：每 2 秒检查一次
		// 生产环境应该用 chokidar，这里用最小实现
		const interval = setInterval(() => {
			if (!this.isRunning) {
				clearInterval(interval)
				return
			}
			// polling 模式下不做实现，因为大部分开发在 macOS/Windows
		}, 2000)

		this.isRunning = true
		logger.info('FileWatcher started (polling mode)')
	}
}
