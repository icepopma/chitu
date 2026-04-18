import type { Plugin } from '../../plugin-types.js'
import { milestonePlanTool } from '../../milestone-plan/tool.js'

export const milestonePlugin: Plugin = {
  name: 'milestone',
  version: '1.0.0',
  description: 'Milestone-driven plan management for autonomous long-running tasks',
  category: 'core',
  tools: [milestonePlanTool],
}
