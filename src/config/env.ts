/**
 * 分层配置系统 — 环境变量映射
 *
 * 将环境变量映射到配置项。
 * 环境变量优先级高于配置文件，适合 CI/CD 和容器部署。
 *
 * 学习重点：
 * - 环境变量用 CHITU_ 前缀 + 大写 + 下划线命名
 * - 支持 ZHIPU_API_KEY / GLM_API_KEY 等已有环境变量的兼容
 */

import type { ChituConfig } from './types.js'

/** 环境变量到配置的映射表 */
const ENV_MAP: Record<string, string> = {
	// Server
	PORT: 'server.port',
	CHITU_DATA_DIR: 'server.dataDir',

	// LLM
	ZHIPU_API_KEY: 'llm.apiKey',
	GLM_API_KEY: 'llm.apiKey',
	CHITU_MODEL: 'llm.model',
	ZHIPU_CODING_ENDPOINT: 'llm.endpoint',
	CHITU_LLM_MAX_RETRIES: 'llm.maxRetries',

	// Agent
	CHITU_MAX_ITERATIONS: 'agent.maxIterations',
	CHITU_COMPACT_THRESHOLD: 'agent.compactThreshold',
	CHITU_RECENT_BUDGET: 'agent.recentBudget',
	CHITU_MAX_TOOL_OUTPUT: 'agent.maxToolOutputLength',

	// Tools
	CHITU_SHELL: 'tools.shell',
	CHITU_EXEC_TIMEOUT: 'tools.execTimeout',
}

/**
 * 从环境变量提取配置覆盖
 *
 * 返回扁平的路径→值映射，如 { 'server.port': 8080, 'llm.apiKey': 'xxx' }
 * 注意：ZHIPU_API_KEY 优先于 GLM_API_KEY（先出现的生效）
 */
export function loadEnvOverrides(): Record<string, unknown> {
	const overrides: Record<string, unknown> = {}
	const seen = new Set<string>()

	for (const [envKey, configPath] of Object.entries(ENV_MAP)) {
		// 同一个 configPath 只取第一个找到的环境变量
		if (seen.has(configPath)) continue

		const value = process.env[envKey]
		if (value !== undefined && value !== '') {
			seen.add(configPath)
			overrides[configPath] = parseEnvValue(configPath, value)
		}
	}

	return overrides
}

/** 根据配置路径解析环境变量的类型 */
function parseEnvValue(configPath: string, value: string): unknown {
	if (isNumericField(configPath)) {
		const num = parseInt(value, 10)
		return isNaN(num) ? value : num
	}
	return value
}

/** 判断是否为数字类型字段 */
function isNumericField(path: string): boolean {
	return [
		'server.port',
		'llm.maxRetries',
		'agent.maxIterations',
		'agent.compactThreshold',
		'agent.recentBudget',
		'agent.maxToolOutputLength',
		'tools.execTimeout',
	].includes(path)
}
