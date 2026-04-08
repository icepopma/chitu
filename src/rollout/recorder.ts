/**
 * RolloutRecorder — JSONL 事件流记录器
 *
 * 对齐 Codex rollout/recorder.rs
 * 每个 Thread 的事件流记录到一个 .jsonl 文件
 * 每行是一个 JSON 对象，包含事件类型、事件数据、时间戳
 *
 * 用途：
 * 1. 审计追踪 — 完整记录 Agent 的每一步操作
 * 2. 调试回放 — 重放事件流还原问题现场
 * 3. 会话恢复 — 从事件流重建 Thread 状态
 * 4. 会话派生 — 从某个时间点 fork 出新 Thread
 */

import { appendFile, readFile, unlink } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { AppEvent } from '../types.js'

/** JSONL 中每条记录的格式 */
export interface RolloutEntry {
  /** 事件时间戳（毫秒） */
  ts: number
  /** 事件类型 */
  type: AppEvent['type']
  /** 事件数据（序列化后） */
  data: AppEvent
}

export class RolloutRecorder {
  private dataDir: string

  constructor(dataDir?: string) {
    this.dataDir = dataDir || './chitu-data/rollouts'
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true })
    }
  }

  /** 记录一个事件到对应 Thread 的 JSONL 文件 */
  async record(threadId: string, event: AppEvent): Promise<void> {
    const entry: RolloutEntry = {
      ts: Date.now(),
      type: event.type,
      data: event,
    }
    const filePath = this.getFilePath(threadId)
    await appendFile(filePath, JSON.stringify(entry) + '\n', 'utf-8')
  }

  /** 读取某个 Thread 的所有事件记录 */
  async replay(threadId: string): Promise<RolloutEntry[]> {
    const filePath = this.getFilePath(threadId)
    if (!existsSync(filePath)) return []

    const raw = await readFile(filePath, 'utf-8')
    const lines = raw.split('\n').filter(line => line.trim().length > 0)
    const entries: RolloutEntry[] = []

    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as RolloutEntry)
      } catch {
        // 跳过损坏的行
      }
    }

    return entries
  }

  /** 删除某个 Thread 的事件记录 */
  async delete(threadId: string): Promise<void> {
    const filePath = this.getFilePath(threadId)
    if (existsSync(filePath)) {
      await unlink(filePath)
    }
  }

  /** 获取文件路径 */
  private getFilePath(threadId: string): string {
    return join(this.dataDir, `${threadId}.jsonl`)
  }
}
