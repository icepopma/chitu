/**
 * Git Status Tool — 查看 git 仓库状态
 *
 * 学习重点：
 * - 只读工具不需要 needsApproval
 * - execSync + encoding: 'utf-8' 获取字符串输出
 * - --porcelain 格式适合程序解析
 */

import type { Tool, ToolResult } from '../base.js'
import { execSync } from 'node:child_process'

export const gitStatusTool: Tool = {
	name: 'git_status',
	description: 'Show the working tree status. Returns short format (porcelain) output showing staged, unstaged, and untracked files.',
	parameters: {
		type: 'object',
		properties: {
			short: {
				type: 'boolean',
				description: 'Use short format (default: true)',
			},
		},
	},

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		const cwd = process.cwd()
		const useShort = args.short !== false

		try {
			execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' })
		} catch {
			return { content: 'Not a git repository.', isError: true }
		}

		try {
			if (useShort) {
				const output = execSync('git status --porcelain', { cwd, encoding: 'utf-8' })
				const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim()
				if (!output.trim()) {
					return { content: `On branch ${branch}\nNothing to commit, working tree clean.` }
				}
				const lines = output.trim().split('\n')
				return { content: `On branch ${branch}\n${lines.length} file(s) changed:\n${output}` }
			} else {
				const output = execSync('git status', { cwd, encoding: 'utf-8' })
				return { content: output }
			}
		} catch (err: any) {
			return { content: `git status failed: ${err.message}`, isError: true }
		}
	},
}
