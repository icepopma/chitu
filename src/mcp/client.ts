/**
 * MCP Client — 连接 MCP Server，发现并调用工具
 *
 * 对齐 Codex codex-rs/mcp/ 的客户端设计
 *
 * 做的事：
 * 1. 通过 stdio 启动 MCP Server 子进程
 * 2. 用 JSON-RPC 2.0 协议与 Server 通信
 * 3. 发现工具（tools/list）并转为赤兔 Tool 接口
 * 4. 调用工具（tools/call）并返回结果
 *
 * 学习重点：
 * - MCP 协议基于 JSON-RPC 2.0，请求/响应模型
 * - stdio 传输：子进程的 stdin/stdout 作为通信通道
 * - 消息分隔：每行一个 JSON 对象（\n 分隔）
 * - 初始化握手：client 发 initialize → server 返回 capabilities
 */

import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import type { Tool, ToolResult } from '../tools/base.js'
import type {
	McpServerConfig,
	McpToolDefinition,
	McpToolResult,
	McpClientStatus,
} from './types.js'
import { logger } from '../monitoring/logger.js'

/** JSON-RPC 请求 */
interface JsonRpcRequest {
	jsonrpc: '2.0'
	id: number
	method: string
	params?: Record<string, unknown>
}

/** JSON-RPC 响应 */
interface JsonRpcResponse {
	jsonrpc: '2.0'
	id: number
	result?: unknown
	error?: {
		code: number
		message: string
		data?: unknown
	}
}

/** 待处理的请求（等待 server 响应） */
interface PendingRequest {
	resolve: (result: unknown) => void
	reject: (error: Error) => void
}

export class McpClient {
	private config: McpServerConfig
	private process: ChildProcess | null = null
	private pendingRequests: Map<number, PendingRequest> = new Map()
	private nextId = 1
	private status: McpClientStatus = 'disconnected'
	private discoveredTools: McpToolDefinition[] = []
	private serverCapabilities: Record<string, unknown> = {}

	constructor(config: McpServerConfig) {
		this.config = config
	}

	/** 当前状态 */
	get currentStatus(): McpClientStatus {
		return this.status
	}

	/** 已发现的工具 */
	get tools(): McpToolDefinition[] {
		return this.discoveredTools
	}

	/**
	 * 连接到 MCP Server（stdio 模式）
	 *
	 * 流程：
	 * 1. 启动子进程
	 * 2. 监听 stdout 解析 JSON-RPC 响应
	 * 3. 发送 initialize 请求完成握手
	 * 4. 发送 tools/list 发现可用工具
	 */
	async connect(): Promise<void> {
		if (this.status === 'connected') return

		if (this.config.transport !== 'stdio' || !this.config.command) {
			throw new Error(`Unsupported transport: ${this.config.transport}`)
		}

		this.status = 'connecting'

		try {
			// 1. 启动子进程
			this.process = spawn(this.config.command, this.config.args ?? [], {
				stdio: ['pipe', 'pipe', 'pipe'],
				env: { ...process.env, ...this.config.env },
			})

			if (!this.process.stdin || !this.process.stdout) {
				throw new Error('Failed to create stdio pipes')
			}

			// 2. 监听 stdout
			const rl = createInterface({ input: this.process.stdout })
			rl.on('line', (line) => {
				this.handleMessage(line)
			})

			this.process.stderr?.on('data', (data: Buffer) => {
				logger.debug(`MCP Server [${this.config.name}] stderr: ${data.toString().trim()}`)
			})

			this.process.on('error', (err) => {
				logger.error(`MCP Server [${this.config.name}] process error`, { error: err.message })
				this.status = 'error'
			})

			this.process.on('exit', (code) => {
				logger.info(`MCP Server [${this.config.name}] exited`, { code })
				this.status = 'disconnected'
			})

			// 3. 初始化握手
			await this.initialize()

			// 4. 发现工具
			await this.discoverTools()

			this.status = 'connected'
			logger.info(`MCP Client [${this.config.name}] connected`, {
				tools: this.discoveredTools.map(t => t.name),
			})
		} catch (err: any) {
			this.status = 'error'
			logger.error(`MCP Client [${this.config.name}] connection failed`, { error: err.message })
			throw err
		}
	}

	/** 断开连接 */
	async disconnect(): Promise<void> {
		if (this.process && !this.process.killed) {
			this.process.kill('SIGTERM')
			this.process = null
		}
		this.status = 'disconnected'
		this.pendingRequests.clear()
		logger.info(`MCP Client [${this.config.name}] disconnected`)
	}

	/**
	 * 调用 MCP 工具
	 */
	async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
		const result = await this.sendRequest('tools/call', {
			name,
			arguments: args,
		}) as McpToolResult

		return result
	}

	/**
	 * 将 MCP 工具转换为赤兔 Tool 接口
	 *
	 * 这样 MCP 工具就可以像内置工具一样被 Agent Loop 调用
	 */
	toChituTools(): Tool[] {
		return this.discoveredTools.map(def => this.mcpToolToChituTool(def))
	}

	// ===== 内部方法 =====

	/** 初始化握手 */
	private async initialize(): Promise<void> {
		const result = await this.sendRequest('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: {
				name: 'chitu-agent',
				version: '1.0.0',
			},
		}) as { capabilities?: Record<string, unknown>; serverInfo?: { name: string; version: string } }

		this.serverCapabilities = result.capabilities ?? {}

		logger.debug(`MCP Server [${this.config.name}] initialized`, {
			serverInfo: result.serverInfo,
			capabilities: Object.keys(this.serverCapabilities),
		})

		// 发送 initialized 通知（无 id，不需要响应）
		this.sendNotification('notifications/initialized', {})
	}

	/** 发现工具 */
	private async discoverTools(): Promise<void> {
		const result = await this.sendRequest('tools/list', {}) as {
			tools: McpToolDefinition[]
		}

		this.discoveredTools = result.tools ?? []
	}

	/** 发送 JSON-RPC 请求并等待响应 */
	private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.process?.stdin?.writable) {
				reject(new Error('MCP Server process not available'))
				return
			}

			const id = this.nextId++
			const request: JsonRpcRequest = {
				jsonrpc: '2.0',
				id,
				method,
				params,
			}

			this.pendingRequests.set(id, { resolve, reject })

			const message = JSON.stringify(request) + '\n'
			this.process.stdin.write(message, (err) => {
				if (err) {
					this.pendingRequests.delete(id)
					reject(err)
				}
			})

			// 超时保护（10 秒）
			setTimeout(() => {
				if (this.pendingRequests.has(id)) {
					this.pendingRequests.delete(id)
					reject(new Error(`MCP request timeout: ${method}`))
				}
			}, 10_000)
		})
	}

	/** 发送 JSON-RPC 通知（无 id，不需要响应） */
	private sendNotification(method: string, params: Record<string, unknown>): void {
		if (!this.process?.stdin?.writable) return

		const notification = {
			jsonrpc: '2.0',
			method,
			params,
		}

		this.process.stdin.write(JSON.stringify(notification) + '\n')
	}

	/** 处理从 MCP Server 收到的消息 */
	private handleMessage(line: string): void {
		try {
			const message = JSON.parse(line) as JsonRpcResponse

			if (message.id !== undefined) {
				const pending = this.pendingRequests.get(message.id)
				if (pending) {
					this.pendingRequests.delete(message.id)
					if (message.error) {
						pending.reject(new Error(message.error.message))
					} else {
						pending.resolve(message.result)
					}
				}
			}
		} catch (err: any) {
			logger.debug(`MCP Client [${this.config.name}] failed to parse message`, {
				error: err.message,
				line: line.substring(0, 200),
			})
		}
	}

	/** 单个 MCP 工具定义 → 赤兔 Tool */
	private mcpToolToChituTool(def: McpToolDefinition): Tool {
		const client = this
		const approvalPolicy = this.config.approvalPolicy ?? 'ask-user'

		return {
			name: `mcp__${this.config.name}__${def.name}`,
			description: def.description || `MCP tool: ${def.name}`,
			parameters: def.inputSchema,
			async execute(args: Record<string, unknown>): Promise<ToolResult> {
				try {
					const result = await client.callTool(def.name, args)

					// 拼接文本内容
					const textParts = result.content
						.filter(c => c.type === 'text' && c.text)
						.map(c => c.text!)
					const content = textParts.join('\n') || '(无输出)'

					return {
						content,
						isError: result.isError ?? false,
					}
				} catch (err: any) {
					return {
						content: `MCP 工具调用失败: ${err.message}`,
						isError: true,
					}
				}
			},
			needsApproval(): boolean {
				// MCP 工具默认需要审批，除非配置为 auto-approve
				return approvalPolicy !== 'auto-approve'
			},
		}
	}
}
