import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadMilestonePlan, getCurrentMilestone, getNextMilestone, formatMilestoneForContext } from './parser.js'

export function loadMilestoneContextText(): string | null {
  const root = process.cwd()
  const plan = loadMilestonePlan(root)
  if (!plan || plan.milestones.length === 0) return null

  const current = getCurrentMilestone(plan) ?? getNextMilestone(plan)
  if (!current) return null

  let context = formatMilestoneForContext(current)

  // Inject references to durable project memory files (prompt.md, implement.md, documentation.md)
  const promptFile = join(root, 'docs', 'prompt.md')
  const implementFile = join(root, 'docs', 'implement.md')
  if (existsSync(promptFile) || existsSync(implementFile)) {
    context += '\n\n# Durable Project Memory\n'
    context += 'This project uses reference files for long-running work. Read them before starting:\n'
    if (existsSync(promptFile)) context += '- `docs/prompt.md` — Product spec, goals, constraints, "done when" checklist\n'
    if (existsSync(implementFile)) context += '- `docs/implement.md` — Execution runbook with strict operating rules\n'
    context += '- `docs/documentation.md` — Living status document (update after each milestone)\n'
    context += '\nThese files prevent drift. Read them now if you haven\'t already.'
  }

  return context
}
