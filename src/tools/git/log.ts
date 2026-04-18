/**
 * Git Log Tool — 查看 git 提交历史
 *
 * 学习重点：
 * - --oneline 简洁格式适合快速浏览
 * - 支持限制条数和指定文件
 * - --format 支持自定义输出格式
 */

import type { Tool, ToolResult } from '../base.js'
import { execSync } from 'node:child_process'

export const gitLogTool: Tool = {
	name: 'git_log',
	description: 'Show commit logs. Useful for understanding project history and recent changes.',
	parameters: {
		type: 'object',
		properties: {
			count: {
				type: 'number',
				description: 'Number of commits to show (default: 10)',
			},
			path: {
				type: 'string',
				description: 'Show only commits affecting this file or directory',
			},
			oneline: {
				type: 'boolean',
				description: 'Use one-line format (default: true)',
			},
			author: {
				type: 'string',
				description: 'Filter by author',
			},
		},
	},

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		const cwd = process.cwd()
		const count = (args.count as number) || 10
		const path = args.path as string | undefined
		const oneline = args.oneline !== false
		const author = args.author as string | undefined

		try {
			execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' })
		} catch {
			return { content: 'Not a git repository.', isError: true }
		}

		try {
			const parts = ['git', 'log']
			if (oneline) {
				parts.push(`--oneline`)
			} else {
				parts.push(`--format=%h %an %ad %s`)
				parts.push('--date=short')
			}
			parts.push(`-${count}`)
			if (author) parts.push(`--author=${author}`)
			if (path) parts.push('--', path)

			const cmd = parts.join(' ')
			const output = execSync(cmd, { cwd, encoding: 'utf-8' })

			if (!output.trim()) {
				return { content: 'No commits found.' }
			}
			return { content: output }
		} catch (err: any) {
			return { content: `git log failed: ${err.message}`, isError: true }
		}
	},
}
