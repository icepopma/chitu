/**
 * 结构化日志 — JSON 格式 + request ID 关联
 *
 * 对齐 Codex codex-rs/otel/ 的可观测性设计。
 *
 * 做的事：
 * 1. 所有日志输出 JSON 格式
 * 2. 每条日志带 request ID（方便关联请求链路）
 * 3. 支持 log level：debug / info / warn / error
 * 4. 可选的 context 字段（附加额外信息）
 *
 * 学习重点：
 * - 结构化日志比 console.log 更适合生产环境（可搜索、可聚合）
 * - request ID 是分布式追踪的基础
 * - JSON 格式让日志可以被 ELK/Loki 等系统直接消费
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
	timestamp: string
	level: LogLevel
	message: string
	requestId?: string
	traceId?: string
	context?: Record<string, unknown>
}

/** 日志配置 */
export interface LoggerConfig {
	/** 最小日志级别 */
	minLevel: LogLevel
	/** 默认 request ID */
	defaultRequestId?: string
	/** 输出函数（默认 console.log/console.error） */
	writer?: (entry: LogEntry) => void
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
}

export class StructuredLogger {
	private config: LoggerConfig

	constructor(config?: Partial<LoggerConfig>) {
		this.config = {
			minLevel: (process.env.LOG_LEVEL as LogLevel) || 'info',
			writer: undefined,
			...config,
		}
	}

	/** 创建带 request ID 的子 logger */
	withRequestId(requestId: string): StructuredLogger {
		const child = new StructuredLogger({ ...this.config, defaultRequestId: requestId })
		return child
	}

	/** 创建带 trace ID 的子 logger */
	withTraceId(traceId: string): StructuredLogger {
		const child = new StructuredLogger(this.config)
		child._traceId = traceId
		return child
	}

	private _traceId?: string

	debug(message: string, context?: Record<string, unknown>): void {
		this.log('debug', message, context)
	}

	info(message: string, context?: Record<string, unknown>): void {
		this.log('info', message, context)
	}

	warn(message: string, context?: Record<string, unknown>): void {
		this.log('warn', message, context)
	}

	error(message: string, context?: Record<string, unknown>): void {
		this.log('error', message, context)
	}

	private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
		if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.config.minLevel]) return

		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			requestId: this.config.defaultRequestId,
			traceId: this._traceId,
			context: Object.keys(context || {}).length > 0 ? context : undefined,
		}

		if (this.config.writer) {
			this.config.writer(entry)
		} else {
			const line = JSON.stringify(entry)
			if (level === 'error') {
				console.error(line)
			} else if (level === 'warn') {
				console.warn(line)
			} else {
				console.log(line)
			}
		}
	}
}

/** 全局 logger 实例 */
export const logger = new StructuredLogger()
