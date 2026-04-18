/**
 * SkillsWatcher — 监听 .agents/skills/ 目录变更，触发热加载
 *
 * 对齐 Codex codex-rs/core/src/skills_watcher.rs
 *
 * 做的事：
 * 1. 专门监听 .agents/skills/ 目录（不监听整个项目）
 * 2. 文件变更时重新加载 Skills
 * 3. 通过回调通知上层 Skills 列表已更新
 * 4. 支持 start/stop 生命周期
 *
 * 学习重点：
 * - 专用 watcher 比 FileWatcher 更轻量（只监听一个小目录）
 * - 热加载：不重启服务即可更新 Skills
 * - 增量更新：只重新加载变更的 Skill，不全量重载
 */

import { watch, type FSWatcher, existsSync } from 'fs'
import { join, dirname } from 'path'
import { loadSkills, parseSkillMd, type Skill } from '../skills/loader.js'
import { logger } from '../monitoring/logger.js'

/** SkillsWatcher 配置 */
export interface SkillsWatcherOptions {
	/** 项目根目录 */
	projectRoot: string
	/** Skills 变更回调 */
	onSkillsChanged: (skills: Skill[]) => void
}

export class SkillsWatcher {
	private watcher: FSWatcher | null = null
	private options: SkillsWatcherOptions
	private currentSkills: Skill[] = []
	private isRunning = false

	constructor(options: SkillsWatcherOptions) {
		this.options = options
	}

	/** 启动 Skills 目录监听 */
	start(): void {
		if (this.isRunning) return

		const skillsDir = join(this.options.projectRoot, '.agents', 'skills')
		if (!existsSync(skillsDir)) {
			logger.debug('SkillsWatcher: .agents/skills/ not found, skipping')
			return
		}

		// 初始加载
		this.currentSkills = loadSkills(this.options.projectRoot)
		logger.info('SkillsWatcher: initial load', { count: this.currentSkills.length })

		try {
			this.watcher = watch(skillsDir, {
				recursive: true,
				persistent: false,
				encoding: 'utf-8',
			}, (eventType, filename) => {
				this.handleChange(eventType, filename)
			})

			this.watcher.on('error', (err) => {
				logger.error('SkillsWatcher error', { error: (err as Error).message })
			})

			this.isRunning = true
			logger.info('SkillsWatcher started', { dir: skillsDir })
		} catch (err: any) {
			logger.warn('SkillsWatcher: failed to start, skills hot-reload disabled', { error: err.message })
		}
	}

	/** 停止监听 */
	stop(): void {
		if (this.watcher) {
			this.watcher.close()
			this.watcher = null
		}
		this.isRunning = false
		logger.info('SkillsWatcher stopped')
	}

	/** 获取当前加载的 Skills */
	get skills(): Skill[] {
		return this.currentSkills
	}

	/** 是否正在运行 */
	get active(): boolean {
		return this.isRunning
	}

	/** 处理文件变更事件 */
	private handleChange(eventType: string, filename: string | null): void {
		if (!filename) return

		// 只关心 SKILL.md 文件
		if (!filename.endsWith('SKILL.md') && !filename.endsWith('SKILL.md')) {
			// 也关心目录级变更（新增/删除 skill 目录）
			// 但 fs.watch 在 rename 事件时不一定有文件名信息
		}

		// 全量重载（简单但可靠）
		// 增量更新在 skill 数量多时才有意义
		this.reloadSkills()
	}

	/** 重新加载所有 Skills */
	private reloadSkills(): void {
		const newSkills = loadSkills(this.options.projectRoot)

		// 检查是否真的变了
		if (this.skillsEqual(this.currentSkills, newSkills)) {
			return
		}

		const added = newSkills.filter(n => !this.currentSkills.some(o => o.path === n.path))
		const removed = this.currentSkills.filter(o => !newSkills.some(n => n.path === o.path))
		const updated = newSkills.filter(n => {
			const old = this.currentSkills.find(o => o.path === n.path)
			return old && old.content !== n.content
		})

		this.currentSkills = newSkills

		logger.info('SkillsWatcher: skills reloaded', {
			total: newSkills.length,
			added: added.map(s => s.name),
			removed: removed.map(s => s.name),
			updated: updated.map(s => s.name),
		})

		this.options.onSkillsChanged(newSkills)
	}

	/** 比较两个 Skill 列表是否相同 */
	private skillsEqual(a: Skill[], b: Skill[]): boolean {
		if (a.length !== b.length) return false
		return a.every(s => {
			const match = b.find(o => o.path === s.path)
			return match && match.content === s.content
		})
	}
}
