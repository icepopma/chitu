/**
 * 代码语义索引 — 类型定义
 *
 * 定义符号索引的核心类型：
 * - SymbolEntry: 代码中的符号（函数、类、接口、类型、变量）
 * - SearchResult: 搜索结果
 * - IndexStats: 索引统计
 *
 * 学习重点：
 * - 代码索引结构：符号名 + 文件位置 + 类型信息
 * - 搜索评分：路径权重 + 关键词匹配
 */

/** 符号类型 */
export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'enum'
  | 'method'
  | 'property'
  | 'import'

/** 代码符号条目 */
export interface SymbolEntry {
  /** 符号名称 */
  name: string
  /** 符号类型 */
  kind: SymbolKind
  /** 所在文件（相对路径） */
  filePath: string
  /** 起始行号（1-based） */
  startLine: number
  /** 结束行号（1-based） */
  endLine: number
  /** 导出名称（如果有） */
  exportName?: string
  /** 签名或简短描述 */
  signature?: string
  /** JSDoc 注释（如果有） */
  docComment?: string
}

/** 搜索结果 */
export interface SearchResult {
  /** 匹配的符号 */
  symbol: SymbolEntry
  /** 相关度分数（0-1，越高越相关） */
  score: number
  /** 匹配原因 */
  matchReason: 'name_exact' | 'name_partial' | 'path' | 'signature' | 'doc'
}

/** 索引统计 */
export interface IndexStats {
  /** 索引的文件数 */
  totalFiles: number
  /** 符号总数 */
  totalSymbols: number
  /** 按类型统计 */
  byKind: Record<SymbolKind, number>
  /** 索引耗时（毫秒） */
  indexTimeMs: number
  /** 最后索引时间 */
  indexedAt: number
}

/** 索引配置 */
export interface IndexerConfig {
  /** 项目根目录 */
  projectRoot: string
  /** 要索引的文件 glob 模式 */
  includePatterns: string[]
  /** 要排除的目录 */
  excludeDirs: string[]
  /** 最大文件大小（字节，超过跳过） */
  maxFileSize: number
}
