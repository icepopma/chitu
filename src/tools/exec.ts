/**
 * Exec Tool — 执行 shell 命令
 *
 * 这是 Agent 最强大的工具。Codex 也靠它。
 * Agent 通过它来运行命令：ls, cat, npm test, git status...
 *
 * 安全说明：
 * - 学习阶段不做严格沙盒，但设置了超时和输出长度限制
 * - 生产环境需要沙盒（Docker 容器等）
 */

import { exec as childExec } from 'child_process'
import type { Tool, ToolResult } from './base.js'

export const execTool: Tool = {
  name: 'exec',
  description: '执行 shell 命令并返回输出。可以运行任何命令，如 ls, cat, grep, npm test, git status 等。',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的 shell 命令',
      },
    },
    required: ['command'],
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const command = args.command as string
    if (!command) {
      return { content: '错误：缺少 command 参数', isError: true }
    }

    return new Promise((resolve) => {
      childExec(
        command,
        {
          timeout: 30_000,        // 30 秒超时
          maxBuffer: 1024 * 1024, // 最大 1MB 输出
          shell: '/bin/bash',
        },
        (error, stdout, stderr) => {
          if (error) {
            // 命令执行失败（非零退出码或超时）
            const output = (stderr || '') + (stdout || '')
            resolve({
              content: output || error.message,
              isError: true,
            })
            return
          }

          // 命令成功
          const output = (stdout || '') + (stderr ? `\n[stderr]\n${stderr}` : '')
          resolve({
            content: output || '(无输出)',
          })
        },
      )
    })
  },
}
