/**
 * Exec Tool — 执行 shell 命令
 *
 * 这是 Agent 最强大的工具。Codex 也靠它。
 * Agent 通过它来运行命令：ls, cat, npm test, git status...
 *
 * v11 更新：结构化返回 exitCode + stdout/stderr 分离
 * - Agent 通过 exitCode 判断命令成败：0=成功，非0=失败
 * - 这是自我验证闭环的关键：Agent 执行测试后看 exitCode，失败则修复
 *
 * 安全说明：
 * - 学习阶段不做严格沙盒，但设置了超时和输出长度限制
 * - 生产环境需要沙盒（Docker 容器等）
 */

import { exec as childExec } from 'child_process'
import type { Tool, ToolResult } from './base.js'

/** exec 工具的环境变量，抑制颜色、分页、交互式提示 */
const EXEC_ENV = {
  NO_COLOR: '1',       // 禁用颜色输出（大多数工具尊重此变量）
  TERM: 'dumb',        // 哑终端，禁用终端控制序列
  PAGER: 'cat',        // 禁用分页器（git log 等会用 PAGER）
  GIT_PAGER: 'cat',    // Git 专用分页器设置
  NODE_OPTIONS: '',    // 清除可能导致问题的 Node 选项
}

export const execTool: Tool = {
  name: 'exec',
  description: '执行 shell 命令并返回输出。返回值包含退出码（exit code）：0 表示成功，非 0 表示失败。可以运行任何命令，如 ls, cat, grep, npm test, git status 等。',
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
      return { content: '错误：缺少 command 参数', isError: true, exitCode: 1 }
    }

    return new Promise((resolve) => {
      childExec(
        command,
        {
          timeout: 30_000,        // 30 秒超时
          maxBuffer: 1024 * 1024, // 最大 1MB 输出
          shell: '/bin/bash',
          env: { ...process.env, ...EXEC_ENV },
        },
        (error, stdout, stderr) => {
          const exitCode = error ? (error as any).code || 1 : 0
          const out = (stdout || '').trim()
          const err = (stderr || '').trim()

          // 超时检测
          const timedOut = error ? !!(error as any).killed : false

          // 结构化输出：exit code + stdout + stderr 分离
          const parts: string[] = []
          parts.push(`[exit code: ${exitCode}]`)
          if (timedOut) {
            parts.push('[命令超时，30秒内未完成]')
          }
          if (out) {
            parts.push(`[stdout]\n${out}`)
          }
          if (err) {
            parts.push(`[stderr]\n${err}`)
          }

          const content = parts.join('\n') || '(无输出)'

          resolve({
            content,
            isError: exitCode !== 0,
            exitCode,
          })
        },
      )
    })
  },
}
