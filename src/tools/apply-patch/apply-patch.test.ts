/**
 * Apply Patch 单元测试
 *
 * 测试覆盖：
 * - Parser: Add / Delete / Update 三种操作解析
 * - Match: 4 级模糊匹配
 * - Apply: 文件创建、修改、删除、多 hunk、重命名
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { parsePatch } from './parser.js'
import { applyPatch, formatApplyResult } from './apply.js'
import { seekSequence } from './match.js'

// ===== Parser 测试 =====

describe('parsePatch', () => {
  it('解析 Update File', () => {
    const patch = `
*** Begin Patch
*** Update File: src/app.ts
@@ function hello():
-  console.log("Hi")
+  console.log("Hello")
*** End Patch
`
    const result = parsePatch(patch)
    expect(result.ops).toHaveLength(1)
    expect(result.ops[0].type).toBe('update')
    if (result.ops[0].type === 'update') {
      expect(result.ops[0].path).toBe('src/app.ts')
      expect(result.ops[0].chunks).toHaveLength(1)
      expect(result.ops[0].chunks[0].contextHeader).toBe('function hello():')
      expect(result.ops[0].chunks[0].oldLines).toEqual(['  console.log("Hi")'])
      expect(result.ops[0].chunks[0].newLines).toEqual(['  console.log("Hello")'])
    }
  })

  it('解析 Add File', () => {
    const patch = `
*** Begin Patch
*** Add File: hello.txt
+Hello world
+Second line
*** End Patch
`
    const result = parsePatch(patch)
    expect(result.ops).toHaveLength(1)
    expect(result.ops[0].type).toBe('add')
    if (result.ops[0].type === 'add') {
      expect(result.ops[0].path).toBe('hello.txt')
      expect(result.ops[0].lines).toEqual(['Hello world', 'Second line'])
    }
  })

  it('解析 Delete File', () => {
    const patch = `
*** Begin Patch
*** Delete File: obsolete.txt
*** End Patch
`
    const result = parsePatch(patch)
    expect(result.ops).toHaveLength(1)
    expect(result.ops[0].type).toBe('delete')
    if (result.ops[0].type === 'delete') {
      expect(result.ops[0].path).toBe('obsolete.txt')
    }
  })

  it('解析多文件操作', () => {
    const patch = `
*** Begin Patch
*** Add File: new.ts
+export const x = 1
*** Update File: old.ts
-old line
+new line
*** Delete File: gone.ts
*** End Patch
`
    const result = parsePatch(patch)
    expect(result.ops).toHaveLength(3)
    expect(result.ops[0].type).toBe('add')
    expect(result.ops[1].type).toBe('update')
    expect(result.ops[2].type).toBe('delete')
  })

  it('解析 Move to', () => {
    const patch = `
*** Begin Patch
*** Update File: old/path.ts
*** Move to: new/path.ts
-old
+new
*** End Patch
`
    const result = parsePatch(patch)
    expect(result.ops[0].type).toBe('update')
    if (result.ops[0].type === 'update') {
      expect(result.ops[0].moveTo).toBe('new/path.ts')
    }
  })

  it('解析多 hunk', () => {
    const patch = `
*** Begin Patch
*** Update File: app.ts
@@ class A:
-  old1
+  new1
@@ class B:
-  old2
+  new2
*** End Patch
`
    const result = parsePatch(patch)
    const op = result.ops[0]
    if (op.type === 'update') {
      expect(op.chunks).toHaveLength(2)
      expect(op.chunks[0].contextHeader).toBe('class A:')
      expect(op.chunks[1].contextHeader).toBe('class B:')
    }
  })

  it('缺少 Begin Patch 标记报错', () => {
    expect(() => parsePatch('just some text')).toThrow('未找到 *** Begin Patch')
  })

  it('空 patch 报错', () => {
    expect(() => parsePatch('*** Begin Patch\n*** End Patch')).toThrow('不包含任何文件操作')
  })

  it('剥离 heredoc 包装', () => {
    const patch = `<<'EOF'
*** Begin Patch
*** Add File: test.txt
+hello
*** End Patch
EOF`
    const result = parsePatch(patch)
    expect(result.ops).toHaveLength(1)
    expect(result.ops[0].type).toBe('add')
  })
})

// ===== Match 测试 =====

describe('seekSequence', () => {
  const lines = [
    'function foo() {',
    '  const x = 1',
    '  const y = 2',
    '  return x + y',
    '}',
    '',
    'function bar() {',
    '  const z = 3',
    '  return z',
    '}',
  ]

  it('精确匹配', () => {
    expect(seekSequence(lines, ['  const x = 1'])).toBe(1)
    expect(seekSequence(lines, ['  const x = 1', '  const y = 2'])).toBe(1)
  })

  it('找不到返回 -1', () => {
    expect(seekSequence(lines, ['nonexistent'])).toBe(-1)
  })

  it('从指定位置开始搜索', () => {
    // lines[4] = '}', lines[5] = '', lines[9] = '}'
    expect(seekSequence(lines, ['}'], 0)).toBe(4)
    expect(seekSequence(lines, ['}'], 5)).toBe(9)
  })

  it('去尾空白匹配', () => {
    const linesWithSpaces = ['  hello  ', '  world  ']
    expect(seekSequence(linesWithSpaces, ['  hello', '  world'])).toBe(0)
  })

  it('Unicode 归一化匹配', () => {
    const linesWithFancy = ['const x = "hello"']
    expect(seekSequence(linesWithFancy, ['const x = \u201Chello\u201D'])).toBe(0)
  })
})

// ===== Apply 测试 =====

describe('applyPatch', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'chitu-patch-test-'))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('创建新文件', async () => {
    writeFileSync(join(testDir, 'hello.txt'), 'hello\n')
    // 不需要已有文件，Add File 直接创建
    const { ops } = parsePatch(`
*** Begin Patch
*** Add File: new-file.txt
+Line 1
+Line 2
*** End Patch
`)
    const results = await applyPatch(ops, testDir)
    expect(results).toEqual([{ action: 'A', path: 'new-file.txt' }])
    const content = readFileSync(join(testDir, 'new-file.txt'), 'utf-8')
    expect(content).toBe('Line 1\nLine 2\n')
  })

  it('修改已有文件', async () => {
    writeFileSync(join(testDir, 'app.ts'), 'function hello() {\n  console.log("Hi")\n}\n')
    const { ops } = parsePatch(`
*** Begin Patch
*** Update File: app.ts
@@ function hello() {
-  console.log("Hi")
+  console.log("Hello")
*** End Patch
`)
    const results = await applyPatch(ops, testDir)
    expect(results).toEqual([{ action: 'M', path: 'app.ts' }])
    const content = readFileSync(join(testDir, 'app.ts'), 'utf-8')
    expect(content).toContain('Hello')
    expect(content).not.toContain('"Hi"')
  })

  it('删除文件', async () => {
    writeFileSync(join(testDir, 'gone.txt'), 'bye\n')
    const { ops } = parsePatch(`
*** Begin Patch
*** Delete File: gone.txt
*** End Patch
`)
    await applyPatch(ops, testDir)
    expect(existsSync(join(testDir, 'gone.txt'))).toBe(false)
  })

  it('多个 hunk 倒序应用', async () => {
    writeFileSync(join(testDir, 'multi.ts'), 'line1\nline2\nline3\nline4\nline5\n')
    const { ops } = parsePatch(`
*** Begin Patch
*** Update File: multi.ts
-line1
+LINE1
@@ line3
-line5
+LINE5
*** End Patch
`)
    await applyPatch(ops, testDir)
    const content = readFileSync(join(testDir, 'multi.ts'), 'utf-8')
    expect(content).toBe('LINE1\nline2\nline3\nline4\nLINE5\n')
  })

  it('重命名文件（Move to）', async () => {
    writeFileSync(join(testDir, 'old.ts'), 'content\n')
    const { ops } = parsePatch(`
*** Begin Patch
*** Update File: old.ts
*** Move to: new.ts
-content
+CONTENT
*** End Patch
`)
    await applyPatch(ops, testDir)
    expect(existsSync(join(testDir, 'old.ts'))).toBe(false)
    expect(existsSync(join(testDir, 'new.ts'))).toBe(true)
    const content = readFileSync(join(testDir, 'new.ts'), 'utf-8')
    expect(content).toContain('CONTENT')
  })

  it('formatApplyResult 输出 git 风格摘要', () => {
    const result = formatApplyResult([
      { action: 'A', path: 'new.txt' },
      { action: 'M', path: 'changed.ts' },
      { action: 'D', path: 'gone.ts' },
    ])
    expect(result).toContain('A new.txt')
    expect(result).toContain('M changed.ts')
    expect(result).toContain('D gone.ts')
  })

  it('上下文行正确保留', async () => {
    writeFileSync(join(testDir, 'ctx.ts'), 'before\nchange_me\nafter\n')
    const { ops } = parsePatch(`
*** Begin Patch
*** Update File: ctx.ts
 before
-change_me
+CHANGED
 after
*** End Patch
`)
    await applyPatch(ops, testDir)
    const content = readFileSync(join(testDir, 'ctx.ts'), 'utf-8')
    expect(content).toBe('before\nCHANGED\nafter\n')
  })
})
