/**
 * Tool Registry — 工具注册表（基于 PluginLoader）
 *
 * 学习重点：
 * - 注册表从"硬编码注册"升级为"插件驱动"
 * - createToolRegistry() 内部创建 PluginLoader、注册核心插件、加载
 * - 对外接口不变：get(name)、list()、toDefinitions()
 * - 新增 pluginLoader 属性，暴露插件系统的完整能力
 *
 * 向后兼容：
 * - Tool 接口完全不变
 * - toolToDefinition 不变
 * - Agent Loop 只需要 tools 列表，不感知插件
 * - createToolRegistry 保持同步（核心插件无异步初始化需求）
 */

import type { Tool, ToolResult } from './base.js'
import { toolToDefinition } from './base.js'
import { PluginLoader } from './plugin-loader.js'
import { McpClient } from '../mcp/client.js'
import type { McpServerConfig } from '../mcp/types.js'
import { loadMcpConfig } from '../mcp/loader.js'

// 导出核心类型（保持向后兼容）
export type { Tool, ToolResult } from './base.js'
export { toolToDefinition } from './base.js'
export { PluginLoader } from './plugin-loader.js'
export type { Plugin, PluginContext, PluginMeta, PluginInfo } from './plugin-types.js'

// 导出插件（供外部按需注册）
export { execPlugin } from './plugins/exec/index.js'
export { filesPlugin } from './plugins/files/index.js'
export { planPlugin } from './plugins/plan/index.js'
export { milestonePlugin } from './plugins/milestone/index.js'
export { gitPlugin } from './plugins/git/index.js'

// 导出原有工具（保持向后兼容）
export { execTool } from './exec.js'
export { readFileTool, writeFileTool, editFileTool } from './files.js'
export { updatePlanTool } from './plan.js'

// 内部导入（供 createToolRegistry 使用）
import { execPlugin } from './plugins/exec/index.js'
import { filesPlugin } from './plugins/files/index.js'
import { planPlugin } from './plugins/plan/index.js'
import { milestonePlugin } from './plugins/milestone/index.js'
import { gitPlugin } from './plugins/git/index.js'

class ToolRegistry {
  private tools: Map<string, Tool> = new Map()
  /** 暴露 PluginLoader，让外部可以查询插件信息 */
  readonly pluginLoader: PluginLoader
  /** MCP Client 实例列表 */
  private mcpClients: McpClient[] = []

  constructor(pluginLoader: PluginLoader) {
    this.pluginLoader = pluginLoader
    // 从 PluginLoader 同步构建工具表
    for (const tool of pluginLoader.getTools()) {
      this.tools.set(tool.name, tool)
    }
  }

  /** 注册一个额外工具（兼容旧代码，新代码推荐用 Plugin） */
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

  /**
   * 加载 MCP 工具并注册到 Registry
   *
   * 流程：
   * 1. 读取 MCP 配置（.chitu/mcp.json）
   * 2. 为每个 Server 创建 McpClient 并连接
   * 3. 发现工具并转为赤兔 Tool 格式注册
   */
  async loadMcpTools(projectRoot?: string): Promise<void> {
    const configs = loadMcpConfig(projectRoot)

    for (const config of configs) {
      try {
        const client = new McpClient(config)
        await client.connect()

        const tools = client.toChituTools()
        for (const tool of tools) {
          this.tools.set(tool.name, tool)
        }

        this.mcpClients.push(client)
      } catch (err: any) {
        // 单个 MCP Server 连接失败不影响其他
        console.error(`[ToolRegistry] Failed to connect MCP server "${config.name}": ${err.message}`)
      }
    }
  }

  /** 断开所有 MCP 连接 */
  async disconnectMcp(): Promise<void> {
    for (const client of this.mcpClients) {
      await client.disconnect()
    }
    this.mcpClients = []
  }

  /** 获取 MCP Client 列表（用于调试） */
  getMcpClients(): McpClient[] {
    return this.mcpClients
  }
}

/**
 * 创建并返回一个预装了核心工具的 Registry
 *
 * 流程：
 * 1. 创建 PluginLoader
 * 2. 注册核心插件（exec, files, plan）
 * 3. 用 PluginLoader 的工具列表构建 ToolRegistry
 *
 * 注意：核心插件没有异步 onLoad 钩子，所以这里保持同步。
 * 如果插件需要异步初始化，用 createToolRegistryAsync()。
 */
export function createToolRegistry(): ToolRegistry {
  const loader = new PluginLoader()

  loader.register(execPlugin)
  loader.register(filesPlugin)
  loader.register(planPlugin)
  loader.register(milestonePlugin)
  loader.register(gitPlugin)

  return new ToolRegistry(loader)
}

/**
 * 异步版本 — 支持需要异步初始化的插件 + MCP 工具加载
 *
 * 会调用每个插件的 onLoad 钩子（如果有的话）。
 * 然后加载 MCP 配置中定义的外部工具。
 */
export async function createToolRegistryAsync(projectRoot?: string): Promise<ToolRegistry> {
  const loader = new PluginLoader()

  loader.register(execPlugin)
  loader.register(filesPlugin)
  loader.register(planPlugin)
  loader.register(milestonePlugin)
  loader.register(gitPlugin)

  await loader.loadAll()

  const registry = new ToolRegistry(loader)

  // 加载 MCP 工具（非阻塞：失败不影响核心工具）
  try {
    await registry.loadMcpTools(projectRoot)
  } catch (err: any) {
    console.error(`[ToolRegistry] MCP loading failed: ${err.message}`)
  }

  return registry
}
