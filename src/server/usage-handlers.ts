/**
 * Usage Handlers — 用量查询 JSON-RPC 处理层
 *
 * 薄适配层：将 JSON-RPC 参数映射到 usage.ts 和 quota.ts 的函数调用。
 */

import { getUserUsage, getOrgUsage } from '../monitoring/usage.js'
import { checkQuota, setQuotaConfig, getQuotaConfig, getPlanDefinition, type PlanType } from '../monitoring/quota.js'

/** 查询用户用量 */
export async function handleGetUsage(params: Record<string, unknown>) {
	const userId = params.userId as string | undefined
	const orgId = params.orgId as string | undefined
	const startDate = params.startDate as number | undefined
	const endDate = params.endDate as number | undefined

	if (orgId) {
		return getOrgUsage(orgId, { startDate, endDate })
	}
	if (userId) {
		return getUserUsage(userId, { startDate, endDate })
	}
	throw new Error('Missing userId or orgId')
}

/** 检查配额 */
export async function handleCheckQuota(params: Record<string, unknown>) {
	const userId = params.userId as string | undefined
	const orgId = params.orgId as string | undefined

	if (orgId) {
		return checkQuota('org', orgId)
	}
	if (userId) {
		return checkQuota('user', userId)
	}
	throw new Error('Missing userId or orgId')
}

/** 设置配额 */
export async function handleSetQuota(params: Record<string, unknown>) {
	const scope = params.scope as 'user' | 'org'
	const scopeId = params.scopeId as string
	const plan = params.plan as PlanType

	if (!scope || !scopeId || !plan) {
		throw new Error('Missing scope, scopeId, or plan')
	}

	const validPlans: PlanType[] = ['free', 'pro', 'enterprise']
	if (!validPlans.includes(plan)) {
		throw new Error(`Invalid plan: ${plan}. Valid plans: ${validPlans.join(', ')}`)
	}

	return setQuotaConfig(scope, scopeId, plan, {
		monthlyTokenLimit: params.monthlyTokenLimit as number | undefined,
		monthlyTurnLimit: params.monthlyTurnLimit as number | undefined,
	})
}

/** 获取配额配置 */
export async function handleGetQuota(params: Record<string, unknown>) {
	const scope = params.scope as 'user' | 'org'
	const scopeId = params.scopeId as string

	if (!scope || !scopeId) {
		throw new Error('Missing scope or scopeId')
	}

	const config = await getQuotaConfig(scope, scopeId)
	if (!config) {
		return { plan: 'free', definition: getPlanDefinition('free') }
	}
	return { ...config, definition: getPlanDefinition(config.plan) }
}

/** 列出所有可用套餐 */
export async function handleListPlans() {
	const plans = (['free', 'pro', 'enterprise'] as PlanType[]).map(plan => ({
		plan,
		definition: getPlanDefinition(plan),
	}))
	return { plans }
}
