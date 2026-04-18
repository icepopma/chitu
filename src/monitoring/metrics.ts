/**
 * Prometheus Metrics — 指标收集与暴露
 *
 * 对齐 Codex codex-rs/otel/ 的可观测性设计。
 *
 * 做的事：
 * 1. 收集 turn 耗时（histogram）
 * 2. 收集 token 消耗（counter）
 * 3. 收集 API 错误率（counter）
 * 4. 收集活跃连接数（gauge）
 * 5. 以 Prometheus exposition format 暴露 /metrics
 *
 * 学习重点：
 * - Prometheus 用 pull 模式抓指标，我们只需暴露 HTTP endpoint
 * - Counter 只增不减（请求数、错误数）
 * - Gauge 可增可减（连接数、队列长度）
 * - Histogram 观察分布（耗时直方图 + sum + count）
 */

/** 指标注册表 */
class MetricsRegistry {
	private counters = new Map<string, { labels: string[]; value: number; labelValues: Map<string, number> }>()
	private gauges = new Map<string, { labels: string[]; value: number; labelValues: Map<string, number> }>()
	private histograms = new Map<string, { labels: string[]; buckets: number[]; sums: Map<string, number>; counts: Map<string, number>; bucketsMap: Map<string, Map<string, number>> }>()

	/** 注册 counter */
	registerCounter(name: string, help: string, labels: string[] = []): void {
		this.counters.set(name, { labels, value: 0, labelValues: new Map() })
		this._helpTexts.set(name, help)
	}

	/** 递增 counter */
	incCounter(name: string, value: number = 1, labelObj?: Record<string, string>): void {
		const counter = this.counters.get(name)
		if (!counter) return
		if (labelObj && counter.labels.length > 0) {
			const key = this.labelKey(labelObj, counter.labels)
			const current = counter.labelValues.get(key) || 0
			counter.labelValues.set(key, current + value)
		} else {
			counter.value += value
		}
	}

	/** 注册 gauge */
	registerGauge(name: string, help: string, labels: string[] = []): void {
		this.gauges.set(name, { labels, value: 0, labelValues: new Map() })
		this._helpTexts.set(name, help)
	}

	/** 设置 gauge */
	setGauge(name: string, value: number, labelObj?: Record<string, string>): void {
		const gauge = this.gauges.get(name)
		if (!gauge) return
		if (labelObj && gauge.labels.length > 0) {
			const key = this.labelKey(labelObj, gauge.labels)
			gauge.labelValues.set(key, value)
		} else {
			gauge.value = value
		}
	}

	/** 递增 gauge */
	incGauge(name: string, value: number = 1, labelObj?: Record<string, string>): void {
		const gauge = this.gauges.get(name)
		if (!gauge) return
		if (labelObj && gauge.labels.length > 0) {
			const key = this.labelKey(labelObj, gauge.labels)
			const current = gauge.labelValues.get(key) || 0
			gauge.labelValues.set(key, current + value)
		} else {
			gauge.value += value
		}
	}

	/** 递减 gauge */
	decGauge(name: string, value: number = 1, labelObj?: Record<string, string>): void {
		this.incGauge(name, -value, labelObj)
	}

	/** 注册 histogram */
	registerHistogram(name: string, help: string, buckets: number[] = [0.1, 0.5, 1, 2, 5, 10, 30, 60], labels: string[] = []): void {
		this.histograms.set(name, {
			labels,
			buckets: [...buckets].sort((a, b) => a - b),
			sums: new Map(),
			counts: new Map(),
			bucketsMap: new Map(),
		})
		this._helpTexts.set(name, help)
	}

	/** 观察 histogram 值 */
	observe(name: string, value: number, labelObj?: Record<string, string>): void {
		const hist = this.histograms.get(name)
		if (!hist) return

		const key = labelObj ? this.labelKey(labelObj, hist.labels) : ''
		const sum = hist.sums.get(key) || 0
		hist.sums.set(key, sum + value)
		const count = hist.counts.get(key) || 0
		hist.counts.set(key, count + 1)

		let bucketMap = hist.bucketsMap.get(key)
		if (!bucketMap) {
			bucketMap = new Map()
			hist.bucketsMap.set(key, bucketMap)
		}
		for (const b of hist.buckets) {
			if (value <= b) {
				bucketMap.set(String(b), (bucketMap.get(String(b)) || 0) + 1)
			}
		}
		// +Inf bucket = count
		bucketMap.set('+Inf', count + 1)
	}

	/** 输出 Prometheus exposition format */
	render(): string {
		const lines: string[] = []

		// Counters
		for (const [name, counter] of this.counters) {
			lines.push(`# HELP ${name} ${this._helpTexts.get(name) || ''}`)
			lines.push(`# TYPE ${name} counter`)
			if (counter.labelValues.size > 0) {
				for (const [key, val] of counter.labelValues) {
					lines.push(`${name}${key} ${val}`)
				}
			} else {
				lines.push(`${name} ${counter.value}`)
			}
			lines.push('')
		}

		// Gauges
		for (const [name, gauge] of this.gauges) {
			lines.push(`# HELP ${name} ${this._helpTexts.get(name) || ''}`)
			lines.push(`# TYPE ${name} gauge`)
			if (gauge.labelValues.size > 0) {
				for (const [key, val] of gauge.labelValues) {
					lines.push(`${name}${key} ${val}`)
				}
			} else {
				lines.push(`${name} ${gauge.value}`)
			}
			lines.push('')
		}

		// Histograms
		for (const [name, hist] of this.histograms) {
			lines.push(`# HELP ${name} ${this._helpTexts.get(name) || ''}`)
			lines.push(`# TYPE ${name} histogram`)

			const keys = hist.counts.size > 0 ? [...hist.counts.keys()] : ['']
			for (const key of keys) {
				const bucketMap = hist.bucketsMap.get(key) || new Map()
				for (const b of hist.buckets) {
					const le = String(b)
					const count = bucketMap.get(le) || 0
					lines.push(`${name}_bucket{le="${le}"${key ? ',' + key.slice(1, -1) : ''}} ${count}`)
				}
				// +Inf
				const infCount = hist.counts.get(key) || 0
				lines.push(`${name}_bucket{le="+Inf"${key ? ',' + key.slice(1, -1) : ''}} ${infCount}`)
				lines.push(`${name}_sum${key} ${hist.sums.get(key) || 0}`)
				lines.push(`${name}_count${key} ${infCount}`)
			}
			lines.push('')
		}

		return lines.join('\n')
	}

	private _helpTexts = new Map<string, string>()

	private labelKey(labelObj: Record<string, string>, labels: string[]): string {
		const parts = labels.filter(l => labelObj[l] !== undefined).map(l => `${l}="${labelObj[l]}"`)
		return parts.length > 0 ? `{${parts.join(',')}}` : ''
	}
}

/** 全局指标注册表 */
const metrics = new MetricsRegistry()

// === 预定义指标 ===

// Turn 指标
metrics.registerHistogram(
	'chitu_turn_duration_seconds',
	'Duration of agent turns in seconds',
	[0.5, 1, 2, 5, 10, 30, 60, 120, 300],
)
metrics.registerCounter(
	'chitu_turns_total',
	'Total number of turns',
	['status'],
)
metrics.registerCounter(
	'chitu_turn_tokens_total',
	'Total tokens consumed by turns',
)

// LLM 指标
metrics.registerCounter(
	'chitu_llm_requests_total',
	'Total LLM API requests',
	['status'],
)
metrics.registerHistogram(
	'chitu_llm_request_duration_seconds',
	'LLM API request duration in seconds',
	[0.5, 1, 2, 5, 10, 30],
)

// 连接指标
metrics.registerGauge(
	'chitu_active_connections',
	'Number of active WebSocket connections',
)

// 工具指标
metrics.registerCounter(
	'chitu_tool_calls_total',
	'Total number of tool calls',
	['tool_name', 'status'],
)

/** 导出 metrics 实例和便捷方法 */
export const chituMetrics = {
	/** Turn 开始计时 */
	startTurnTimer(): () => void {
		const start = Date.now()
		return () => {
			const duration = (Date.now() - start) / 1000
			metrics.observe('chitu_turn_duration_seconds', duration)
		}
	},

	/** 记录 turn 完成 */
	recordTurn(status: string): void {
		metrics.incCounter('chitu_turns_total', 1, { status })
	},

	/** 记录 token 消耗 */
	recordTokens(count: number): void {
		metrics.incCounter('chitu_turn_tokens_total', count)
	},

	/** LLM 请求计时 */
	startLlmTimer(): () => void {
		const start = Date.now()
		return () => {
			const duration = (Date.now() - start) / 1000
			metrics.observe('chitu_llm_request_duration_seconds', duration)
		}
	},

	/** 记录 LLM 请求 */
	recordLlmRequest(status: string): void {
		metrics.incCounter('chitu_llm_requests_total', 1, { status })
	},

	/** 连接数增加 */
	connectionAdded(): void {
		metrics.incGauge('chitu_active_connections')
	},

	/** 连接数减少 */
	connectionRemoved(): void {
		metrics.decGauge('chitu_active_connections')
	},

	/** 记录工具调用 */
	recordToolCall(toolName: string, status: string): void {
		metrics.incCounter('chitu_tool_calls_total', 1, { tool_name: toolName, status })
	},

	/** 渲染 Prometheus 格式 */
	render(): string {
		return metrics.render()
	},
}
