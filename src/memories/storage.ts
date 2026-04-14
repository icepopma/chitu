/**
 * 记忆持久化存储
 *
 * 对齐 Codex codex-rs/core/src/memories/storage.rs
 * 简化：用 JSON 文件代替 SQLite（与 Chitu 文件存储模式一致）
 *
 * 存储位置：./chitu-data/memories/memories.json
 * 格式：{ memories: Memory[], updatedAt: number }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'

/** 记忆条目 */
export interface Memory {
  id: string
  category: MemoryCategory
  content: string
  sourceThreadId: string
  createdAt: number
}

/** 记忆类别（对齐 Codex memories/prompts.rs 的提取维度） */
export type MemoryCategory =
  | 'preference'    // 用户偏好：用户喜欢/不喜欢的做事方式
  | 'architecture'  // 架构决策：关键设计选择和原因
  | 'convention'    // 项目约定：编码风格、命名模式、文件组织
  | 'failure'       // 已知失败：什么出错了以及如何修复
  | 'fact'          // 关键事实：项目的重要信息

/** 存储文件格式 */
interface MemoryStore {
  memories: Memory[]
  updatedAt: number
}

/** 记忆数量上限 */
const MAX_MEMORIES = 100

/** 注入到对话中的记忆数量上限（避免上下文膨胀） */
const MAX_INJECTED = 20

/** 单条记忆内容最大长度 */
const MAX_CONTENT_LENGTH = 500

/** 默认存储目录 */
const DEFAULT_DATA_DIR = join(process.cwd(), 'chitu-data', 'memories')

/**
 * 记忆存储管理器
 */
export class MemoryStorage {
  private filePath: string

  constructor(dataDir?: string) {
    const dir = dataDir || DEFAULT_DATA_DIR
    this.filePath = join(dir, 'memories.json')
  }

  /** 加载所有记忆 */
  load(): Memory[] {
    try {
      if (!existsSync(this.filePath)) return []
      const raw = readFileSync(this.filePath, 'utf-8')
      const store: MemoryStore = JSON.parse(raw)
      return store.memories || []
    } catch {
      // 文件损坏时备份而不是静默丢弃数据
      const backupPath = this.filePath + '.corrupt.' + Date.now()
      try { renameSync(this.filePath, backupPath) } catch {}
      console.error(`[memories] 存储文件损坏，已备份到 ${backupPath}`)
      return []
    }
  }

  /** 保存记忆列表（原子写入） */
  save(memories: Memory[]): void {
    const trimmed = memories.length > MAX_MEMORIES
      ? memories.slice(-MAX_MEMORIES)
      : memories

    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const store: MemoryStore = {
      memories: trimmed,
      updatedAt: Date.now(),
    }
    // 原子写入：先写临时文件，再 rename（POSIX 保证原子性）
    const tmpPath = this.filePath + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8')
    renameSync(tmpPath, this.filePath)
  }

  /** 添加新记忆（去重：相同类别 + 内容重叠） */
  addMemories(newMemories: Omit<Memory, 'id' | 'createdAt'>[]): Memory[] {
    const existing = this.load()
    const added: Memory[] = []

    for (const mem of newMemories) {
      const newNormalized = mem.content.toLowerCase().trim()
      const isDuplicate = existing.some(m => {
        if (m.category !== mem.category) return false
        const existingNormalized = m.content.toLowerCase().trim()
        // 精确匹配或包含关系（捕获语义重复）
        return existingNormalized === newNormalized ||
          existingNormalized.includes(newNormalized) ||
          newNormalized.includes(existingNormalized)
      })
      if (isDuplicate) continue

      const memory: Memory = {
        id: randomUUID(),
        category: mem.category,
        content: mem.content.slice(0, MAX_CONTENT_LENGTH),
        sourceThreadId: mem.sourceThreadId,
        createdAt: Date.now(),
      }
      existing.push(memory)
      added.push(memory)
    }

    this.save(existing)
    return added
  }

  /** 格式化记忆为注入文本（限制数量，避免上下文膨胀） */
  formatForInjection(memories: Memory[]): string | null {
    if (memories.length === 0) return null

    // 只注入最近的记忆
    const toInject = memories.slice(-MAX_INJECTED)

    const lines: string[] = [
      '# Memories from previous conversations',
      'The following are things learned from previous conversations. Use them to be more effective.',
      '',
    ]

    // 按类别分组
    const grouped = new Map<MemoryCategory, Memory[]>()
    for (const m of toInject) {
      const group = grouped.get(m.category)
      if (group) {
        group.push(m)
      } else {
        grouped.set(m.category, [m])
      }
    }

    const categoryLabels: Record<MemoryCategory, string> = {
      preference: 'User Preferences',
      architecture: 'Architecture Decisions',
      convention: 'Project Conventions',
      failure: 'Known Issues & Fixes',
      fact: 'Key Facts',
    }

    for (const [category, items] of grouped) {
      lines.push(`## ${categoryLabels[category]}`)
      for (const item of items) {
        lines.push(`- ${item.content}`)
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  /** 清空所有记忆（测试用） */
  clear(): void {
    this.save([])
  }
}
