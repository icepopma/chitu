import { loadMilestonePlan, getCurrentMilestone, getNextMilestone, formatMilestoneForContext } from './parser.js'

export function loadMilestoneContextText(): string | null {
  const root = process.cwd()
  const plan = loadMilestonePlan(root)
  if (!plan || plan.milestones.length === 0) return null

  const current = getCurrentMilestone(plan) ?? getNextMilestone(plan)
  if (!current) return null

  return formatMilestoneForContext(current)
}
