/**
 * Git Blame Tool — 查看文件行级变更历史
 *
 * 学习重点：
 * - git blame 追踪每一行最后是谁在哪个 commit 修改的
 * - 支持指定行范围，避免输出过长
 */

import type { Tool, ToolResult } from '../base.js'
import { execSync } from 'node:child_process'

export const gitBlameTool: Tool = {
	name: 'git_blame',
	description: 'Show line-by-line revision history for a file. Useful for understanding who changed what and when.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'File path to blame',
			},
			startLine: {
				type: 'number',
				description: 'Start line number (1-based)',
			},
			endLine: {
				type: 'number',
				description: 'End line number (1-based)',
			},
		},
		required: ['path'],
	},

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		const cwd = process.cwd()
		const path = args.path as string
		const startLine = args.startLine as number | undefined
		const endLine = args.endLine as number | undefined

		try {
			execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' })
		} catch {
			return { content: 'Not a git repository.', isError: true }
		}

		try {
			const parts = ['git', 'blame']
			if (startLine && endLine) {
				parts.push(`-L ${startLine},${endLine}`)
			} else if (startLine) {
				parts.push(`-L ${startLine},+20`)
			}
			parts.push('--', path)

			const cmd = parts.join(' ')
			const output = execSync(cmd, { cwd, encoding: 'utf-8' })
			return { content: output }
		} catch (err: any) {
			if (err.message?.includes('no such path')) {
				return { content: `File not found in git: ${path}`, isError: true }
			}
			return { content: `git blame failed: ${err.message}`, isError: true }
		}
	},
}
