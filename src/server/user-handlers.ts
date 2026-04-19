/**
 * User Handlers — 用户/组织 JSON-RPC 处理层
 *
 * 薄适配层：将 JSON-RPC 参数映射到 user-store 的函数调用。
 * 与 message-processor.ts 中的其他 handler 风格保持一致。
 *
 * 学习重点：
 * - Handler 层只做参数提取和错误包装，业务逻辑在 user-store.ts
 * - 所有 handler 都是 async，因为涉及数据库操作
 */

import {
	registerUser as storeRegisterUser,
	loginUser as storeLoginUser,
	getUserById as storeGetUserById,
	listUsers as storeListUsers,
	createOrganization as storeCreateOrganization,
	listUserOrganizations as storeListUserOrganizations,
	inviteToOrganization as storeInviteToOrganization,
	listOrgMembers as storeListOrgMembers,
	getUserRole as storeGetUserRole,
} from '../auth/user-store.js'

/** 用户注册 */
export async function registerUser(params: Record<string, unknown>) {
	const email = params.email as string
	const password = params.password as string
	const displayName = params.displayName as string | undefined

	if (!email || !password) {
		throw new Error('Missing email or password')
	}

	if (password.length < 6) {
		throw new Error('Password must be at least 6 characters')
	}

	return storeRegisterUser(email, password, displayName)
}

/** 用户登录 */
export async function loginUser(params: Record<string, unknown>) {
	const email = params.email as string
	const password = params.password as string

	if (!email || !password) {
		throw new Error('Missing email or password')
	}

	return storeLoginUser(email, password)
}

/** 获取用户信息 */
export async function getUserById(params: Record<string, unknown>) {
	const id = params.userId as string
	if (!id) throw new Error('Missing userId')

	const user = await storeGetUserById(id)
	if (!user) throw new Error('User not found')
	return user
}

/** 列出所有用户 */
export async function listUsers() {
	return storeListUsers()
}

/** 创建组织 */
export async function createOrganization(params: Record<string, unknown>) {
	const name = params.name as string
	const slug = params.slug as string
	const ownerId = params.ownerId as string

	if (!name || !slug || !ownerId) {
		throw new Error('Missing name, slug, or ownerId')
	}

	return storeCreateOrganization(name, slug, ownerId)
}

/** 列出用户所属的组织 */
export async function listUserOrganizations(params: Record<string, unknown>) {
	const userId = params.userId as string
	if (!userId) throw new Error('Missing userId')

	return storeListUserOrganizations(userId)
}

/** 邀请用户加入组织 */
export async function inviteToOrganization(params: Record<string, unknown>) {
	const orgId = params.orgId as string
	const userId = params.userId as string
	const role = (params.role as string) || 'member'

	if (!orgId || !userId) {
		throw new Error('Missing orgId or userId')
	}

	await storeInviteToOrganization(orgId, userId, role as any)
	return { success: true }
}

/** 获取组织成员列表 */
export async function listOrgMembers(params: Record<string, unknown>) {
	const orgId = params.orgId as string
	if (!orgId) throw new Error('Missing orgId')

	return storeListOrgMembers(orgId)
}

/** 检查用户在组织中的角色 */
export async function getUserRole(params: Record<string, unknown>) {
	const orgId = params.orgId as string
	const userId = params.userId as string
	if (!orgId || !userId) throw new Error('Missing orgId or userId')

	const role = await storeGetUserRole(orgId, userId)
	if (!role) throw new Error('User is not a member of this organization')
	return { role }
}
