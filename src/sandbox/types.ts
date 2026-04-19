/**
 * 沙盒执行 — 类型定义
 *
 * 定义沙盒隔离的配置和策略类型。
 * 参考 Codex codex-rs/sandbox/ 的设计：
 * - 只读项目根目录（除指定可写路径）
 * - 禁止网络访问
 * - 资源限制（CPU、内存、时间）
 *
 * 学习重点：
 * - macOS 使用 sandbox-exec（Seatbelt 策略文件）
 * - Linux 使用 Docker 容器隔离
 * - 沙盒应该是可选的（dev 模式可以关闭）
 */

/** 沙盒平台 */
export type SandboxPlatform = 'macos' | 'linux' | 'none'

/** 沙盒配置 */
export interface SandboxConfig {
  /** 是否启用沙盒（默认 true） */
  enabled: boolean
  /** 项目根目录（只读挂载） */
  projectRoot: string
  /** 允许写入的路径（相对于 projectRoot） */
  writablePaths: string[]
  /** 是否禁止网络访问 */
  blockNetwork: boolean
  /** 命令超时（毫秒） */
  timeout: number
  /** 最大内存使用（MB），0 表示不限制 */
  maxMemoryMb: number
}

/** 沙盒执行结果 */
export interface SandboxResult {
  /** 是否在沙盒中执行 */
  sandboxed: boolean
  /** 使用的平台 */
  platform: SandboxPlatform
}

/** 默认可写路径（相对于项目根目录） */
export const DEFAULT_WRITABLE_PATHS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'tmp',
  'chitu-data',
]

/** 创建默认沙盒配置 */
export function createDefaultSandboxConfig(projectRoot?: string): SandboxConfig {
  return {
    enabled: true,
    projectRoot: projectRoot || process.cwd(),
    writablePaths: [...DEFAULT_WRITABLE_PATHS],
    blockNetwork: true,
    timeout: 120_000,
    maxMemoryMb: 512,
  }
}
