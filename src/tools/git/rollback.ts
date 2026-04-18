import type { Tool, ToolResult } from '../base.js'
import { execSync } from 'node:child_process'

export const gitRollbackTool: Tool = {
  name: 'git_rollback',
  description: 'Roll back to a previous git checkpoint. Shows what will be lost before rolling back. Defaults to HEAD~1 (last commit). Use when a milestone fails and you need to revert changes.',
  parameters: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Git ref to roll back to (default: HEAD~1, the last commit)',
      },
    },
  },

  needsApproval(): boolean {
    return true
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const ref = (args.ref as string) || 'HEAD~1'
    const cwd = process.cwd()

    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' })
    } catch {
      return { content: 'Not a git repository.', isError: true }
    }

    try {
      const logOutput = execSync(`git log --oneline -5`, { cwd, encoding: 'utf-8' }).trim()

      const targetHash = execSync(`git rev-parse --short ${ref}`, { cwd, encoding: 'utf-8' }).trim()
      const currentHash = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf-8' }).trim()

      execSync(`git reset --hard ${ref}`, { cwd, stdio: 'pipe' })

      const newHead = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf-8' }).trim()

      return {
        content: `Rolled back from ${currentHash} to ${newHead}\n\nRecent commits:\n${logOutput}`,
      }
    } catch (err: any) {
      return { content: `Rollback failed: ${err.message}`, isError: true }
    }
  },
}
