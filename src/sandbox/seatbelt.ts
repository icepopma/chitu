/**
 * macOS Seatbelt 策略生成器
 *
 * macOS 的 sandbox-exec 使用 Seatbelt 策略文件（SBPL）来限制进程权限。
 * 参考 Codex codex-rs/sandbox/ 的策略设计。
 *
 * 策略核心：
 * 1. 默认拒绝所有操作（deny default）
 * 2. 允许读取项目根目录
 * 3. 允许写入指定路径
 * 4. 允许执行必要的系统命令
 * 5. 禁止网络访问（可选）
 *
 * 学习重点：
 * - Seatbelt 使用 (version 1) 格式的 S-expression
 * - deny default → 白名单模式，未明确允许的操作全部拒绝
 * - allow file-read* → 允许文件读取
 * - deny network* → 禁止网络
 * - sandbox-exec 在 macOS 10.0+ 可用，但 Apple 标记为 deprecated（实际仍可用）
 */

import type { SandboxConfig } from './types.js'
import { resolve } from 'node:path'

/**
 * 生成 Seatbelt 策略字符串
 *
 * 策略结构：
 * 1. 默认拒绝所有
 * 2. 允许读取系统路径（/usr, /bin, /lib, /System, /etc, /tmp, /dev）
 * 3. 允许读取项目根目录
 * 4. 允许写入指定路径
 * 5. 允许进程创建（fork/exec）
 * 6. 禁止网络（如果配置要求）
 * 7. 允许信号处理
 * 8. 允许 mach 系统调用
 */
export function generateSeatbeltPolicy(config: SandboxConfig): string {
  const projectRoot = resolve(config.projectRoot)
  const writablePaths = config.writablePaths.map(p => resolve(projectRoot, p))

  const rules: string[] = [
    '(version 1)',
    '(deny default)',
  ]

  // 允许读取系统路径（运行任何命令都需要）
  const systemPaths = [
    '/usr', '/bin', '/sbin', '/lib', '/System',
    '/etc', '/private/etc', '/tmp', '/private/tmp',
    '/dev', '/var', '/private/var',
  ]
  for (const sysPath of systemPaths) {
    rules.push(`(allow file-read* (subpath "${sysPath}"))`)
  }

  // 允许读取项目根目录
  rules.push(`(allow file-read* (subpath "${projectRoot}"))`)

  // 允许写入指定路径
  for (const writablePath of writablePaths) {
    rules.push(`(allow file-write* (subpath "${writablePath}"))`)
  }

  // 允许写入 /tmp（很多命令需要临时目录）
  rules.push('(allow file-write* (subpath "/tmp"))')
  rules.push('(allow file-write* (subpath "/private/tmp"))')

  // 允许进程操作
  rules.push('(allow process-exec)')
  rules.push('(allow process-fork)')

  // 允许信号处理
  rules.push('(allow signal)')

  // 允许 mach 系统调用
  rules.push('(allow mach-lookup)')

  // 允许 file-read-metadata（ls、stat 等命令需要）
  rules.push('(allow file-read-metadata)')

  // 允许 file-read-data（实际读取文件内容）
  rules.push('(allow file-read-data)')

  // 允许 ipc（进程间通信，Node.js child_process 需要）
  rules.push('(allow ipc-posix-sem)')
  rules.push('(allow ipc-posix-shm)')
  rules.push('(allow ipc-sysv-sem)')
  rules.push('(allow ipc-sysv-shm)')

  // 网络控制
  if (!config.blockNetwork) {
    rules.push('(allow network*)')
  }
  // blockNetwork=true 时不添加网络规则，deny default 会拒绝网络

  return rules.join('\n')
}

/**
 * 将策略写入临时文件并返回路径
 * （在 executor 中使用）
 */
export { generateSeatbeltPolicy as generatePolicy }
