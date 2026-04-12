/**
 * PlanPlugin — 执行计划插件
 *
 * 将原来的 updatePlanTool 包装为 Plugin 格式。
 * 计划工具本身是 no-op，价值在于结构化 Agent 的思考过程。
 */

import type { Plugin } from '../../plugin-types.js'
import { updatePlanTool } from '../../plan.js'

/** Plan 插件 — 提供执行计划工具 */
export const planPlugin: Plugin = {
  name: 'plan',
  version: '1.0.0',
  description: '执行计划插件，让 Agent 结构化地规划和跟踪任务',
  category: 'core',

  tools: [updatePlanTool],
}
