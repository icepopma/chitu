/**
 * 分层配置系统 — 合并逻辑
 *
 * 将多层配置合并为最终配置，后者覆盖前者。
 *
 * 学习重点：
 * - 深度合并：只覆盖叶子节点，不丢弃未覆盖的兄弟节点
 * - CLI 参数优先级最高，环境变量次之，项目配置再次，全局配置最低
 */

import type { ChituConfig, ConfigLoadResult, ConfigSource } from './types.js'
import { DEFAULT_CONFIG } from './defaults.js'
import { loadConfigFile } from './loader.js'
import { getGlobalConfigPath, getProjectConfigPath } from './defaults.js'
import { loadEnvOverrides } from './env.js'

/**
 * 深度合并配置对象
 *
 * sources 参数用于追踪每个字段的来源
 */
function deepMerge(
	base: Record<string, unknown>,
	overlay: Record<string, unknown>,
	prefix: string,
	source: ConfigSource,
	result: Record<string, unknown>,
	sources: Record<string, ConfigSource>,
): void {
	for (const [key, value] of Object.entries(overlay)) {
		const path = prefix ? `${prefix}.${key}` : key
		if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
			// 嵌套对象 — 递归合并
			if (!result[key] || typeof result[key] !== 'object') {
				result[key] = {}
			}
			deepMerge(
				base[key] as Record<string, unknown> || {},
				value as Record<string, unknown>,
				path,
				source,
				result[key] as Record<string, unknown>,
				sources,
			)
		} else {
			// 叶子节点 — 直接覆盖
			result[key] = value
			sources[path] = source
		}
	}
}

/**
 * 加载并合并所有配置层
 *
 * 优先级（从低到高）：
 * 1. 默认值（DEFAULT_CONFIG）
 * 2. 全局配置（~/.chitu/config.json）
 * 3. 项目配置（.chitu/config.json）
 * 4. 环境变量（CHITU_* 等）
 * 5. CLI 参数（调用方传入）
 *
 * @param cliOverrides - CLI 参数覆盖（如 --port 9090）
 * @param cwd - 项目目录（默认 process.cwd()）
 */
export function loadConfig(
	cliOverrides?: Partial<ChituConfig>,
	cwd?: string,
): ConfigLoadResult {
	const warnings: string[] = []
	const sources: Record<string, ConfigSource> = {}

	// 1. 从默认值开始
	let merged: Record<string, unknown> = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
	// 所有默认值标记为 'default'
	markAllSources(merged, 'default', '', sources)

	// 2. 全局配置
	try {
		const globalConfig = loadConfigFile(getGlobalConfigPath())
		if (Object.keys(globalConfig).length > 0) {
			deepMerge(merged, globalConfig, '', 'global', merged, sources)
		}
	} catch (err: any) {
		warnings.push(`全局配置加载失败: ${err.message}`)
	}

	// 3. 项目配置
	try {
		const projectConfig = loadConfigFile(getProjectConfigPath(cwd))
		if (Object.keys(projectConfig).length > 0) {
			deepMerge(merged, projectConfig, '', 'project', merged, sources)
		}
	} catch (err: any) {
		warnings.push(`项目配置加载失败: ${err.message}`)
	}

	// 4. 环境变量
	const envOverrides = loadEnvOverrides()
	if (Object.keys(envOverrides).length > 0) {
		// 环境变量是扁平的（server.port），需要展开为嵌套对象再合并
		const expanded = expandFlatToNested(envOverrides)
		deepMerge(merged, expanded, '', 'env', merged, sources)
	}

	// 5. CLI 参数
	if (cliOverrides && Object.keys(cliOverrides).length > 0) {
		deepMerge(merged, cliOverrides as Record<string, unknown>, '', 'cli', merged, sources)
	}

	return {
		config: merged as unknown as ChituConfig,
		sources,
		warnings,
	}
}

/** 将扁平路径映射展开为嵌套对象 */
function expandFlatToNested(flat: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {}
	for (const [path, value] of Object.entries(flat)) {
		const parts = path.split('.')
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let current: any = result
		for (let i = 0; i < parts.length - 1; i++) {
			if (!current[parts[i]]) {
				current[parts[i]] = {}
			}
			current = current[parts[i]]
		}
		current[parts[parts.length - 1]] = value
	}
	return result
}

/** 递归标记所有字段的来源 */
function markAllSources(
	obj: Record<string, unknown>,
	source: ConfigSource,
	prefix: string,
	sources: Record<string, ConfigSource>,
): void {
	for (const [key, value] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${key}` : key
		if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
			markAllSources(value as Record<string, unknown>, source, path, sources)
		} else {
			sources[path] = source
		}
	}
}
