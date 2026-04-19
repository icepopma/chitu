/**
 * Exec Tool — 执行 shell 命令
 *
 * 这是 Agent 最强大的工具。Codex 也靠它。
 * Agent 通过它来运行命令：ls, cat, npm test, git status...
 *
 * v12 更新：集成沙盒执行
 * - macOS 使用 sandbox-exec（Seatbelt 策略）隔离进程
 * - 只读项目根目录，写入仅限指定路径
 * - 网络访问被禁止
 * - 沙盒可配置开关（_sandboxEnabled）
 *
 * v11 更新：结构化返回 exitCode + stdout/stderr 分离
 * - Agent 通过 exitCode 判断命令成败：0=成功，非0=失败
 */

import type { Tool, ToolResult } from './base.js'
import { classifyCommand } from './policy.js'
import { detectShell } from '../utils/shell.js'
import { execInSandbox, createDefaultSandboxConfig } from '../sandbox/index.js'

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

  /** 沙盒开关（默认禁用，可通过环境变量 CHITU_SANDBOX_ENABLED 启用） */
  sandboxEnabled: !!process.env.CHITU_SANDBOX_ENABLED,

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const command = args.command as string
    if (!command) {
      return { content: '错误：缺少 command 参数', isError: true, exitCode: 1 }
    }

    const shellInfo = detectShell()
    const sandboxConfig = createDefaultSandboxConfig()
    sandboxConfig.enabled = this.sandboxEnabled !== false

    const result = await execInSandbox({
      command,
      config: sandboxConfig,
      shell: shellInfo.path,
      env: EXEC_ENV,
      timeout: 30_000,
    })

    const parts: string[] = []
    parts.push(`[exit code: ${result.exitCode}]`)
    if (result.timedOut) {
      parts.push('[命令超时，30秒内未完成]')
    }
    if (result.sandboxed) {
      parts.push(`[sandbox: ${result.platform}]`)
    }
    if (result.stdout) {
      parts.push(`[stdout]\n${result.stdout}`)
    }
    if (result.stderr) {
      parts.push(`[stderr]\n${result.stderr}`)
    }

    const content = parts.join('\n') || '(无输出)'

    return {
      content,
      isError: result.exitCode !== 0,
      exitCode: result.exitCode,
    }
  },
}
