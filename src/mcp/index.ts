/**
 * MCP 模块入口
 *
 * 对齐 Codex codex-rs/mcp/ 的集成方式
 * 提供 MCP Client 管理和工具注册能力
 */

export { McpClient } from './client.js'
export type {
	McpServerConfig,
	McpToolDefinition,
	McpToolResult,
	McpClientStatus,
} from './types.js'
export { loadMcpConfig, type McpConfigFile } from './loader.js'
