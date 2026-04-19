/**
 * 用量追踪模块 — 记录每次 turn 的 token 消耗
 *
 * 每次 turn 完成后异步写入 usage_logs 表。
 * 支持按 user/org 聚合每日/每月用量。
 *
 * 学习重点：
 * - 用量追踪是计费系统的基础数据层
 * - 异步写入不阻塞主流程（fire-and-forget）
 * - 聚合查询利用 SQL 的 SUM + GROUP BY + date_trunc
 */

import { randomBytes } from 'node:crypto'
import { getDb, isDbAvailable } from '../db/connection.js'
import { logger } from './logger.js'

// ===== 类型 =====

export interface UsageLog {
	id: string
	userId: string | null
	orgId: string | null
	threadId: string
	turnId: string
	model: string
	promptTokens: number
	completionTokens: number
	totalTokens: number
	iterations: number
	durationMs: number
	status: string
	createdAt: number
}

export interface UsageRecordParams {
	userId?: string | null
	orgId?: string | null
	threadId: string
	turnId: string
	model?: string
	promptTokens: number
	completionTokens: number
	totalTokens: number
	iterations: number
	durationMs: number
	status: string
}

export interface UsageAggregate {
	period: string
	totalTokens: number
	promptTokens: number
	completionTokens: number
	turnCount: number
	totalIterations: number
	avgDurationMs: number
}

export interface UsageSummary {
	daily: UsageAggregate[]
	monthly: UsageAggregate[]
	totalTokens: number
	totalTurns: number
}

// ===== 用量记录 =====

/** 记录一次 turn 的用量（异步，不阻塞主流程） */
export async function recordUsage(params: UsageRecordParams): Promise<void> {
	if (!(await isDbAvailable())) {
		logger.warn('数据库不可用，跳过用量记录', { threadId: params.threadId, turnId: params.turnId })
		return
	}

	const sql = getDb()
	const id = randomBytes(16).toString('hex')
	const now = Date.now()

	try {
		await sql`
			INSERT INTO usage_logs (
				id, user_id, org_id, thread_id, turn_id,
				model, prompt_tokens, completion_tokens, total_tokens,
				iterations, duration_ms, status, created_at
			) VALUES (
				${id}, ${params.userId || null}, ${params.orgId || null},
				${params.threadId}, ${params.turnId},
				${params.model || 'glm-5'},
				${params.promptTokens}, ${params.completionTokens}, ${params.totalTokens},
				${params.iterations}, ${params.durationMs}, ${params.status}, ${now}
			)
		`
	} catch (err: any) {
		logger.error('用量记录写入失败', { error: err.message, threadId: params.threadId })
	}
}

// ===== 用量查询 =====

/** 按用户查询用量 */
export async function getUserUsage(
	userId: string,
	options?: { startDate?: number; endDate?: number },
): Promise<UsageSummary> {
	return queryUsage({ scope: 'user', scopeId: userId, ...options })
}

/** 按组织查询用量 */
export async function getOrgUsage(
	orgId: string,
	options?: { startDate?: number; endDate?: number },
): Promise<UsageSummary> {
	return queryUsage({ scope: 'org', scopeId: orgId, ...options })
}

/** 通用用量查询 */
async function queryUsage(params: {
	scope: 'user' | 'org'
	scopeId: string
	startDate?: number
	endDate?: number
}): Promise<UsageSummary> {
	if (!(await isDbAvailable())) {
		return { daily: [], monthly: [], totalTokens: 0, totalTurns: 0 }
	}

	const sql = getDb()
	const column = params.scope === 'user' ? 'user_id' : 'org_id'
	const now = Date.now()
	const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
	const startDate = params.startDate || thirtyDaysAgo
	const endDate = params.endDate || now

	// 每日聚合
	const dailyRows = await sql.unsafe(`
		SELECT
			TO_TIMESTAMP(created_at / 1000) AT TIME ZONE 'UTC' AS day,
			SUM(total_tokens) AS total_tokens,
			SUM(prompt_tokens) AS prompt_tokens,
			SUM(completion_tokens) AS completion_tokens,
			COUNT(*) AS turn_count,
			SUM(iterations) AS total_iterations,
			AVG(duration_ms) AS avg_duration_ms
		FROM usage_logs
		WHERE ${column} = '${params.scopeId}'
			AND created_at >= ${startDate}
			AND created_at <= ${endDate}
		GROUP BY day
		ORDER BY day DESC
	`)

	// 每月聚合
	const monthlyRows = await sql.unsafe(`
		SELECT
			DATE_TRUNC('month', TO_TIMESTAMP(created_at / 1000) AT TIME ZONE 'UTC') AS month,
			SUM(total_tokens) AS total_tokens,
			SUM(prompt_tokens) AS prompt_tokens,
			SUM(completion_tokens) AS completion_tokens,
			COUNT(*) AS turn_count,
			SUM(iterations) AS total_iterations,
			AVG(duration_ms) AS avg_duration_ms
		FROM usage_logs
		WHERE ${column} = '${params.scopeId}'
			AND created_at >= ${startDate}
			AND created_at <= ${endDate}
		GROUP BY month
		ORDER BY month DESC
	`)

	// 总计
	const totalRows = await sql.unsafe(`
		SELECT
			COALESCE(SUM(total_tokens), 0) AS total_tokens,
			COUNT(*) AS total_turns
		FROM usage_logs
		WHERE ${column} = '${params.scopeId}'
			AND created_at >= ${startDate}
			AND created_at <= ${endDate}
	`)

	const daily: UsageAggregate[] = (dailyRows as unknown as any[]).map(row => ({
		period: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10),
		totalTokens: Number(row.total_tokens),
		promptTokens: Number(row.prompt_tokens),
		completionTokens: Number(row.completion_tokens),
		turnCount: Number(row.turn_count),
		totalIterations: Number(row.total_iterations),
		avgDurationMs: Math.round(Number(row.avg_duration_ms)),
	}))

	const monthly: UsageAggregate[] = (monthlyRows as unknown as any[]).map(row => ({
		period: row.month instanceof Date ? row.month.toISOString().slice(0, 7) : String(row.month).slice(0, 7),
		totalTokens: Number(row.total_tokens),
		promptTokens: Number(row.prompt_tokens),
		completionTokens: Number(row.completion_tokens),
		turnCount: Number(row.turn_count),
		totalIterations: Number(row.total_iterations),
		avgDurationMs: Math.round(Number(row.avg_duration_ms)),
	}))

	const totalRow = (totalRows as unknown as any[])[0]
	const totalTokens = Number(totalRow?.total_tokens || 0)
	const totalTurns = Number(totalRow?.total_turns || 0)

	return { daily, monthly, totalTokens, totalTurns }
}

/** 获取用户当月 token 用量（快速查询，供配额检查用） */
export async function getCurrentMonthUsage(
	scope: 'user' | 'org',
	scopeId: string,
): Promise<{ totalTokens: number; turnCount: number }> {
	if (!(await isDbAvailable())) {
		return { totalTokens: 0, turnCount: 0 }
	}

	const sql = getDb()
	const column = scope === 'user' ? 'user_id' : 'org_id'
	const now = Date.now()
	// 当月开始时间
	const monthStart = new Date()
	monthStart.setDate(1)
	monthStart.setHours(0, 0, 0, 0)
	const startTs = monthStart.getTime()

	const rows = await sql.unsafe(`
		SELECT
			COALESCE(SUM(total_tokens), 0) AS total_tokens,
			COUNT(*) AS turn_count
		FROM usage_logs
		WHERE ${column} = '${scopeId}'
			AND created_at >= ${startTs}
			AND created_at <= ${now}
	`)

	const row = (rows as unknown as any[])[0]
	return {
		totalTokens: Number(row?.total_tokens || 0),
		turnCount: Number(row?.turn_count || 0),
	}
}
