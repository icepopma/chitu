/**
 * 分层配置系统 — 类型定义
 *
 * 定义赤兔的所有可配置项。
 * 参考 Codex codex-rs/config/ 的分层叠加设计：
 * 全局 ~/.chitu/config.json → 项目 .chitu/config.json → 环境变量 → CLI 参数
 *
 * 学习重点：
 * - 配置分层：后者覆盖前者，粒度从粗到细
 * - 每个字段都有合理的默认值，系统开箱即用
 */

/** 服务器配置 */
export interface ServerConfig {
	/** 监听端口 */
	port: number
	/** 数据目录 */
	dataDir: string
}

/** LLM 配置 */
export interface LLMConfig {
	/** API Key（ZHIPU_API_KEY 或 GLM_API_KEY） */
	apiKey: string
	/** 模型名称 */
	model: string
	/** API Endpoint */
	endpoint: string
	/** 最大重试次数 */
	maxRetries: number
}

/** Agent Loop 配置 */
export interface AgentConfig {
	/** 最大循环次数 */
	maxIterations: number
	/** 上下文压缩阈值（token 数） */
	compactThreshold: number
	/** 压缩后保留的最近 token 预算 */
	recentBudget: number
	/** 工具输出最大字符数 */
	maxToolOutputLength: number
}

/** 工具配置 */
export interface ToolsConfig {
	/** Shell 路径 */
	shell: string
	/** exec 工具执行超时（毫秒） */
	execTimeout: number
}

/** 完整的赤兔配置 */
export interface ChituConfig {
	server: ServerConfig
	llm: LLMConfig
	agent: AgentConfig
	tools: ToolsConfig
}

/** 配置来源（用于调试和日志） */
export type ConfigSource = 'default' | 'global' | 'project' | 'env' | 'cli'

/** 带来源标记的配置值 */
export interface ConfigValueWithSource<T> {
	value: T
	source: ConfigSource
}

/** 配置加载结果 */
export interface ConfigLoadResult {
	/** 合并后的最终配置 */
	config: ChituConfig
	/** 各字段的来源追踪 */
	sources: Record<string, ConfigSource>
	/** 加载过程中的警告 */
	warnings: string[]
}
