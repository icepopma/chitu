/**
 * Plugin 接口定义 — 工具插件系统核心类型
 *
 * 学习重点：
 * - Plugin 是 Tool 的上层抽象：一个 Plugin 可以包含多个 Tool
 * - 生命周期钩子让插件能管理资源（如数据库连接、文件监听）
 * - 元数据（name, version, description）支持插件发现和版本管理
 *
 * 设计原则：
 * - 向后兼容：Tool 接口不变，Plugin 是外层包装
 * - 单一职责：每个 Plugin 是一个独立的功能模块
 * - 可配置：未来可通过配置文件控制启用的插件
 */

import type { Tool, ToolResult } from './base.js'

// ===== 插件上下文 =====

/** 插件加载时收到的上下文，提供运行时环境信息 */
export interface PluginContext {
  /** 工作目录 */
  cwd: string
  /** 环境变量 */
  env: Record<string, string | undefined>
  /** 插件可以注册的全局配置 */
  config?: Record<string, unknown>
}

// ===== 插件元数据 =====

/** 插件元数据 — 描述插件的静态信息 */
export interface PluginMeta {
  /** 插件唯一标识（如 'exec', 'files', 'plan'） */
  name: string
  /** 语义版本号（如 '1.0.0'） */
  version: string
  /** 人类可读的描述 */
  description: string
  /** 插件类别（如 'core', 'filesystem', 'vcs', 'experimental'） */
  category?: string
  /** 依赖的其他插件名（按顺序加载） */
  dependencies?: string[]
}

// ===== 生命周期钩子 =====

/** 插件生命周期钩子 */
export interface PluginLifecycle {
  /**
   * 插件被加载时调用 — 用于初始化资源
   *
   * 在所有 onLoad 执行完后，插件的 tools 才可用
   * 适合：建立连接、预热缓存、注册全局状态
   */
  onLoad?(ctx: PluginContext): void | Promise<void>

  /**
   * 插件被卸载时调用 — 用于清理资源
   *
   * 在卸载前调用，适合：关闭连接、清理临时文件
   */
  onUnload?(): void | Promise<void>

  /**
   * 工具执行出错时调用 — 统一错误处理
   *
   * 可以用于：日志记录、错误上报、降级策略
   */
  onError?(toolName: string, args: Record<string, unknown>, error: Error): void
}

// ===== Plugin 接口 =====

/**
 * 插件接口 — 一组相关工具的集合 + 元数据 + 生命周期
 *
 * 一个 Plugin 可以提供 1~N 个 Tool。
 * 例如 files 插件提供 read_file、write_file、edit_file 三个工具。
 */
export interface Plugin extends PluginMeta, PluginLifecycle {
  /** 该插件提供的工具列表 */
  tools: Tool[]
}

// ===== 插件状态 =====

/** 插件的运行时状态 */
export type PluginStatus = 'registered' | 'loaded' | 'unloaded' | 'error'

/** 插件的运行时信息（包含状态和错误信息） */
export interface PluginInfo {
  meta: PluginMeta
  status: PluginStatus
  toolNames: string[]
  error?: string
}
