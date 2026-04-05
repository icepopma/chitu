/**
 * ThreadStore — 把 Thread 存到 JSON 文件
 *
 * 每个 Thread 一个 JSON 文件， 数据目录默认 chitu-data/threads/
 */

import { readFile, writeFile, unlink } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { readdir } from 'fs/promises'
import type { Thread } from '../types.js'

export class ThreadStore {
  private dataDir: string

  constructor(dataDir?: string) {
    this.dataDir = dataDir || './chitu-data/threads'
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true })
    }
  }

  /** 保存 Thread */
  async save(thread: Thread): Promise<void> {
    const filePath = `${this.dataDir}/${thread.id}.json`
    await writeFile(filePath, JSON.stringify(thread, null, 2), 'utf-8')
  }

  /** 加载 Thread */
  async load(threadId: string): Promise<Thread | undefined> {
    const filePath = `${this.dataDir}/${threadId}.json`
    if (!existsSync(filePath)) return undefined
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw) as Thread
  }

  /** 列出所有 Thread（摘要信息) */
  async list(): Promise<Array<{ id: string; title: string; updatedAt: number }>> {
    if (!existsSync(this.dataDir)) return []

    const files = await readdir(this.dataDir)
    const threads: Array<{ id: string; title: string; updatedAt: number }> = []

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = await readFile(`${this.dataDir}/${file}`, 'utf-8')
        const data = JSON.parse(raw) as Thread
        threads.push({
          id: data.id,
          title: data.title || 'Untitled',
          updatedAt: data.updatedAt || 0,
        })
      } catch {
        continue
      }
    }

    return threads.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** 删除 Thread */
  async delete(threadId: string): Promise<void> {
    const filePath = `${this.dataDir}/${threadId}.json`
    if (existsSync(filePath)) {
      await unlink(filePath)
    }
  }
}
