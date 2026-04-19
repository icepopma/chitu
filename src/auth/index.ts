/**
 * 认证模块 — WebSocket 连接认证
 *
 * 支持 API Key 和 JWT Token 两种认证方式：
 * 1. API Key：简单的静态密钥，适合单用户/开发场景
 * 2. JWT Token：标准化的 Token 认证，适合多用户场景
 *
 * 参考 Codex codex-rs/login/ 的认证系统
 *
 * 学习重点：
 * - WebSocket 认证通过 HTTP upgrade 请求的 query 参数传递 token
 * - JWT 需要密钥签名验证，不能用 symmetric 猜测
 * - API Key 是最简单的认证：对比字符串即可
 * - 认证失败应该关闭连接（关闭码 4001 = 自定义认证错误）
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** 认证结果 */
export interface AuthResult {
	success: boolean
	/** 认证类型 */
	method?: 'apikey' | 'jwt'
	/** 认证失败原因 */
	reason?: string
	/** JWT 认证时的用户 ID */
	userId?: string
	/** JWT 认证时的组织 ID */
	orgId?: string
}

/**
 * 验证 WebSocket 连接的认证信息
 *
 * 从 HTTP upgrade 请求中提取 token 参数：
 * - `ws://localhost:8080/?token=xxx`
 *
 * 认证顺序：
 * 1. 无 token 且为开发模式 → 允许（方便本地开发）
 * 2. API Key 匹配 → 允许
 * 3. JWT 签名验证通过 → 允许
 * 4. 其他 → 拒绝
 */
export function authenticateConnection(token: string | undefined): AuthResult {
	// 1. 无认证模式（开发环境）
	const authDisabled = process.env.CHITU_AUTH_DISABLED === 'true'
	if (authDisabled) {
		return { success: true, method: undefined }
	}

	// 没有配置任何密钥 → 开发模式，允许无认证
	const apiKey = process.env.CHITU_API_KEY
	const jwtSecret = process.env.CHITU_JWT_SECRET

	if (!apiKey && !jwtSecret) {
		return { success: true }
	}

	// 没有 token 但需要认证
	if (!token) {
		return { success: false, reason: 'Missing authentication token' }
	}

	// 2. 尝试 API Key 认证
	if (apiKey) {
		if (verifyApiKey(token, apiKey)) {
			return { success: true, method: 'apikey' }
		}
	}

	// 3. 尝试 JWT Token 认证
	if (jwtSecret) {
		const jwtResult = verifyJwt(token, jwtSecret)
		if (jwtResult.success) {
			return { success: true, method: 'jwt' }
		}
	}

	return { success: false, reason: 'Invalid authentication token' }
}

/**
 * 安全比较 API Key（timing-safe）
 *
 * 使用 crypto.timingSafeEqual 防止时序攻击
 */
function verifyApiKey(provided: string, expected: string): boolean {
	if (provided.length !== expected.length) return false
	try {
		return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
	} catch {
		return false
	}
}

/**
 * 验证 JWT Token（简化实现）
 *
 * 支持 HS256 算法。不依赖外部库（jsonwebtoken），
 * 因为只需要最基本的验证能力。
 *
 * JWT 结构：header.payload.signature
 * - header: { alg: "HS256", typ: "JWT" }
 * - payload: { sub, iat, exp }
 * - signature: HMAC-SHA256(base64(header) + "." + base64(payload), secret)
 */
function verifyJwt(token: string, secret: string): AuthResult {
	try {
		const parts = token.split('.')
		if (parts.length !== 3) {
			return { success: false, reason: 'Invalid JWT format' }
		}

		const [headerB64, payloadB64, signatureB64] = parts

		// 验证签名
		const expectedSig = createHmac('sha256', secret)
			.update(`${headerB64}.${payloadB64}`)
			.digest('base64url')

		if (!timingSafeEqual(
			Buffer.from(signatureB64),
			Buffer.from(expectedSig),
		)) {
			return { success: false, reason: 'Invalid JWT signature' }
		}

		// 解析 payload
		const payload = JSON.parse(
			Buffer.from(payloadB64, 'base64url').toString('utf-8'),
		)

		// 检查过期时间
		if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
			return { success: false, reason: 'JWT token expired' }
		}

		return { success: true, method: 'jwt', userId: payload.userId, orgId: payload.orgId }
	} catch (err: any) {
		return { success: false, reason: `JWT verification failed: ${err.message}` }
	}
}

/**
 * 从 HTTP upgrade 请求中提取 token 参数
 */
export function extractTokenFromRequest(req: any): string | undefined {
	const url = req.url || ''
	const match = url.match(/[?&]token=([^&]+)/)
	return match ? decodeURIComponent(match[1]) : undefined
}
