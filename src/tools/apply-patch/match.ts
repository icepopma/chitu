/**
 * 模糊匹配算法
 *
 * 对齐 Codex seek_sequence.rs 的 4 级匹配策略：
 * 1. 精确匹配（byte-for-byte）
 * 2. 去尾空白匹配（rstrip）
 * 3. 全去空白匹配（full trim）
 * 4. Unicode 归一化匹配
 *
 * 学习重点：
 * - LLM 输出的代码不总是 byte 精确的（空格、引号、破折号可能不同）
 * - 4 级递减严格度让匹配更鲁棒
 * - 从指定位置开始搜索（支持 @@ context 头定位）
 */

/**
 * 在 lines 中从 startIndex 开始搜索 pattern
 *
 * 返回匹配起始行号，找不到返回 -1
 */
export function seekSequence(
  lines: string[],
  pattern: string[],
  startIndex: number = 0,
  eof: boolean = false,
): number {
  if (pattern.length === 0) return startIndex

  // EOF 模式：从文件末尾开始搜索
  if (eof) {
    const eofResult = seekFromEnd(lines, pattern)
    if (eofResult !== -1) return eofResult
  }

  // 4 级匹配
  if (seekExact(lines, pattern, startIndex) !== -1) return seekExact(lines, pattern, startIndex)
  if (seekRstrip(lines, pattern, startIndex) !== -1) return seekRstrip(lines, pattern, startIndex)
  if (seekFullTrim(lines, pattern, startIndex) !== -1) return seekFullTrim(lines, pattern, startIndex)
  if (seekUnicodeNorm(lines, pattern, startIndex) !== -1) return seekUnicodeNorm(lines, pattern, startIndex)

  return -1
}

/** 1. 精确匹配 */
function seekExact(lines: string[], pattern: string[], start: number): number {
  for (let i = start; i <= lines.length - pattern.length; i++) {
    if (matchesExact(lines, i, pattern)) return i
  }
  return -1
}

function matchesExact(lines: string[], offset: number, pattern: string[]): boolean {
  for (let j = 0; j < pattern.length; j++) {
    if (lines[offset + j] !== pattern[j]) return false
  }
  return true
}

/** 2. 去尾空白匹配 */
function seekRstrip(lines: string[], pattern: string[], start: number): number {
  for (let i = start; i <= lines.length - pattern.length; i++) {
    if (matchesRstrip(lines, i, pattern)) return i
  }
  return -1
}

function matchesRstrip(lines: string[], offset: number, pattern: string[]): boolean {
  for (let j = 0; j < pattern.length; j++) {
    if (lines[offset + j].trimEnd() !== pattern[j].trimEnd()) return false
  }
  return true
}

/** 3. 全去空白匹配 */
function seekFullTrim(lines: string[], pattern: string[], start: number): number {
  for (let i = start; i <= lines.length - pattern.length; i++) {
    if (matchesFullTrim(lines, i, pattern)) return i
  }
  return -1
}

function matchesFullTrim(lines: string[], offset: number, pattern: string[]): boolean {
  for (let j = 0; j < pattern.length; j++) {
    if (lines[offset + j].trim() !== pattern[j].trim()) return false
  }
  return true
}

/** 4. Unicode 归一化匹配 */
function seekUnicodeNorm(lines: string[], pattern: string[], start: number): number {
  for (let i = start; i <= lines.length - pattern.length; i++) {
    if (matchesUnicodeNorm(lines, i, pattern)) return i
  }
  return -1
}

function matchesUnicodeNorm(lines: string[], offset: number, pattern: string[]): boolean {
  for (let j = 0; j < pattern.length; j++) {
    if (normalizeUnicode(lines[offset + j]) !== normalizeUnicode(pattern[j])) return false
  }
  return true
}

/**
 * Unicode 归一化 — 把常见的 "花哨" Unicode 字符转为 ASCII 等价
 */
function normalizeUnicode(s: string): string {
  return s
    // 各种破折号 → ASCII -
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    // 花式单引号 → '
    .replace(/[\u2018\u2019\u201A\u201B`]/g, "'")
    // 花式双引号 → "
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    // 不换行空格等 → 普通空格
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .trim()
}

/** 从文件末尾开始搜索 */
function seekFromEnd(lines: string[], pattern: string[]): number {
  for (let i = lines.length - pattern.length; i >= 0; i--) {
    if (matchesExact(lines, i, pattern)) return i
  }
  for (let i = lines.length - pattern.length; i >= 0; i--) {
    if (matchesRstrip(lines, i, pattern)) return i
  }
  return -1
}
