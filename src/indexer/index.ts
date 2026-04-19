/**
 * 代码语义索引模块 — 入口
 *
 * 统一导出索引相关的类型、搜索、索引器、工具。
 *
 * 使用方式：
 *   import { CodeIndexer } from '../indexer/index.js'
 *   const indexer = new CodeIndexer(projectRoot)
 *   const results = await indexer.search('runAgentLoop')
 */

export type { SymbolEntry, SymbolKind, SearchResult, IndexStats, IndexerConfig } from './types.js'
export { CodeIndexer } from './indexer.js'
export { searchSymbols } from './search.js'
export { parseFileSymbols, DEFAULT_INDEXER_CONFIG } from './symbols.js'
export { codeSearchTool } from './tool.js'
