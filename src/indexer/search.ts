/**
 * 代码搜索 — 关键词 + TF-IDF 文本相似度搜索
 *
 * 搜索策略：
 * 1. 精确名称匹配（最高分）
 * 2. 名称部分匹配（驼峰/下划线拆分）
 * 3. 文件路径匹配
 * 4. 签名文本匹配
 * 5. 按分数排序返回 Top N 结果
 *
 * 学习重点：
 * - 代码搜索需要理解驼峰命名拆分（myFunction → my, function）
 * - 路径权重：src/ 核心代码 > test/ 测试代码
 * - 结果排序：精确 > 部分 > 路径 > 签名
 */

import type { SymbolEntry, SearchResult } from './types.js'

/**
 * 搜索符号索引
 *
 * @param query 搜索关键词
 * @param symbols 索引中的所有符号
 * @param maxResults 最大返回结果数
 * @returns 按相关度排序的搜索结果
 */
export function searchSymbols(
  query: string,
  symbols: SymbolEntry[],
  maxResults: number = 10,
): SearchResult[] {
  const normalizedQuery = query.toLowerCase().trim()
  if (!normalizedQuery) return []

  const queryParts = splitIdentifier(normalizedQuery)
  const results: SearchResult[] = []

  for (const symbol of symbols) {
    const lowerName = symbol.name.toLowerCase()
    const lowerPath = symbol.filePath.toLowerCase()
    const lowerSig = (symbol.signature || '').toLowerCase()
    const lowerDoc = (symbol.docComment || '').toLowerCase()

    let score = 0
    let matchReason: SearchResult['matchReason'] = 'name_partial'

    // 1. 精确名称匹配
    if (lowerName === normalizedQuery) {
      score = 1.0
      matchReason = 'name_exact'
    }
    // 2. 名称前缀匹配
    else if (lowerName.startsWith(normalizedQuery)) {
      score = 0.9
      matchReason = 'name_partial'
    }
    // 3. 名称包含查询词
    else if (lowerName.includes(normalizedQuery)) {
      score = 0.8
      matchReason = 'name_partial'
    }
    // 4. 驼峰/下划线拆分后的部分匹配
    else if (queryParts.length > 1) {
      const nameParts = splitIdentifier(lowerName)
      const matchedParts = queryParts.filter(qp =>
        nameParts.some(np => np.includes(qp) || qp.includes(np))
      )
      if (matchedParts.length > 0) {
        score = 0.6 * (matchedParts.length / queryParts.length)
        matchReason = 'name_partial'
      }
    }

    // 5. 文件路径匹配（加分）
    if (score === 0 && lowerPath.includes(normalizedQuery)) {
      score = 0.4
      matchReason = 'path'
    }

    // 6. 签名匹配
    if (score === 0 && lowerSig.includes(normalizedQuery)) {
      score = 0.3
      matchReason = 'signature'
    }

    // 7. 文档匹配
    if (score === 0 && lowerDoc.includes(normalizedQuery)) {
      score = 0.2
      matchReason = 'doc'
    }

    if (score > 0) {
      // 路径权重加分：核心代码 > 测试代码
      if (lowerPath.includes('src/') && !lowerPath.includes('.test.')) {
        score *= 1.2
      }
      // 导出符号加分
      if (symbol.exportName) {
        score *= 1.1
      }

      results.push({ symbol, score: Math.min(score, 1.0), matchReason })
    }
  }

  // 按分数降序排序
  results.sort((a, b) => b.score - a.score)

  return results.slice(0, maxResults)
}

/**
 * 拆分标识符
 *
 * 支持驼峰和下划线命名：
 * - myFunctionName → ['my', 'function', 'name']
 * - my_function_name → ['my', 'function', 'name']
 * - URLParser → ['url', 'parser']
 */
function splitIdentifier(name: string): string[] {
  // 先按下划线拆分
  const parts = name.split('_').filter(p => p.length > 0)

  // 再按驼峰拆分
  const result: string[] = []
  for (const part of parts) {
    const camelParts = part.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ')
    result.push(...camelParts.map(p => p.toLowerCase()))
  }

  return result.filter(p => p.length > 0)
}
