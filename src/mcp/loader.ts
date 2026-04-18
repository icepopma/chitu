/**
 * MCP 配置加载器
 *
 * 从项目配置文件加载 MCP Server 定义。
 * 支持两种配置位置：
 * 1. 项目根目录 .chitu/mcp.json
 * 2. 全局 ~/.chitu/mcp.json
 *
 * 学习重点：
 * - MCP Server 配置是声明式的：用户定义要连接哪些 server
 * - 配置文件格式对齐 MCP 官方规范
 * - 项目级配置覆盖全局配置（和分层配置系统一致）
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { McpServerConfig } from './types.js'
import { logger } from '../monitoring/logger.js'

/** MCP 配置文件格式 */
export interface McpConfigFile {
	/** MCP Servers 定义 */
	mcpServers: Record<string, {
		/** 传输类型 */
		transport?: 'stdio' | 'sse'
		/** stdio: 启动命令 */
		command?: string
		/** stdio: 命令参数 */
		args?: string[]
		/** 环境变量 */
		env?: Record<string, string>
		/** sse: Server URL */
		url?: string
		/** 审批策略 */
		approvalPolicy?: 'auto-approve' | 'ask-user'
	}>
}

/**
 * 加载 MCP 配置
 *
 * 合并全局和项目级配置，项目级覆盖全局
 */
export function loadMcpConfig(projectRoot?: string): McpServerConfig[] {
	const configs: McpServerConfig[] = []
	const root = projectRoot || process.cwd()

	// 1. 全局配置
	const globalPath = join(homedir(), '.chitu', 'mcp.json')
	const globalServers = loadConfigFile(globalPath)

	// 2. 项目配置
	const projectPath = join(root, '.chitu', 'mcp.json')
	const projectServers = loadConfigFile(projectPath)

	// 3. 合并（项目覆盖全局）
	const merged = new Map<string, McpServerConfig>()

	for (const [name, server] of Object.entries(globalServers)) {
		merged.set(name, normalizeServerConfig(name, server))
	}

	for (const [name, server] of Object.entries(projectServers)) {
		merged.set(name, normalizeServerConfig(name, server))
	}

	for (const config of merged.values()) {
		configs.push(config)
	}

	if (configs.length > 0) {
		logger.info('MCP config loaded', {
			servers: configs.map(c => c.name),
		})
	}

	return configs
}

/** 读取单个配置文件 */
function loadConfigFile(path: string): McpConfigFile['mcpServers'] {
	if (!existsSync(path)) return {}

	try {
		const content = readFileSync(path, 'utf-8')
		const parsed = JSON.parse(content) as McpConfigFile
		return parsed.mcpServers ?? {}
	} catch (err: any) {
		logger.warn('Failed to load MCP config', { path, error: err.message })
		return {}
	}
}

/** 标准化 Server 配置 */
function normalizeServerConfig(
	name: string,
	server: McpConfigFile['mcpServers'][string],
): McpServerConfig {
	return {
		name,
		transport: server.transport ?? (server.command ? 'stdio' : 'sse'),
		command: server.command,
		args: server.args,
		env: server.env,
		url: server.url,
		approvalPolicy: server.approvalPolicy ?? 'ask-user',
	}
}
