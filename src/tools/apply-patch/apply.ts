/**
 * Apply Patch 执行引擎
 *
 * 将解析后的 PatchOp 应用到文件系统。
 * 对齐 Codex apply-patch/lib.rs 的核心逻辑。
 *
 * 学习重点：
 * - UpdateFile：模糊匹配旧行 → 替换为新行
 * - 多 chunk 倒序应用（后面的先改，防止索引偏移）
 * - 文件末尾处理：确保始终以 \n 结尾
 */

import { readFile, writeFile, unlink, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname } from 'path'
import type { PatchOp, UpdateFileOp, UpdateChunk } from './parser.js'
import { seekSequence } from './match.js'

export interface ApplyResult {
  /** 操作类型：A(dd) / M(odify) / D(elete) */
  action: 'A' | 'M' | 'D'
  path: string
}

/**
 * 应用所有 patch 操作
 *
 * 返回每个文件的操作结果
 */
export async function applyPatch(ops: PatchOp[], cwd: string): Promise<ApplyResult[]> {
  const results: ApplyResult[] = []

  for (const op of ops) {
    const resolvedPath = resolvePath(op.path, cwd)
    switch (op.type) {
      case 'add':
        await applyAddFile(resolvedPath, op.lines)
        results.push({ action: 'A', path: op.path })
        break
      case 'delete':
        await applyDeleteFile(resolvedPath)
        results.push({ action: 'D', path: op.path })
        break
      case 'update':
        await applyUpdateFile(resolvedPath, op, cwd)
        if (op.moveTo) {
          results.push({ action: 'M', path: op.moveTo })
        } else {
          results.push({ action: 'M', path: op.path })
        }
        break
    }
  }

  return results
}

/** 解析路径：相对路径基于 cwd */
function resolvePath(path: string, cwd: string): string {
  if (path.startsWith('/')) return path
  return `${cwd}/${path}`.replace(/\/+/g, '/')
}

/** Add File 操作 */
async function applyAddFile(path: string, lines: string[]): Promise<void> {
  const content = lines.join('\n') + '\n'

  // 自动创建父目录
  const dir = dirname(path)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }

  await writeFile(path, content, 'utf-8')
}

/** Delete File 操作 */
async function applyDeleteFile(path: string): Promise<void> {
  if (!existsSync(path)) {
    throw new Error(`文件不存在: ${path}`)
  }
  await unlink(path)
}

/** Update File 操作 */
async function applyUpdateFile(path: string, op: UpdateFileOp, cwd: string): Promise<void> {
  if (!existsSync(path)) {
    throw new Error(`文件不存在: ${path}`)
  }

  // 读取原文件，按行分割
  const content = await readFile(path, 'utf-8')
  let lines = content.split('\n')
  // 去掉末尾的空行（来自文件最后的 \n）
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  // 收集所有替换操作
  const replacements: Array<{ start: number; count: number; newLines: string[] }> = []
  let searchStart = 0

  for (const chunk of op.chunks) {
    // 如果有上下文头，先定位到它
    if (chunk.contextHeader) {
      const contextLines = chunk.contextHeader.split('\n')
      const contextIdx = seekSequence(lines, contextLines, searchStart)
      if (contextIdx !== -1) {
        searchStart = contextIdx + contextLines.length
      }
    }

    // 纯添加（oldLines 为空）
    if (chunk.oldLines.length === 0) {
      // 在文件末尾（或指定位置）插入
      const insertIdx = lines.length
      replacements.push({ start: insertIdx, count: 0, newLines: chunk.newLines })
      continue
    }

    // 寻找 oldLines 的位置
    // 处理末尾空行：如果 pattern 以空行结尾，先尝试精确匹配，失败则去掉末尾空行重试
    let pattern = chunk.oldLines
    let foundIdx = seekSequence(lines, pattern, searchStart, chunk.isEndOfFile)

    if (foundIdx === -1 && pattern.length > 0 && pattern[pattern.length - 1] === '') {
      // 去掉末尾空行再试
      const trimmedPattern = pattern.slice(0, -1)
      foundIdx = seekSequence(lines, trimmedPattern, searchStart, chunk.isEndOfFile)
      if (foundIdx !== -1) {
        pattern = trimmedPattern
      }
    }

    if (foundIdx === -1) {
      throw new Error(
        `在 ${op.path} 中找不到匹配的代码块。\n` +
        `搜索内容: "${pattern[0]?.slice(0, 80)}..." (${pattern.length} 行)\n` +
        (chunk.contextHeader ? `上下文: ${chunk.contextHeader}\n` : '')
      )
    }

    replacements.push({
      start: foundIdx,
      count: pattern.length,
      newLines: chunk.newLines,
    })

    // 下次搜索从当前位置之后开始
    searchStart = foundIdx + pattern.length
  }

  // 按起始位置排序，然后倒序应用（防止索引偏移）
  replacements.sort((a, b) => a.start - b.start)
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]
    lines.splice(r.start, r.count, ...r.newLines)
  }

  // 确保以换行符结尾
  const newContent = lines.join('\n') + '\n'

  // 如果有 moveTo，写到新路径并删除旧文件
  if (op.moveTo) {
    const newPath = resolvePath(op.moveTo, cwd)
    const dir = dirname(newPath)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(newPath, newContent, 'utf-8')
    await unlink(path)
  } else {
    await writeFile(path, newContent, 'utf-8')
  }
}

/**
 * 格式化应用结果为 git 风格摘要
 */
export function formatApplyResult(results: ApplyResult[]): string {
  const lines: string[] = ['Success. Updated the following files:']
  for (const r of results) {
    lines.push(`${r.action} ${r.path}`)
  }
  return lines.join('\n')
}
