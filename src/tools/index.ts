/**
 * Tool Registry — 工具注册表
 *
 * 学习重点：
 * - 注册表模式：所有工具在这里注册，Agent Loop 从这里查找
 * - 添加新工具只需要：1) 实现 Tool 接口，2) 在这里 register
 * - 这就是"通用架构"的扩展点
 */

import type { Tool, ToolResult } from './base.js'
import { toolToDefinition } from './base.js'
import { execTool } from './exec.js'
import { readFileTool, writeFileTool, editFileTool } from './files.js'

export type { Tool, ToolResult } from './base.js'
export { toolToDefinition } from './base.js'

class ToolRegistry {
  private tools: Map<string, Tool> = new Map()

  /** 注册一个工具 */
  register(tool: Tool) {
    this.tools.set(tool.name, tool)
  }

  /** 按名字查找工具 */
  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  /** 列出所有工具 */
  list(): Tool[] {
    return Array.from(this.tools.values())
  }

  /** 生成 GLM function calling 格式的工具定义列表 */
  toDefinitions() {
    return this.list().map(toolToDefinition)
  }
}

/** 创建并返回一个预装了核心工具的 Registry */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(execTool)
  registry.register(readFileTool)
  registry.register(writeFileTool)
  registry.register(editFileTool)
  return registry
}
