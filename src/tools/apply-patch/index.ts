/**
 * Apply Patch 工具入口
 *
 * 对齐 Codex apply_patch 工具：
 * - 接受一个 unified-diff 风格的 patch 字符串
 * - 支持 Add File / Update File / Delete File 三种操作
 * - 模糊匹配（4 级递减严格度）
 * - 多 hunk 倒序应用
 *
 * 这个工具替代 edit_file 成为 Agent 的主要文件编辑工具。
 * edit_file 的 old_text/new_text 精确匹配容易失败，
 * apply_patch 的行级 diff 更鲁棒。
 */

import type { Tool } from '../base.js'
import { parsePatch } from './parser.js'
import { applyPatch, formatApplyResult } from './apply.js'

export const applyPatchTool: Tool = {
  name: 'apply_patch',
  description: `Apply a patch to files. The patch format uses a custom diff syntax:

*** Begin Patch
*** Update File: <path>
@@ <optional context header>
 context line
-line to remove
+line to add
*** Add File: <path>
+new file content line
*** Delete File: <path>
*** End Patch

Rules:
- For Update File: provide context lines (space prefix), lines to remove (- prefix), and lines to add (+ prefix).
- Use @@ headers to narrow scope (e.g., @@ class Foo or @@ def method():).
- For Add File: all lines must have + prefix.
- Paths are relative to the project root.
- The patch is applied with fuzzy matching (handles minor whitespace differences).`,
  parameters: {
    type: 'object',
    properties: {
      patch: {
        type: 'string',
        description: 'The patch content in the *** Begin Patch / *** End Patch format.',
      },
    },
    required: ['patch'],
  },

  async execute(args) {
    const patchText = args.patch as string
    const cwd = process.cwd()

    try {
      // 1. 解析
      const { ops } = parsePatch(patchText)

      // 2. 应用
      const results = await applyPatch(ops, cwd)

      // 3. 格式化输出
      return { content: formatApplyResult(results) }
    } catch (err: any) {
      return {
        content: `Patch 应用失败: ${err.message}`,
        isError: true,
      }
    }
  },
}
