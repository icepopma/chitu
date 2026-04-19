/**
 * 代码语义索引器 — 主模块
 *
 * 负责扫描项目文件、构建符号索引、提供查询接口。
 * 集成 symbols.ts（AST 解析）和 search.ts（搜索）。
 *
 * 学习重点：
 * - 文件系统遍历：递归扫描目录，过滤 node_modules 等
 * - 增量索引：只索引修改过的文件（通过 mtime 检测）
 * - 索引缓存：内存中保存索引，避免重复解析
 * - 懒加载：首次查询时才构建索引，不影响启动速度
 */

import { readdirSync, statSync, existsSync } from 'fs'
import { join, extname } from 'path'
import type { SymbolEntry, IndexStats, IndexerConfig } from './types.js'
import { DEFAULT_INDEXER_CONFIG } from './symbols.js'
import { parseFileSymbols } from './symbols.js'
import { searchSymbols } from './search.js'

/** 文件索引缓存 */
interface FileIndex {
  /** 文件修改时间 */
  mtimeMs: number
  /** 该文件的符号列表 */
  symbols: SymbolEntry[]
}

/**
 * CodeIndexer — 代码语义索引器
 *
 * 使用方式：
 *   const indexer = new CodeIndexer(projectRoot)
 *   await indexer.buildIndex()        // 构建索引
 *   const results = indexer.search('runAgentLoop')  // 搜索符号
 */
export class CodeIndexer {
  private config: IndexerConfig
  /** 文件索引缓存：filePath → FileIndex */
  private fileIndex = new Map<string, FileIndex>()
  /** 全局符号索引（扁平数组，搜索用） */
  private allSymbols: SymbolEntry[] = []
  /** 索引统计 */
  private stats: IndexStats | null = null
  /** 是否已构建索引 */
  private indexed = false

  constructor(projectRoot?: string) {
    this.config = {
      ...DEFAULT_INDEXER_CONFIG,
      projectRoot: projectRoot || process.cwd(),
    }
  }

  /**
   * 构建项目索引
   *
   * 递归扫描项目目录，解析所有 TS/JS 文件的 AST，
   * 提取符号信息并缓存。
   */
  async buildIndex(): Promise<IndexStats> {
    const startTime = Date.now()
    this.allSymbols = []
    this.fileIndex.clear()

    const files = this.collectFiles()
    let totalFiles = 0

    for (const filePath of files) {
      try {
        const stat = statSync(filePath)
        const cached = this.fileIndex.get(filePath)

        // 增量索引：文件没变就跳过
        if (cached && cached.mtimeMs === stat.mtimeMs) {
          this.allSymbols.push(...cached.symbols)
          totalFiles++
          continue
        }

        const symbols = parseFileSymbols(filePath, this.config.projectRoot)
        this.fileIndex.set(filePath, {
          mtimeMs: stat.mtimeMs,
          symbols,
        })
        this.allSymbols.push(...symbols)
        totalFiles++
      } catch {
        // 单个文件解析失败不影响整体索引
      }
    }

    const byKind = {} as Record<string, number>
    for (const sym of this.allSymbols) {
      byKind[sym.kind] = (byKind[sym.kind] || 0) + 1
    }

    this.stats = {
      totalFiles,
      totalSymbols: this.allSymbols.length,
      byKind: byKind as IndexStats['byKind'],
      indexTimeMs: Date.now() - startTime,
      indexedAt: Date.now(),
    }

    this.indexed = true
    return this.stats
  }

  /**
   * 搜索符号
   *
   * 如果索引未构建，先自动构建（懒加载）。
   */
  async search(query: string, maxResults?: number): Promise<import('./types.js').SearchResult[]> {
    if (!this.indexed) {
      await this.buildIndex()
    }
    return searchSymbols(query, this.allSymbols, maxResults)
  }

  /**
   * 获取指定文件的所有符号
   */
  getFileSymbols(filePath: string): SymbolEntry[] {
    const absolutePath = join(this.config.projectRoot, filePath)
    const cached = this.fileIndex.get(absolutePath)
    return cached?.symbols || []
  }

  /**
   * 获取所有已索引的符号
   */
  getAllSymbols(): SymbolEntry[] {
    return this.allSymbols
  }

  /**
   * 获取索引统计
   */
  getStats(): IndexStats | null {
    return this.stats
  }

  /**
   * 判断索引是否已构建
   */
  get isIndexed(): boolean {
    return this.indexed
  }

  /**
   * 格式化搜索结果为文本（给 Agent 看的）
   */
  formatSearchResults(results: import('./types.js').SearchResult[]): string {
    if (results.length === 0) {
      return '未找到匹配的符号。'
    }

    const lines = results.map((r, i) => {
      const sym = r.symbol
      const location = `${sym.filePath}:${sym.startLine}`
      const exported = sym.exportName ? ' (exported)' : ''
      const sig = sym.signature ? `\n    签名: ${sym.signature}` : ''
      return `${i + 1}. [${sym.kind}] ${sym.name}${exported} — ${location}${sig}`
    })

    return `找到 ${results.length} 个匹配符号:\n${lines.join('\n')}`
  }

  /**
   * 递归收集项目中的 TS/JS 文件
   */
  private collectFiles(): string[] {
    const files: string[] = []
    const root = this.config.projectRoot

    if (!existsSync(root)) return files

    const walk = (dir: string) => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            // 跳过排除目录
            if (this.config.excludeDirs.includes(entry.name)) continue
            // 跳过隐藏目录
            if (entry.name.startsWith('.')) continue
            walk(join(dir, entry.name))
          } else if (entry.isFile()) {
            const ext = extname(entry.name)
            if (this.config.includePatterns.includes(ext)) {
              files.push(join(dir, entry.name))
            }
          }
        }
      } catch {
        // 目录读取失败跳过
      }
    }

    walk(root)
    return files
  }
}
