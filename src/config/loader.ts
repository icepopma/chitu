/**
 * 分层配置系统 — 文件加载
 *
 * 从 JSON 文件加载配置，支持全局和项目两层。
 *
 * 学习重点：
 * - JSON 文件是最常见的配置格式
 * - 文件不存在不算错误，返回空对象（不覆盖任何默认值）
 * - JSON 解析错误要给出明确的提示
 */

import { readFileSync, existsSync } from 'node:fs'

/** 从 JSON 文件加载配置（文件不存在返回空对象） */
export function loadConfigFile(filePath: string): Record<string, unknown> {
	if (!existsSync(filePath)) {
		return {}
	}

	try {
		const content = readFileSync(filePath, 'utf-8')
		return JSON.parse(content)
	} catch (err: any) {
		throw new Error(`配置文件加载失败 ${filePath}: ${err.message}`)
	}
}
