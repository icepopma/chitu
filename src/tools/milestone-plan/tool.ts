import type { Tool, ToolResult } from '../base.js'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadMilestonePlan, saveMilestonePlan, getNextMilestone, getCurrentMilestone, setActivePlan, resolvePlanPath } from './parser.js'

function getProjectRoot(): string {
  return process.cwd()
}

export const milestonePlanTool: Tool = {
  name: 'milestone_plan',
  description: `Read and manage milestone-driven implementation plans. Commands: "read" (full plan), "next" (get next pending milestone), "start" (mark milestone in_progress), "complete" (mark completed + auto git checkpoint), "fail" (mark failed), "note" (append implementation note), "decision" (append design decision), "set" (switch active plan file, e.g. "set docs/new-plan.md"). Log notes and decisions as you work so the user can see progress.`,
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['read', 'next', 'start', 'complete', 'fail', 'note', 'decision', 'set'],
        description: 'The milestone command to execute',
      },
      milestoneId: {
        type: 'string',
        description: 'The milestone ID (e.g. "M1"). Required for start/complete/fail/note/decision.',
      },
      text: {
        type: 'string',
        description: 'Note or decision text (required for note/decision commands)',
      },
      explanation: {
        type: 'string',
        description: 'Why the milestone status was changed (optional)',
      },
      path: {
        type: 'string',
        description: 'Plan file path relative to project root (required for set command, e.g. "docs/commercialized-progress.md")',
      },
    },
    required: ['command'],
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const command = args.command as string
    const milestoneId = args.milestoneId as string | undefined
    const text = args.text as string | undefined
    const root = getProjectRoot()

    // 'set' doesn't need an existing plan
    if (command === 'set') {
      const planPath = args.path as string | undefined
      if (!planPath) {
        return { content: 'Error: path is required for set command (e.g. "docs/commercialized-progress.md")', isError: true }
      }
      const fullPath = join(root, planPath)
      if (!existsSync(fullPath)) {
        return { content: `Error: file not found: ${planPath}`, isError: true }
      }
      setActivePlan(root, planPath)

      // Try to parse it as a milestone plan
      const plan = loadMilestonePlan(root)
      if (plan && plan.milestones.length > 0) {
        const summary = plan.milestones.map(m => `${m.id}: ${m.title} [${m.status}]`).join('\n')
        return { content: `Active plan set to ${planPath}\n\nPlan has ${plan.milestones.length} milestones:\n${summary}` }
      }
      return { content: `Active plan set to ${planPath}\nFile exists but is not in milestone format. Agent can use it as reference.` }
    }

    const plan = loadMilestonePlan(root)

    if (!plan) {
      const currentFile = resolvePlanPath(root)
      return { content: `No milestone plan found at ${currentFile}. Use "milestone_plan set <path>" to point to a plan file, or create a plans.md with milestone sections.` }
    }

    switch (command) {
      case 'read': {
        const summary = plan.milestones.map(m =>
          `${m.id}: ${m.title} [${m.status}]`
        ).join('\n')
        return { content: `Plan (${plan.milestones.length} milestones):\n${summary}` }
      }

      case 'next': {
        const current = getCurrentMilestone(plan)
        if (current) {
          return { content: `Currently active:\n${formatMilestone(current)}` }
        }
        const next = getNextMilestone(plan)
        if (!next) {
          return { content: 'All milestones completed!' }
        }
        return { content: `Next milestone:\n${formatMilestone(next)}` }
      }

      case 'start': {
        if (!milestoneId) {
          return { content: 'Error: milestoneId is required for start command', isError: true }
        }
        const milestone = plan.milestones.find(m => m.id === milestoneId)
        if (!milestone) {
          return { content: `Error: milestone "${milestoneId}" not found`, isError: true }
        }
        if (milestone.status !== 'pending') {
          return { content: `Error: milestone "${milestoneId}" is ${milestone.status}, not pending`, isError: true }
        }
        const active = getCurrentMilestone(plan)
        if (active) {
          return { content: `Error: milestone "${active.id}" is already in_progress. Complete or fail it first.`, isError: true }
        }
        milestone.status = 'in_progress'
        milestone.startedAt = Date.now()
        saveMilestonePlan(root, plan)
        return { content: `Started milestone ${milestoneId}: ${milestone.title}` }
      }

      case 'complete': {
        if (!milestoneId) {
          return { content: 'Error: milestoneId is required for complete command', isError: true }
        }
        const milestone = plan.milestones.find(m => m.id === milestoneId)
        if (!milestone) {
          return { content: `Error: milestone "${milestoneId}" not found`, isError: true }
        }
        milestone.status = 'completed'
        milestone.completedAt = Date.now()
        saveMilestonePlan(root, plan)

        try {
          const msg = `milestone ${milestoneId} completed: ${milestone.title}`
          execSync('git add -A', { cwd: root, stdio: 'pipe' })
          execSync(`git commit -m "${msg}"`, { cwd: root, stdio: 'pipe' })
          return { content: `Completed milestone ${milestoneId}: ${milestone.title}\nGit checkpoint created.` }
        } catch {
          return { content: `Completed milestone ${milestoneId}: ${milestone.title}` }
        }
      }

      case 'fail': {
        if (!milestoneId) {
          return { content: 'Error: milestoneId is required for fail command', isError: true }
        }
        const milestone = plan.milestones.find(m => m.id === milestoneId)
        if (!milestone) {
          return { content: `Error: milestone "${milestoneId}" not found`, isError: true }
        }
        milestone.status = 'failed'
        milestone.completedAt = Date.now()
        saveMilestonePlan(root, plan)
        const reason = args.explanation ? ` Reason: ${args.explanation}` : ''
        return { content: `Marked milestone ${milestoneId} as failed.${reason}` }
      }

      case 'note': {
        if (!milestoneId || !text) {
          return { content: 'Error: milestoneId and text are required for note command', isError: true }
        }
        const milestone = plan.milestones.find(m => m.id === milestoneId)
        if (!milestone) {
          return { content: `Error: milestone "${milestoneId}" not found`, isError: true }
        }
        milestone.notes.push(text)
        saveMilestonePlan(root, plan)
        return { content: `Note added to ${milestoneId}: ${text}` }
      }

      case 'decision': {
        if (!milestoneId || !text) {
          return { content: 'Error: milestoneId and text are required for decision command', isError: true }
        }
        const milestone = plan.milestones.find(m => m.id === milestoneId)
        if (!milestone) {
          return { content: `Error: milestone "${milestoneId}" not found`, isError: true }
        }
        milestone.decisionLog.push(text)
        saveMilestonePlan(root, plan)
        return { content: `Decision logged for ${milestoneId}: ${text}` }
      }

      default:
        return { content: `Unknown command: ${command}`, isError: true }
    }
  },
}

function formatMilestone(m: {
  id: string
  title: string
  scope: string
  keyFiles: string[]
  acceptanceCriteria: string[]
  verificationCommands: string[]
  status: string
  notes: string[]
  decisionLog: string[]
}): string {
  const lines = [
    `${m.id}: ${m.title} (${m.status})`,
    `  Scope: ${m.scope}`,
  ]
  if (m.keyFiles.length) lines.push(`  Key Files: ${m.keyFiles.join(', ')}`)
  if (m.acceptanceCriteria.length) lines.push(`  Acceptance: ${m.acceptanceCriteria.join('; ')}`)
  if (m.verificationCommands.length) lines.push(`  Verify: ${m.verificationCommands.join('; ')}`)
  if (m.decisionLog.length) lines.push(`  Decisions: ${m.decisionLog.length} logged`)
  if (m.notes.length) lines.push(`  Notes: ${m.notes.length} logged`)
  return lines.join('\n')
}
