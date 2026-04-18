/**
 * Crash Recovery — 服务端状态持久化与崩溃恢复
 *
 * 对齐 Codex codex-rs/core/src/state/session.rs 的 crash recovery 机制。
 *
 * 做的事：
 * 1. Turn 开始时写入 active_turns 表（status=in_progress）
 * 2. Turn 完成/失败时标记 status=completed/failed
 * 3. 服务启动时扫描未完成的 turn 标记为 interrupted
 * 4. envSnapshots 持久化到数据库，重启后可恢复
 *
 * 学习重点：
 * - 数据库级别的状态追踪比内存 Map 更可靠（进程崩溃不丢失）
 * - 启动时扫描是 crash recovery 的标准模式
 * - envSnapshot 持久化确保重启后环境差异检测不中断
 */

import { getDb, isDbAvailable } from './connection.js'
import type { EnvSnapshot } from '../utils/env-diff.js'

/** active_turns 表的记录类型 */
export interface ActiveTurnRecord {
	turnId: string
	threadId: string
	status: 'in_progress' | 'completed' | 'failed' | 'interrupted'
	startedAt: number
	completedAt?: number
	envSnapshot?: EnvSnapshot | null
}

/**
 * 记录 Turn 开始到 active_turns 表
 */
export async function recordTurnStart(
	turnId: string,
	threadId: string,
	envSnapshot?: EnvSnapshot,
): Promise<void> {
	if (!(await isDbAvailable())) return

	const sql = getDb()
	const now = Date.now()
	const snapshotJson = envSnapshot ? JSON.stringify(envSnapshot) : null

	await sql`
		INSERT INTO active_turns (turn_id, thread_id, status, started_at, env_snapshot)
		VALUES (${turnId}, ${threadId}, 'in_progress', ${now}, ${snapshotJson})
		ON CONFLICT (turn_id) DO UPDATE SET
			status = 'in_progress',
			started_at = ${now},
			completed_at = NULL,
			env_snapshot = ${snapshotJson}
	`
}

/**
 * 更新 Turn 状态（完成/失败）
 */
export async function recordTurnComplete(
	turnId: string,
	status: 'completed' | 'failed' | 'interrupted',
): Promise<void> {
	if (!(await isDbAvailable())) return

	const sql = getDb()
	const now = Date.now()

	await sql`
		UPDATE active_turns
		SET status = ${status}, completed_at = ${now}
		WHERE turn_id = ${turnId}
	`
}

/**
 * 更新 Turn 的 envSnapshot
 */
export async function updateTurnEnvSnapshot(
	threadId: string,
	envSnapshot: EnvSnapshot,
): Promise<void> {
	if (!(await isDbAvailable())) return

	const sql = getDb()
	const snapshotJson = JSON.stringify(envSnapshot)

	// 更新该 thread 最新的 active turn 的 env_snapshot
	await sql`
		UPDATE active_turns
		SET env_snapshot = ${snapshotJson}
		WHERE thread_id = ${threadId}
			AND status = 'in_progress'
	`
}

/**
 * 启动时扫描未完成的 turn 并标记为 interrupted
 *
 * 返回被中断的 turn 数量和详情
 */
export async function recoverInterruptedTurns(): Promise<ActiveTurnRecord[]> {
	if (!(await isDbAvailable())) return []

	const sql = getDb()

	// 查找所有 in_progress 的 turn
	const rows = await sql`
		SELECT turn_id, thread_id, status, started_at, completed_at, env_snapshot
		FROM active_turns
		WHERE status = 'in_progress'
	` as any[]

	if (rows.length === 0) return []

	// 标记为 interrupted
	const now = Date.now()
	for (const row of rows) {
		await sql`
			UPDATE active_turns
			SET status = 'interrupted', completed_at = ${now}
			WHERE turn_id = ${row.turn_id}
		`
	}

	// 转换为记录类型
	return rows.map((row: any) => ({
		turnId: row.turn_id as string,
		threadId: row.thread_id as string,
		status: 'interrupted' as const,
		startedAt: Number(row.started_at),
		completedAt: now,
		envSnapshot: row.env_snapshot ? JSON.parse(row.env_snapshot) : null,
	}))
}

/**
 * 获取线程最近一次 turn 的 envSnapshot（用于重启后恢复）
 */
export async function getLatestEnvSnapshot(threadId: string): Promise<EnvSnapshot | null> {
	if (!(await isDbAvailable())) return null

	const sql = getDb()

	const rows = await sql`
		SELECT env_snapshot
		FROM active_turns
		WHERE thread_id = ${threadId}
			AND env_snapshot IS NOT NULL
		ORDER BY started_at DESC
		LIMIT 1
	` as any[]

	if (rows.length === 0 || !rows[0].env_snapshot) return null

	return JSON.parse(rows[0].env_snapshot) as EnvSnapshot
}
