import type { Tool, ToolResult } from '../base.js'
import { execSync } from 'node:child_process'

export const gitCheckpointTool: Tool = {
  name: 'git_checkpoint',
  description: 'Create a git checkpoint by staging all changes and committing. Use after completing a milestone or reaching a stable state. Returns the commit hash and summary.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Checkpoint commit message (e.g. "completed feature X")',
      },
      milestoneId: {
        type: 'string',
        description: 'Optional milestone ID to include in the commit message',
      },
    },
    required: ['message'],
  },

  needsApproval(): boolean {
    return true
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const message = args.message as string
    const milestoneId = args.milestoneId as string | undefined
    const cwd = process.cwd()

    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' })
    } catch {
      return { content: 'Not a git repository. Initialize with `git init` first.', isError: true }
    }

    const trailer = '\n\nCo-authored-by: Chitu Agent <chitu@agent.local>'
    const commitMsg = milestoneId
      ? `checkpoint: ${message} [milestone: ${milestoneId}]${trailer}`
      : `checkpoint: ${message}${trailer}`

    try {
      const statusBefore = execSync('git status --porcelain', { cwd, encoding: 'utf-8' })
      if (!statusBefore.trim()) {
        return { content: 'No changes to checkpoint.' }
      }

      execSync('git add -A', { cwd, stdio: 'pipe' })
      // Use --trailer for proper git trailer support, fallback to message embed
      try {
        execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}" --trailer "Co-authored-by=Chitu Agent <chitu@agent.local>"`, { cwd, stdio: 'pipe' })
      } catch {
        // Fallback: older git versions may not support --trailer
        execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd, stdio: 'pipe' })
      }

      const hash = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf-8' }).trim()
      const fileCount = statusBefore.trim().split('\n').length

      return { content: `Checkpoint created: ${hash} (${fileCount} files changed)\n${commitMsg}` }
    } catch (err: any) {
      return { content: `Checkpoint failed: ${err.message}`, isError: true }
    }
  },
}
