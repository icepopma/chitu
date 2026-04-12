/**
 * FilesPlugin — 文件读写编辑插件
 *
 * 将原来的 readFileTool、writeFileTool、editFileTool 包装为 Plugin 格式。
 * 一个插件提供 3 个工具，体现"插件 = 一组相关工具"的设计。
 */

import type { Plugin } from '../../plugin-types.js'
import { readFileTool, writeFileTool, editFileTool } from '../../files.js'

/** Files 插件 — 提供文件读写编辑工具 */
export const filesPlugin: Plugin = {
  name: 'files',
  version: '1.0.0',
  description: '文件操作插件，提供读取、写入、精确编辑功能',
  category: 'core',

  tools: [readFileTool, writeFileTool, editFileTool],
}
