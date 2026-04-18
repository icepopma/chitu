/**
 * 分层配置系统 — 验证
 *
 * 验证合并后的配置是否合法。
 * 给出明确的错误提示，帮助用户快速定位问题。
 *
 * 学习重点：
 * - 配置验证在启动时执行，fail fast
 * - 错误信息要指出具体字段和期望类型
 */

import type { ChituConfig } from './types.js'

export interface ValidationError {
	field: string
	message: string
}

/** 验证配置 */
export function validateConfig(config: ChituConfig): ValidationError[] {
	const errors: ValidationError[] = []

	// Server
	if (config.server.port < 1 || config.server.port > 65535) {
		errors.push({
			field: 'server.port',
			message: `端口号必须在 1-65535 之间，当前值: ${config.server.port}`,
		})
	}

	// LLM
	if (!config.llm.apiKey) {
		errors.push({
			field: 'llm.apiKey',
			message: 'API Key 未设置。请设置 ZHIPU_API_KEY 或 GLM_API_KEY 环境变量，或在配置文件中配置 llm.apiKey',
		})
	}

	if (config.llm.maxRetries < 0 || config.llm.maxRetries > 10) {
		errors.push({
			field: 'llm.maxRetries',
			message: `LLM 最大重试次数必须在 0-10 之间，当前值: ${config.llm.maxRetries}`,
		})
	}

	// Agent
	if (config.agent.maxIterations < 1) {
		errors.push({
			field: 'agent.maxIterations',
			message: `最大循环次数必须大于 0，当前值: ${config.agent.maxIterations}`,
		})
	}

	if (config.agent.compactThreshold < 1000) {
		errors.push({
			field: 'agent.compactThreshold',
			message: `压缩阈值不能低于 1000，当前值: ${config.agent.compactThreshold}`,
		})
	}

	if (config.agent.maxToolOutputLength < 100) {
		errors.push({
			field: 'agent.maxToolOutputLength',
			message: `工具输出最大长度不能低于 100，当前值: ${config.agent.maxToolOutputLength}`,
		})
	}

	// Tools
	if (config.tools.execTimeout < 1000) {
		errors.push({
			field: 'tools.execTimeout',
			message: `exec 超时不能低于 1000ms，当前值: ${config.tools.execTimeout}`,
		})
	}

	return errors
}

/** 格式化验证错误为可读文本 */
export function formatValidationErrors(errors: ValidationError[]): string {
	if (errors.length === 0) return ''
	const lines = ['配置验证失败：']
	for (const err of errors) {
		lines.push(`  - ${err.field}: ${err.message}`)
	}
	lines.push('')
	lines.push('配置优先级：默认值 < ~/.chitu/config.json < .chitu/config.json < 环境变量 < CLI 参数')
	return lines.join('\n')
}
