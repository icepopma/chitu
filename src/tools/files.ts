/**
 * 文件工具：read_file, write_file, edit_file
 *
 * 学习重点：
 * - 有了这 3 个工具 + exec，Agent 就能自主构建项目了
 * - read_file：读文件（比 exec cat 更可靠）
 * - write_file：创建文件（比 exec echo 更安全）
 * - edit_file：精确修改（比 exec sed 更不容易出错）
 */

import { readFile, writeFile } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { Tool } from './base.js'

// ===== read_file =====

export const readFileTool: Tool = {
  name: 'read_file',
  description: '读取文件内容。返回文件的完整文本。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对或绝对）',
      },
    },
    required: ['path'],
  },

  async execute(args) {
    const path = args.path as string
    try {
      const content = await readFile(path, 'utf-8')
      // 截断超长文件（防止耗尽 LLM 上下文）
      const maxLen = 50_000
      if (content.length > maxLen) {
        return {
          content: content.slice(0, maxLen) + `\n... (文件太长，已截断，共 ${content.length} 字符)`,
        }
      }
      return { content }
    } catch (err: any) {
      return { content: `读取文件失败: ${err.message}`, isError: true }
    }
  },
}

// ===== write_file =====

export const writeFileTool: Tool = {
  name: 'write_file',
  description: '创建或覆盖文件。如果目录不存在会自动创建。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径',
      },
      content: {
        type: 'string',
        description: '要写入的内容',
      },
    },
    required: ['path', 'content'],
  },

  async execute(args) {
    const path = args.path as string
    const content = args.content as string

    try {
      // 自动创建父目录
      const dir = dirname(path)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      await writeFile(path, content, 'utf-8')
      return { content: `文件已写入: ${path} (${content.length} 字符)` }
    } catch (err: any) {
      return { content: `写入文件失败: ${err.message}`, isError: true }
    }
  },
}

// ===== edit_file =====

export const editFileTool: Tool = {
  name: 'edit_file',
  description: '精确修改文件中的某段内容。找到 old_text，替换为 new_text。如果 old_text 不唯一或不存在会失败。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径',
      },
      old_text: {
        type: 'string',
        description: '要被替换的原始文本（必须精确匹配）',
      },
      new_text: {
        type: 'string',
        description: '替换后的新文本',
      },
    },
    required: ['path', 'old_text', 'new_text'],
  },

  async execute(args) {
    const path = args.path as string
    const oldText = args.old_text as string
    const newText = args.new_text as string

    try {
      // 读取文件
      const content = await readFile(path, 'utf-8')

      // 检查 old_text 是否存在
      if (!content.includes(oldText)) {
        return {
          content: `编辑失败: 在 ${path} 中找不到指定的文本。\n请先用 read_file 查看文件内容，确认要替换的文本。`,
          isError: true,
        }
      }

      // 检查 old_text 是否唯一
      const count = content.split(oldText).length - 1
      if (count > 1) {
        return {
          content: `编辑失败: "${oldText.slice(0, 50)}..." 在文件中出现了 ${count} 次，不是唯一的。请提供更多上下文使其唯一。`,
          isError: true,
        }
      }

      // 执行替换
      const newContent = content.replace(oldText, newText)
      await writeFile(path, newContent, 'utf-8')

      return { content: `文件已编辑: ${path}` }
    } catch (err: any) {
      return { content: `编辑文件失败: ${err.message}`, isError: true }
    }
  },
}
