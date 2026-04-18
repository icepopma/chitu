/**
 * 数据库连接池
 *
 * 使用 @neondatabase/serverless 驱动连接 Neon PostgreSQL。
 * 连接串通过 NEON_DATABASE_URL 环境变量配置。
 *
 * 学习重点：
 * - Neon serverless 使用 WebSocket 连接，适合 Serverless 环境
 * - neon() 返回的是 SQL 模板标签函数，防止 SQL 注入
 * - 连接池由驱动自动管理
 */

import { neon } from '@neondatabase/serverless'

let _sql: ReturnType<typeof neon> | null = null

/** 获取数据库连接（单例） */
export function getDb() {
	if (!_sql) {
		const connectionString = process.env.NEON_DATABASE_URL
		if (!connectionString) {
			throw new Error('NEON_DATABASE_URL 环境变量未设置。请在 .env 文件或环境变量中配置 Neon PostgreSQL 连接串。')
		}
		_sql = neon(connectionString)
	}
	return _sql
}

/** 检查数据库是否可用 */
export async function isDbAvailable(): Promise<boolean> {
	try {
		const sql = getDb()
		await sql`SELECT 1`
		return true
	} catch {
		return false
	}
}
