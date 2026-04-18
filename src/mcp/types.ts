/**
 * MCP 类型定义
 *
 * Model Context Protocol (MCP) 是 Anthropic 提出的工具协议，
 * 让 AI Agent 可以通过标准化接口调用外部工具。
 *
 * 对齐 Codex codex-rs/mcp/ 的类型设计
 *
 * 学习重点：
 * - MCP 协议基于 JSON-RPC 2.0（和赤兔的 WebSocket 层一样的协议）
 * - 工具发现：client 发 tools/list 请求 → server 返回工具列表
 * - 工具调用：client 发 tools/call 请求 → server 执行并返回结果
 * - 传输层支持 stdio（子进程）和 SSE（HTTP）
 */

/** MCP 工具定义（从 MCP Server 获取） */
export interface McpToolDefinition {
	name: string
	description?: string
	inputSchema: {
		type: 'object'
		properties?: Record<string, unknown>
		required?: string[]
	}
}

/** MCP 工具调用结果 */
export interface McpToolResult {
	content: Array<{
		type: 'text' | 'image' | 'resource'
		text?: string
		data?: string
		mimeType?: string
	}>
	isError?: boolean
}

/** MCP Server 配置 */
export interface McpServerConfig {
	/** 唯一标识 */
	name: string
	/** 传输类型 */
	transport: 'stdio' | 'sse'
	/** stdio 模式：启动命令 */
	command?: string
	/** stdio 模式：命令参数 */
	args?: string[]
	/** stdio 模式：环境变量 */
	env?: Record<string, string>
	/** sse 模式：Server URL */
	url?: string
	/** 工具审批策略：auto-approve 自动批准，ask-user 需确认 */
	approvalPolicy?: 'auto-approve' | 'ask-user'
}

/** MCP Client 状态 */
export type McpClientStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
