/**
 * Update Plan Tool — 执行计划工具
 *
 * 对齐 Codex codex-rs/core/src/tools/handlers/plan.rs
 *
 * 关键洞察（来自 Codex 源码注释）：
 * "This function doesn't do anything useful. However, it gives the model a
 *  structured way to record its plan that clients can read and render."
 *
 * plan 工具本身是 no-op，价值在于：
 * 1. 强制 Agent 结构化思考（列出步骤、标状态）
 * 2. 让客户端读取 tool call 参数来渲染计划 UI
 * 3. 计划数据通过事件系统传递给前端
 */

import type { Tool, ToolResult } from './base.js'

export const updatePlanTool: Tool = {
  name: 'update_plan',
  description: `Create or update a step-by-step plan for the current task. Each step has a status: "pending", "in_progress", or "completed". Always have exactly one step as "in_progress" until everything is done. Use "explanation" when changing the plan mid-task.`,
  parameters: {
    type: 'object',
    properties: {
      plan: {
        type: 'array',
        description: 'List of plan steps with their statuses',
        items: {
          type: 'object',
          properties: {
            step: {
              type: 'string',
              description: 'A short description of this step (5-7 words)',
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Current status of this step',
            },
          },
          required: ['step', 'status'],
        },
      },
      explanation: {
        type: 'string',
        description: 'Why the plan was updated (required when re-planning)',
      },
    },
    required: ['plan'],
  },

  async execute(): Promise<ToolResult> {
    // 对齐 Codex：工具本身是 no-op
    // 计划数据由 ThreadManager 从 tool call 参数中提取
    return { content: 'Plan updated' }
  },
}
