/**
 * Ghost Commit — 安全执行快照 + 回滚机制
 *
 * 设计思路（参考 Codex codex-rs/git-utils/）：
 * - 在执行写操作前，用 git stash 创建临时快照
 * - 如果操作失败，自动 git stash pop 回滚到快照状态
 * - 如果操作成功，清除快照
 *
 * 为什么用 stash 而不是 commit：
 * - stash 不会污染 git history
 * - stash 是 git 原生支持的临时存储
 * - pop/apply 可以精确恢复到之前的状态
 *
 * 学习重点：
 * - "快照-执行-回滚" 是事务模式在文件系统的应用
 * - stash push -u 包含 untracked 文件
 * - 返回一个 cleanup 函数，让调用方决定是 commit 还是 rollback
 */

import { execSync } from 'node:child_process'
import { logger } from '../../monitoring/logger.js'

export interface Snapshot {
	/** 快照 ID（stash ref） */
	id: string
	/** 创建快照时的工作目录状态描述 */
	description: string
	/** 提交快照（操作成功，丢弃快照） */
	commit: () => void
	/** 回滚到快照状态（操作失败，恢复文件） */
	rollback: () => void
}

/**
 * 创建一个 Ghost Commit 快照
 *
 * 使用方式：
 * ```
 * const snap = await createSnapshot('before editing config')
 * try {
 *   // ... 执行写操作 ...
 *   snap.commit()   // 成功，丢弃快照
 * } catch {
 *   snap.rollback()  // 失败，回滚
 * }
 * ```
 */
export function createSnapshot(description: string): Snapshot | null {
	const cwd = process.cwd()

	try {
		execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' })
	} catch {
		logger.warn('Not a git repository, skipping snapshot')
		return null
	}

	try {
		const statusBefore = execSync('git status --porcelain', { cwd, encoding: 'utf-8' })
		if (!statusBefore.trim()) {
			logger.debug('Working tree clean, no snapshot needed')
			return null
		}

		// 创建 stash（包含 untracked 文件）
		execSync('git stash push -u -m "chitu-ghost: ${description}"', { cwd, stdio: 'pipe' })

		// 获取 stash ref
		const stashRef = execSync('git stash list --format="%H" -1', { cwd, encoding: 'utf-8' }).trim()
		const stashIndex = execSync('git rev-parse --short stash@{0}', { cwd, encoding: 'utf-8' }).trim()

		logger.info('Ghost snapshot created', { stashId: stashIndex, description })

		return {
			id: stashIndex,
			description,
			commit: () => {
				try {
					execSync('git stash drop stash@{0}', { cwd, stdio: 'pipe' })
					logger.info('Ghost snapshot discarded (operation succeeded)', { stashId: stashIndex })
				} catch (dropErr: any) {
					logger.warn('Failed to drop stash', { error: dropErr.message })
				}
			},
			rollback: () => {
				try {
					execSync('git stash pop stash@{0}', { cwd, stdio: 'pipe' })
					logger.info('Rolled back to ghost snapshot', { stashId: stashIndex, description })
				} catch (popErr: any) {
					logger.error('Failed to rollback stash', { error: popErr.message, stashId: stashIndex })
				}
			},
		}
	} catch (err: any) {
		logger.warn('Failed to create ghost snapshot', { error: err.message })
		return null
	}
}

/**
 * Ghost Commit Tool — 对外暴露为 Agent 可调用的工具
 *
 * Agent 可以显式调用此工具为后续操作创建快照。
 */
import type { Tool, ToolResult } from '../base.js'

export const ghostCommitTool: Tool = {
	name: 'ghost_commit',
	description: 'Create a temporary snapshot of the current working tree before risky operations. If subsequent operations fail, use ghost_rollback to restore. Use before making potentially breaking changes.',
	parameters: {
		type: 'object',
		properties: {
			description: {
				type: 'string',
				description: 'Description of why the snapshot is being created (e.g. "before refactoring auth module")',
			},
		},
		required: ['description'],
	},

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		const description = args.description as string
		const snapshot = createSnapshot(description)

		if (!snapshot) {
			return { content: 'No changes to snapshot (working tree clean or not a git repo).' }
		}

		return {
			content: `Ghost snapshot created: ${snapshot.id}\nDescription: ${description}\n\nUse ghost_rollback to restore if needed. The snapshot will be automatically cleaned up when no longer needed.`,
		}
	},
}

/**
 * Ghost Rollback Tool — 回滚到最近的 ghost 快照
 */
export const ghostRollbackTool: Tool = {
	name: 'ghost_rollback',
	description: 'Roll back to the most recent ghost snapshot. Restores working tree to the state before the risky operation.',
	parameters: {
		type: 'object',
		properties: {},
	},

	needsApproval(): boolean {
		return true
	},

	async execute(): Promise<ToolResult> {
		const cwd = process.cwd()

		try {
			execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' })
		} catch {
			return { content: 'Not a git repository.', isError: true }
		}

		try {
			const stashList = execSync('git stash list', { cwd, encoding: 'utf-8' })
			if (!stashList.trim()) {
				return { content: 'No ghost snapshots found.', isError: true }
			}

			const before = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim()
			execSync('git stash pop stash@{0}', { cwd, stdio: 'pipe' })
			const after = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim()

			return {
				content: `Rolled back to ghost snapshot.\nFiles before: ${before ? before.split('\n').length : 0} changed\nFiles after: ${after ? after.split('\n').length : 0} changed`,
			}
		} catch (err: any) {
			return { content: `Ghost rollback failed: ${err.message}`, isError: true }
		}
	},
}
