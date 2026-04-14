/**
 * Memories 模块入口
 *
 * 对齐 Codex codex-rs/core/src/memories/
 * - Phase 1: 从对话中提取记忆 → extractor.ts
 * - 存储: JSON 文件持久化 → storage.ts
 * - 注入: 加载记忆到新对话的上下文
 */

export { MemoryStorage, type Memory, type MemoryCategory } from './storage.js'
export { MemoryExtractor } from './extractor.js'
