/**
 * 配额系统 — 免费额度 + 付费套餐
 *
 * 定义套餐计划、检查用量是否超限、管理配额设置。
 * 配额存储在 quotas 表中，支持按 user/org 粒度设置。
 *
 * 学习重点：
 * - 配额系统是计费的核心逻辑层
 * - 默认套餐通过环境变量或代码常量定义，可被数据库中的配置覆盖
 * - 检查配额在 turn 开始前执行，超限则拒绝请求
 */

import { randomBytes } from 'node:crypto'
import { getDb, isDbAvailable } from '../db/connection.js'
import { getCurrentMonthUsage } from './usage.js'
import { logger } from './logger.js'

// ===== 类型 =====

export type PlanType = 'free' | 'pro' | 'enterprise'

export interface QuotaPlan {
	/** 套餐名称 */
	name: string
	/** 每月 token 上限 */
	monthlyTokenLimit: number
	/** 每月 turn 上限 */
	monthlyTurnLimit: number
	/** 并发线程上限 */
	concurrentThreads: number
	/** 最大单次 turn 迭代次数 */
	maxIterationsPerTurn: number
}

export interface QuotaCheckResult {
	/** 是否允许执行 */
	allowed: boolean
	/** 当前套餐 */
	plan: PlanType
	/** 当月已用 token */
	usedTokens: number
	/** 当月 token 上限 */
	tokenLimit: number
	/** 当月已用 turn 数 */
	usedTurns: number
	/** 当月 turn 上限 */
	turnLimit: number
	/** 拒绝原因 */
	reason?: string
}

export interface QuotaConfig {
	id: string
	scope: 'user' | 'org'
	scopeId: string
	plan: PlanType
	monthlyTokenLimit: number
	monthlyTurnLimit: number
	createdAt: number
	updatedAt: number
}

// ===== 套餐定义 =====

const PLANS: Record<PlanType, QuotaPlan> = {
	free: {
		name: '免费版',
		monthlyTokenLimit: 1_000_000,   // 100 万 token/月
		monthlyTurnLimit: 1000,          // 1000 次 turn/月
		concurrentThreads: 3,
		maxIterationsPerTurn: 50,
	},
	pro: {
		name: '专业版',
		monthlyTokenLimit: 10_000_000,   // 1000 万 token/月
		monthlyTurnLimit: 10000,          // 1 万次 turn/月
		concurrentThreads: 10,
		maxIterationsPerTurn: 200,
	},
	enterprise: {
		name: '企业版',
		monthlyTokenLimit: 100_000_000,   // 1 亿 token/月
		monthlyTurnLimit: 100000,          // 10 万次 turn/月
		concurrentThreads: 50,
		maxIterationsPerTurn: 10000,
	},
}

// 环境变量覆盖默认套餐
function getDefaultPlan(): PlanType {
	const envPlan = process.env.CHITU_DEFAULT_PLAN as PlanType
	if (envPlan && PLANS[envPlan]) return envPlan
	return 'free'
}

/** 获取套餐定义 */
export function getPlanDefinition(plan: PlanType): QuotaPlan {
	return PLANS[plan]
}

/** 列出所有可用套餐 */
export function listPlans(): Array<PlanType & { definition: QuotaPlan }> {
	return (Object.entries(PLANS) as [PlanType, QuotaPlan][]).map(([key, def]) => ({
		...key,
		definition: def,
	}))
}

// ===== 配额检查 =====

/**
 * 检查配额 — turn 开始前调用
 *
 * 返回是否允许执行，以及当前用量信息。
 * 如果用量超限，返回 allowed=false 和拒绝原因。
 */
export async function checkQuota(
	scope: 'user' | 'org',
	scopeId: string,
): Promise<QuotaCheckResult> {
	// 开发模式跳过配额检查
	if (process.env.CHITU_QUOTA_DISABLED === 'true') {
		return {
			allowed: true,
			plan: 'free',
			usedTokens: 0,
			tokenLimit: Infinity,
			usedTurns: 0,
			turnLimit: Infinity,
		}
	}

	// 获取用户/组织的套餐配置
	const config = await getQuotaConfig(scope, scopeId)
	const plan = config?.plan || getDefaultPlan()
	const planDef = PLANS[plan]
	const tokenLimit = config?.monthlyTokenLimit || planDef.monthlyTokenLimit
	const turnLimit = config?.monthlyTurnLimit || planDef.monthlyTurnLimit

	// 查询当月用量
	const usage = await getCurrentMonthUsage(scope, scopeId)

	const result: QuotaCheckResult = {
		allowed: true,
		plan,
		usedTokens: usage.totalTokens,
		tokenLimit,
		usedTurns: usage.turnCount,
		turnLimit,
	}

	if (usage.totalTokens >= tokenLimit) {
		result.allowed = false
		result.reason = `当月 token 用量已达上限 (${usage.totalTokens}/${tokenLimit})，请升级套餐`
	} else if (usage.turnCount >= turnLimit) {
		result.allowed = false
		result.reason = `当月 turn 数已达上限 (${usage.turnCount}/${turnLimit})，请升级套餐`
	}

	return result
}

// ===== 配额配置管理 =====

/** 获取配额配置 */
export async function getQuotaConfig(
	scope: 'user' | 'org',
	scopeId: string,
): Promise<QuotaConfig | null> {
	if (!(await isDbAvailable())) return null

	const sql = getDb()
	const rows = await sql`
		SELECT id, scope, scope_id, plan, monthly_token_limit, monthly_turn_limit, created_at, updated_at
		FROM quotas
		WHERE scope = ${scope} AND scope_id = ${scopeId}
	`

	if (rows.length === 0) return null
	const row = rows[0] as any
	return {
		id: row.id,
		scope: row.scope,
		scopeId: row.scope_id,
		plan: row.plan as PlanType,
		monthlyTokenLimit: row.monthly_token_limit,
		monthlyTurnLimit: row.monthly_turn_limit,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}
}

/** 设置配额（创建或更新） */
export async function setQuotaConfig(
	scope: 'user' | 'org',
	scopeId: string,
	plan: PlanType,
	overrides?: { monthlyTokenLimit?: number; monthlyTurnLimit?: number },
): Promise<QuotaConfig> {
	const sql = getDb()
	const planDef = PLANS[plan]
	const now = Date.now()
	const id = randomBytes(16).toString('hex')
	const tokenLimit = overrides?.monthlyTokenLimit ?? planDef.monthlyTokenLimit
	const turnLimit = overrides?.monthlyTurnLimit ?? planDef.monthlyTurnLimit

	await sql`
		INSERT INTO quotas (id, scope, scope_id, plan, monthly_token_limit, monthly_turn_limit, created_at, updated_at)
		VALUES (${id}, ${scope}, ${scopeId}, ${plan}, ${tokenLimit}, ${turnLimit}, ${now}, ${now})
		ON CONFLICT (scope, scope_id) DO UPDATE SET
			plan = ${plan},
			monthly_token_limit = ${tokenLimit},
			monthly_turn_limit = ${turnLimit},
			updated_at = ${now}
	`

	logger.info('配额已更新', { scope, scopeId, plan, tokenLimit, turnLimit })

	return {
		id,
		scope,
		scopeId,
		plan,
		monthlyTokenLimit: tokenLimit,
		monthlyTurnLimit: turnLimit,
		createdAt: now,
		updatedAt: now,
	}
}
