/**
 * Apply Patch 解析器
 *
 * 解析 Codex 风格的 patch 格式：
 * *** Begin Patch
 * *** Add File: path
 * +line
 * *** Update File: path
 * @@ context
 * -old line
 * +new line
 *  context line
 * *** Delete File: path
 * *** End Patch
 *
 * 学习重点：
 * - 三种操作：AddFile / DeleteFile / UpdateFile
 * - UpdateFile 支持多个 hunk（代码块），每个 hunk 有上下文头 + diff 行
 * - 宽松解析：空行跳过，heredoc 包装自动剥离
 */

// ===== 类型定义 =====

export interface AddFileOp {
  type: 'add'
  path: string
  lines: string[]
}

export interface DeleteFileOp {
  type: 'delete'
  path: string
}

export interface UpdateChunk {
  /** @@ 后面的上下文头（如 "class Foo" 或 "def bar():"） */
  contextHeader?: string
  /** 旧文件的行（空格或 - 前缀） */
  oldLines: string[]
  /** 新文件的行（空格或 + 前缀） */
  newLines: string[]
  /** 是否是文件末尾 */
  isEndOfFile: boolean
}

export interface UpdateFileOp {
  type: 'update'
  path: string
  /** 可选的重命名路径 */
  moveTo?: string
  chunks: UpdateChunk[]
}

export type PatchOp = AddFileOp | DeleteFileOp | UpdateFileOp

export interface ParsedPatch {
  ops: PatchOp[]
}

// ===== 解析错误 =====

export class PatchParseError extends Error {
  constructor(message: string, public lineNum?: number) {
    super(message)
    this.name = 'PatchParseError'
  }
}

// ===== 解析器 =====

/**
 * 解析 patch 文本为操作列表
 */
export function parsePatch(text: string): ParsedPatch {
  // 剥离 heredoc 包装（LLM 有时会产生 <<EOF ... EOF）
  let raw = text.trim()

  // 剥离 shell heredoc 包装
  raw = stripHeredoc(raw)

  const lines = raw.split('\n')
  const ops: PatchOp[] = []
  let i = 0

  // 找到 *** Begin Patch
  while (i < lines.length && !lines[i].trim().startsWith('*** Begin Patch')) {
    i++
  }
  if (i >= lines.length) {
    throw new PatchParseError('未找到 *** Begin Patch 标记')
  }
  i++ // 跳过 Begin Patch 行

  // 解析文件操作
  while (i < lines.length) {
    const line = lines[i].trim()

    // 结束标记
    if (line.startsWith('*** End Patch')) {
      break
    }

    // 跳过空行
    if (line === '') {
      i++
      continue
    }

    // Add File
    if (line.startsWith('*** Add File: ')) {
      const path = line.slice('*** Add File: '.length).trim()
      i++
      const addLines: string[] = []
      while (i < lines.length && !lines[i].trim().startsWith('***')) {
        const l = lines[i]
        if (l.startsWith('+')) {
          addLines.push(l.slice(1))
        } else if (l.trim() === '') {
          // 空行在 Add File 里可能就是空行
          addLines.push('')
        } else {
          addLines.push(l)
        }
        i++
      }
      // 去掉末尾空行
      while (addLines.length > 0 && addLines[addLines.length - 1] === '') {
        addLines.pop()
      }
      ops.push({ type: 'add', path, lines: addLines })
      continue
    }

    // Delete File
    if (line.startsWith('*** Delete File: ')) {
      const path = line.slice('*** Delete File: '.length).trim()
      ops.push({ type: 'delete', path })
      i++
      continue
    }

    // Update File
    if (line.startsWith('*** Update File: ')) {
      const path = line.slice('*** Update File: '.length).trim()
      i++

      // 可选的 Move to
      let moveTo: string | undefined
      if (i < lines.length && lines[i].trim().startsWith('*** Move to: ')) {
        moveTo = lines[i].trim().slice('*** Move to: '.length).trim()
        i++
      }

      // 解析 chunks
      const chunks: UpdateChunk[] = []
      let currentChunk: UpdateChunk | null = null

      while (i < lines.length) {
        const l = lines[i]

        // 遇到下一个文件操作或结束标记 → 退出
        if (l.trim().startsWith('***')) {
          break
        }

        // @@ 上下文头 → 新 chunk
        if (l.startsWith('@@')) {
          if (currentChunk) {
            chunks.push(currentChunk)
          }
          const contextHeader = l.slice(2).trim()
          currentChunk = {
            contextHeader: contextHeader || undefined,
            oldLines: [],
            newLines: [],
            isEndOfFile: false,
          }
          i++
          continue
        }

        // *** End of File
        if (l.trim() === '*** End of File') {
          if (currentChunk) {
            currentChunk.isEndOfFile = true
          }
          i++
          continue
        }

        // 如果还没有 chunk，隐式创建一个（第一个 chunk 可以没有 @@）
        if (!currentChunk) {
          currentChunk = {
            oldLines: [],
            newLines: [],
            isEndOfFile: false,
          }
        }

        const trimmed = l.trim()
        if (trimmed === '') {
          // 空行 → 视为上下文行
          currentChunk.oldLines.push('')
          currentChunk.newLines.push('')
        } else if (l.startsWith('-')) {
          currentChunk.oldLines.push(l.slice(1))
        } else if (l.startsWith('+')) {
          currentChunk.newLines.push(l.slice(1))
        } else if (l.startsWith(' ')) {
          // 上下文行 → 同时加入 old 和 new
          currentChunk.oldLines.push(l.slice(1))
          currentChunk.newLines.push(l.slice(1))
        } else {
          // 无前缀 → 上下文行（宽松模式）
          currentChunk.oldLines.push(l)
          currentChunk.newLines.push(l)
        }
        i++
      }

      if (currentChunk) {
        chunks.push(currentChunk)
      }

      ops.push({ type: 'update', path, moveTo, chunks })
      continue
    }

    // 不认识的行 → 跳过
    i++
  }

  if (ops.length === 0) {
    throw new PatchParseError('Patch 不包含任何文件操作')
  }

  return { ops }
}

/**
 * 剥离 heredoc 包装
 *
 * LLM 有时会把 patch 包在 shell heredoc 里：
 * <<'EOF'
 * *** Begin Patch
 * ...
 * *** End Patch
 * EOF
 */
function stripHeredoc(text: string): string {
  // 匹配 <<'EOF' 或 <<"EOF" 或 <<EOF 开始
  const heredocStart = text.match(/<<['"]?(\w+)['"]?\s*\n/)
  if (!heredocStart) return text

  const delimiter = heredocStart[1]
  const startIdx = text.indexOf(heredocStart[0]) + heredocStart[0].length
  const endRegex = new RegExp(`^${delimiter}\\s*$`, 'm')
  const endMatch = text.slice(startIdx).match(endRegex)
  if (!endMatch) return text

  return text.slice(startIdx, startIdx + endMatch.index!).trim()
}
