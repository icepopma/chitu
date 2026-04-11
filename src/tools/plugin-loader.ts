/**
 * PluginLoader — 插件加载器
 *
 * 学习重点：
 * - 插件加载器管理插件的完整生命周期：注册 → 加载 → 卸载
 * - 支持依赖排序（拓扑排序），保证被依赖的插件先加载
 * - 提供查询接口（按名查找、列出所有插件信息）
 * - 错误隔离：单个插件加载失败不影响其他插件
 *
 * 核心方法：
 * - register(plugin) — 注册插件（还没加载）
 * - loadAll(ctx?)    — 加载所有已注册插件（调用 onLoad）
 * - unloadAll()      — 卸载所有插件（调用 onUnload）
 * - getTools()       — 获取所有已加载插件的工具列表
 */

import type { Tool } from './base.js'
import type {
  Plugin,
  PluginContext,
  PluginInfo,
  PluginMeta,
  PluginStatus,
} from './plugin-types.js'

// ===== 插件条目（内部状态） =====

interface PluginEntry {
  plugin: Plugin
  status: PluginStatus
  error?: string
}

// ===== PluginLoader =====

export class PluginLoader {
  private entries: Map<string, PluginEntry> = new Map()

  /** 当前插件上下文（loadAll 时设置） */
  private context: PluginContext

  constructor(context?: Partial<PluginContext>) {
    this.context = {
      cwd: context?.cwd ?? process.cwd(),
      env: context?.env ?? process.env,
      config: context?.config,
    }
  }

  // ===== 注册 =====

  /**
   * 注册一个插件
   *
   * 注册只是"声明"，插件还不算加载。
   * 需要调用 loadAll() 才会执行 onLoad 钩子。
   */
  register(plugin: Plugin): void {
    if (this.entries.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" already registered`)
    }
    this.entries.set(plugin.name, { plugin, status: 'registered' })
  }

  // ===== 加载 =====

  /**
   * 按依赖顺序加载所有已注册插件
   *
   * 加载过程：
   * 1. 拓扑排序（保证依赖先加载）
   * 2. 逐个调用 onLoad 钩子
   * 3. 单个插件失败不影响其他
   */
  async loadAll(): Promise<void> {
    const order = this.topologicalSort()

    for (const name of order) {
      const entry = this.entries.get(name)!
      if (entry.status === 'loaded') continue

      try {
        if (entry.plugin.onLoad) {
          await entry.plugin.onLoad(this.context)
        }
        entry.status = 'loaded'
      } catch (err: any) {
        entry.status = 'error'
        entry.error = err.message
        console.error(`[PluginLoader] Failed to load plugin "${name}": ${err.message}`)
      }
    }
  }

  /**
   * 卸载所有已加载的插件
   *
   * 按加载的反序卸载（先卸载依赖方，再卸载被依赖方）
   */
  async unloadAll(): Promise<void> {
    const order = this.topologicalSort().reverse()

    for (const name of order) {
      const entry = this.entries.get(name)!
      if (entry.status !== 'loaded') continue

      try {
        if (entry.plugin.onUnload) {
          await entry.plugin.onUnload()
        }
        entry.status = 'unloaded'
      } catch (err: any) {
        entry.status = 'error'
        entry.error = err.message
        console.error(`[PluginLoader] Failed to unload plugin "${name}": ${err.message}`)
      }
    }
  }

  // ===== 查询 =====

  /** 获取所有已加载插件的工具列表（flat） */
  getTools(): Tool[] {
    const tools: Tool[] = []
    for (const entry of this.entries.values()) {
      // 'registered' 状态也算可用（核心插件无异步 onLoad）
      if (entry.status === 'loaded' || entry.status === 'registered') {
        tools.push(...entry.plugin.tools)
      }
    }
    return tools
  }

  /** 按名查找已加载的工具 */
  getTool(name: string): Tool | undefined {
    for (const entry of this.entries.values()) {
      if (entry.status === 'loaded' || entry.status === 'registered') {
        const tool = entry.plugin.tools.find(t => t.name === name)
        if (tool) return tool
      }
    }
    return undefined
  }

  /** 按名查找插件 */
  getPlugin(name: string): Plugin | undefined {
    return this.entries.get(name)?.plugin
  }

  /** 获取所有插件的信息（用于调试和 UI） */
  listPlugins(): PluginInfo[] {
    const infos: PluginInfo[] = []
    for (const entry of this.entries.values()) {
      infos.push({
        meta: {
          name: entry.plugin.name,
          version: entry.plugin.version,
          description: entry.plugin.description,
          category: entry.plugin.category,
          dependencies: entry.plugin.dependencies,
        },
        status: entry.status,
        toolNames: entry.plugin.tools.map(t => t.name),
        error: entry.error,
      })
    }
    return infos
  }

  // ===== 内部方法 =====

  /**
   * 拓扑排序 — 保证依赖先加载
   *
   * 算法：Kahn's algorithm（BFS 拓扑排序）
   * 如果有循环依赖，抛出错误
   */
  private topologicalSort(): string[] {
    const names = Array.from(this.entries.keys())
    const inDegree = new Map<string, number>()
    const graph = new Map<string, string[]>()

    // 初始化
    for (const name of names) {
      inDegree.set(name, 0)
      graph.set(name, [])
    }

    // 构建图
    for (const name of names) {
      const plugin = this.entries.get(name)!.plugin
      for (const dep of plugin.dependencies ?? []) {
        if (!this.entries.has(dep)) {
          throw new Error(`Plugin "${name}" depends on "${dep}", but "${dep}" is not registered`)
        }
        graph.get(dep)!.push(name)
        inDegree.set(name, (inDegree.get(name) ?? 0) + 1)
      }
    }

    // BFS
    const queue: string[] = []
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name)
    }

    const result: string[] = []
    while (queue.length > 0) {
      const current = queue.shift()!
      result.push(current)

      for (const neighbor of graph.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1
        inDegree.set(neighbor, newDegree)
        if (newDegree === 0) queue.push(neighbor)
      }
    }

    if (result.length !== names.length) {
      throw new Error('Circular dependency detected among plugins')
    }

    return result
  }
}
