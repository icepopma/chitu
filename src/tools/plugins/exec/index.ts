/**
 * ExecPlugin — Shell 命令执行插件
 *
 * 将原来的 execTool 包装为 Plugin 格式。
 * 工具逻辑完全复用 exec.ts，只是增加了插件元数据和生命周期。
 */

import type { Plugin } from '../../plugin-types.js'
import { execTool } from '../../exec.js'

/** Exec 插件 — 提供 exec 工具 */
export const execPlugin: Plugin = {
  name: 'exec',
  version: '1.0.0',
  description: 'Shell 命令执行插件，支持命令审批策略',
  category: 'core',

  tools: [execTool],
}
