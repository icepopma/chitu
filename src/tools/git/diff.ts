/**
 * Git Diff Tool — 查看 git 差异
 *
 * 学习重点：
 * - 支持 staged (--cached) 和 unstaged diff
 * - 支持指定文件路径
 * - 默认使用 --stat 简洁格式，full=true 时显示完整 diff
 */

import type { Tool, ToolResult } from '../base.js'
import { execSync } from 'node:child_process'

export const gitDiffTool: Tool = {
	name: 'git_diff',
	description: 'Show changes between commits, commit and working tree, etc. Use --cached for staged changes.',
	parameters: {
		type: 'object',
		properties: {
			cached: {
				type: 'boolean',
				description: 'Show staged changes (git diff --cached)',
			},
			path: {
				type: 'string',
				description: 'Specific file or directory to diff',
			},
			full: {
				type: 'boolean',
				description: 'Show full diff output (default: stat only)',
			},
			ref: {
				type: 'string',
				description: 'Compare against a specific ref (e.g. HEAD~1, main)',
			},
		},
	},

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		const cwd = process.cwd()
		const cached = args.cached as boolean | undefined
		const path = args.path as string | undefined
		const full = args.full as boolean | undefined
		const ref = args.ref as string | undefined

		try {
			execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' })
		} catch {
			return { content: 'Not a git repository.', isError: true }
		}

		try {
			const parts = ['git', 'diff']
			if (cached) parts.push('--cached')
			if (!full) parts.push('--stat')
			if (ref) parts.push(ref)
			if (path) parts.push('--', path)

			const cmd = parts.join(' ')
			const output = execSync(cmd, { cwd, encoding: 'utf-8' })

			if (!output.trim()) {
				return { content: cached ? 'No staged changes.' : 'No unstaged changes.' }
			}
			return { content: output }
		} catch (err: any) {
			return { content: `git diff failed: ${err.message}`, isError: true }
		}
	},
}
