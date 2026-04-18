/**
 * 分层配置系统 — 默认值
 *
 * 所有配置项的默认值都在这里定义。
 * 系统开箱即用，不需要任何配置文件。
 *
 * 学习重点：
 * - 默认值是最安全的配置，确保系统在任何环境都能启动
 * - 每个默认值都应该有合理的解释
 */

import type { ChituConfig } from './types.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getShellPath } from '../utils/shell.js'

export const DEFAULT_CONFIG: ChituConfig = {
	server: {
		port: 8080,
		dataDir: join(process.cwd(), 'chitu-data'),
	},
	llm: {
		apiKey: '',
		model: 'glm-5',
		endpoint: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
		maxRetries: 3,
	},
	agent: {
		maxIterations: 10000,
		compactThreshold: 80_000,
		recentBudget: 20_000,
		maxToolOutputLength: 30_000,
	},
	tools: {
		shell: getShellPath(),
		execTimeout: 120_000,
	},
}

/** 全局配置文件路径 */
export function getGlobalConfigPath(): string {
	return join(homedir(), '.chitu', 'config.json')
}

/** 项目配置文件路径（相对于 cwd） */
export function getProjectConfigPath(cwd?: string): string {
	return join(cwd || process.cwd(), '.chitu', 'config.json')
}
