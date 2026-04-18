/**
 * 分层配置系统 — 入口
 *
 * 统一导出配置系统的所有模块。
 * 使用方式：import { loadConfig } from './config/index.js'
 *
 * 学习重点：
 * - 模块化的配置系统：类型、默认值、加载、合并、验证各司其职
 * - 调用方只需要关心 loadConfig() 和 getConfig()
 */

export { loadConfig } from './merge.js'
export { validateConfig, formatValidationErrors } from './validate.js'
export type { ChituConfig, ServerConfig, LLMConfig, AgentConfig, ToolsConfig, ConfigLoadResult, ConfigSource } from './types.js'
export { DEFAULT_CONFIG, getGlobalConfigPath, getProjectConfigPath } from './defaults.js'

import { loadConfig } from './merge.js'
import type { ChituConfig, ConfigLoadResult } from './types.js'

/** 全局单例配置（懒加载） */
let _configResult: ConfigLoadResult | null = null

/**
 * 获取全局配置（单例）
 *
 * 首次调用时加载，之后返回缓存。
 * 如果需要强制重新加载，传入 forceReload = true。
 */
export function getConfig(forceReload?: boolean, cliOverrides?: Partial<ChituConfig>): ConfigLoadResult {
	if (!_configResult || forceReload) {
		_configResult = loadConfig(cliOverrides)
	}
	return _configResult
}

/**
 * 获取已加载的配置（简化版，直接返回 config 对象）
 */
export function getAppConfig(): ChituConfig {
	return getConfig().config
}
