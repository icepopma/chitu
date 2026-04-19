/**
 * Code Search Tool — 代码符号搜索工具
 *
 * Agent 通过此工具搜索项目中的代码符号（函数、类、接口等）。
 * 使用 TypeScript Compiler API 构建的符号索引。
 *
 * 学习重点：
 * - 工具描述要清晰告诉 LLM 什么时候该用、怎么用
 * - 懒加载：首次调用时才构建索引，不影响启动
 * - 缓存：索引在内存中缓存，后续查询无开销
 */

import type { Tool, ToolResult } from '../base.js'
import { CodeIndexer } from '../indexer/index.js'

/** 全局索引器单例（懒初始化） */
let indexerInstance: CodeIndexer | null = null

function getIndexer(): CodeIndexer {
  if (!indexerInstance) {
    indexerInstance = new CodeIndexer(process.cwd())
  }
  return indexerInstance
}

export const codeSearchTool: Tool = {
  name: 'code_search',
  description:
    '搜索项目中的代码符号（函数、类、接口、类型、变量等）。' +
    '基于 TypeScript AST 解析，支持按名称、路径、签名搜索。' +
    '适用于：查找某个函数的定义位置、了解某个模块导出了哪些符号、查找相关代码。' +
    '搜索结果包含符号名称、类型、文件路径和行号。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词。可以是符号名（如 runAgentLoop）、类名（如 ThreadManager）、或文件路径片段。',
      },
      max_results: {
        type: 'number',
        description: '最大返回结果数（默认 10）',
      },
    },
    required: ['query'],
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args.query as string
    if (!query) {
      return { content: '错误：缺少 query 参数', isError: true, exitCode: 1 }
    }

    const maxResults = (args.max_results as number) || 10

    try {
      const indexer = getIndexer()
      const results = await indexer.search(query, maxResults)
      const formatted = indexer.formatSearchResults(results)

      // 附加索引统计（仅首次）
      const stats = indexer.getStats()
      const statsLine = stats
        ? `\n---\n索引统计: ${stats.totalFiles} 文件, ${stats.totalSymbols} 符号, 耗时 ${stats.indexTimeMs}ms`
        : ''

      return {
        content: formatted + statsLine,
        isError: false,
        exitCode: 0,
      }
    } catch (err: any) {
      return {
        content: `代码搜索失败: ${err.message}`,
        isError: true,
        exitCode: 1,
      }
    }
  },
}
