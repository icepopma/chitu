/**
 * FilesPlugin — 文件读写编辑插件
 *
 * 将原来的 readFileTool、writeFileTool、editFileTool 包装为 Plugin 格式。
 * 新增 applyPatchTool（14.1），作为 Agent 的主要文件编辑工具。
 */

import type { Plugin } from '../../plugin-types.js'
import { readFileTool, writeFileTool, editFileTool } from '../../files.js'
import { applyPatchTool } from '../../apply-patch/index.js'

/** Files 插件 — 提供文件读写编辑工具 */
export const filesPlugin: Plugin = {
  name: 'files',
  version: '1.1.0',
  description: '文件操作插件，提供读取、写入、精确编辑、patch 编辑功能',
  category: 'core',

  tools: [readFileTool, writeFileTool, editFileTool, applyPatchTool],
}
