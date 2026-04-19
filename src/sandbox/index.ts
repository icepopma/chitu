/**
 * 沙盒执行模块 — 入口
 *
 * 统一导出沙盒相关的类型、配置、执行器。
 *
 * 使用方式：
 *   import { execInSandbox, createDefaultSandboxConfig, detectSandboxPlatform } from '../sandbox/index.js'
 *
 * 参考 Codex codex-rs/sandbox/ 的模块组织
 */

export type { SandboxConfig, SandboxPlatform, SandboxResult } from './types.js'
export { createDefaultSandboxConfig, DEFAULT_WRITABLE_PATHS } from './types.js'
export { detectSandboxPlatform, execInSandbox } from './executor.js'
export type { SandboxExecOptions, SandboxExecResult } from './executor.js'
export { generateSeatbeltPolicy } from './seatbelt.js'
