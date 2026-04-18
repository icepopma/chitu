/**
 * Exec Tool — 执行 shell 命令
 *
 * 这是 Agent 最强大的工具。Codex 也靠它。
 * Agent 通过它来运行命令：ls, cat, npm test, git status...
 *
 * v12 更新：集成审批策略
 * - needsApproval() 根据命令风险等级决定是否需要用户确认
 * - 只读命令（ls, git status）自动批准
 * - 写入命令（rm, git push）需要用户确认
 *
 * v11 更新：结构化返回 exitCode + stdout/stderr 分离
 * - Agent 通过 exitCode 判断命令成败：0=成功，非0=失败
 */

import { exec as childExec } from 'child_process'
import type { Tool, ToolResult } from './base.js'
import { classifyCommand } from './policy.js'
import { detectShell } from '../utils/shell.js'

/** exec 工具的环境变量，抑制颜色、分页、交互式提示 */
const EXEC_ENV = {
  NO_COLOR: '1',
  TERM: 'dumb',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
  NODE_OPTIONS: '',
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

  /** 判断命令是否需要用户审批 */
  needsApproval(args: Record<string, unknown>): boolean {
    const command = args.command as string
    if (!command) return false
    const riskLevel = classifyCommand(command)
    return riskLevel !== 'read'
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
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          shell: detectShell().path,
          env: { ...process.env, ...EXEC_ENV },
        },
        (error, stdout, stderr) => {
          const exitCode = error ? (error as any).code || 1 : 0
          const out = (stdout || '').trim()
          const err = (stderr || '').trim()

          const timedOut = error ? !!(error as any).killed : false

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
