/**
 * Indexer Plugin — 注册 code_search 工具到工具系统
 *
 * 作为 Plugin 加载到 PluginLoader，与其他工具（exec、files、git 等）一致。
 */

import type { Plugin } from '../plugin-types.js'
import { codeSearchTool } from '../../indexer/tool.js'

/** Indexer 插件 — 提供代码符号搜索工具 */
export const indexerPlugin: Plugin = {
  name: 'indexer',
  version: '1.0.0',
  description: '代码语义搜索（AST 符号索引）',

  tools: [codeSearchTool],
}
