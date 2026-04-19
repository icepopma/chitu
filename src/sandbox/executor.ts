/**
 * 沙盒执行器 — 统一接口
 *
 * 根据平台选择合适的沙盒方式执行命令：
 * - macOS: sandbox-exec + Seatbelt 策略
 * - Linux: Docker 容器（M13 实现完整 Docker 支持）
 * - 其他/禁用: 直接执行（无沙盒）
 *
 * 参考 Codex codex-rs/sandbox/ 的架构：
 * - SandboxExecutor 统一接口
 * - 平台检测 → 策略生成 → 沙盒执行
 *
 * 学习重点：
 * - sandbox-exec -p <policy> <command> 在 macOS 上启动沙盒进程
 * - 策略文件是临时创建的，执行完毕后清理
 * - 沙盒是安全层，不影响正常开发流程
 */

import { exec as childExec, execSync } from 'child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import type { SandboxConfig, SandboxPlatform } from './types.js'
import { generateSeatbeltPolicy } from './seatbelt.js'

/** 检测当前平台的沙盒能力 */
export function detectSandboxPlatform(): SandboxPlatform {
  const platform = process.platform
  if (platform === 'darwin') {
    // macOS — 检查 sandbox-exec 是否可用
    try {
      execSync('which sandbox-exec 2>/dev/null', { timeout: 3000, encoding: 'utf-8' })
      return 'macos'
    } catch {
      // sandbox-exec 不可用
    }
    return 'none'
  }
  if (platform === 'linux') {
    // Linux — 检查 Docker 是否可用
    try {
      execSync('which docker 2>/dev/null', { timeout: 3000, encoding: 'utf-8' })
      return 'linux'
    } catch {
      // Docker 不可用
    }
    return 'none'
  }
  return 'none'
}

/** 沙盒执行选项 */
export interface SandboxExecOptions {
  /** 要执行的命令 */
  command: string
  /** 沙盒配置 */
  config: SandboxConfig
  /** Shell 路径 */
  shell: string
  /** 环境变量 */
  env: Record<string, string>
  /** 工作目录 */
  cwd?: string
  /** 超时（毫秒） */
  timeout?: number
}

/** 沙盒执行结果 */
export interface SandboxExecResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  sandboxed: boolean
  platform: SandboxPlatform
}

/**
 * 在沙盒中执行命令
 *
 * 流程：
 * 1. 检查沙盒是否启用
 * 2. 检测平台
 * 3. 生成策略
 * 4. 执行命令
 * 5. 清理临时文件
 */
export function execInSandbox(options: SandboxExecOptions): Promise<SandboxExecResult> {
  const { command, config, shell, env, cwd, timeout } = options

  // 沙盒未启用 → 直接执行
  if (!config.enabled) {
    return execDirect(command, { shell, env, cwd, timeout: timeout || config.timeout })
  }

  const platform = detectSandboxPlatform()

  switch (platform) {
    case 'macos':
      return execMacosSandbox(command, config, { shell, env, cwd, timeout: timeout || config.timeout })
    case 'linux':
      // Linux Docker 沙盒将在 M13 完善
      // 目前直接执行，记录 warning
      return execDirect(command, { shell, env, cwd, timeout: timeout || config.timeout })
    case 'none':
    default:
      return execDirect(command, { shell, env, cwd, timeout: timeout || config.timeout })
  }
}

/** 直接执行（无沙盒） */
function execDirect(
  command: string,
  opts: { shell: string; env: Record<string, string>; cwd?: string; timeout: number },
): Promise<SandboxExecResult> {
  return new Promise((resolve) => {
    childExec(
      command,
      {
        timeout: opts.timeout,
        maxBuffer: 1024 * 1024,
        shell: opts.shell,
        env: { ...process.env, ...opts.env },
        cwd: opts.cwd,
      },
      (error, stdout, stderr) => {
        const exitCode = error ? (error as any).code || 1 : 0
        const timedOut = error ? !!(error as any).killed : false
        resolve({
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim(),
          exitCode,
          timedOut,
          sandboxed: false,
          platform: 'none',
        })
      },
    )
  })
}

/**
 * macOS sandbox-exec 沙盒执行
 *
 * 使用 Seatbelt 策略文件限制进程权限。
 * sandbox-exec -p <policy> <command>
 */
function execMacosSandbox(
  command: string,
  config: SandboxConfig,
  opts: { shell: string; env: Record<string, string>; cwd?: string; timeout: number },
): Promise<SandboxExecResult> {
  const policy = generateSeatbeltPolicy(config)
  const policyFile = join(tmpdir(), `chitu-sandbox-${Date.now()}.sb`)

  try {
    writeFileSync(policyFile, policy, 'utf-8')
  } catch (writeError) {
    // 策略文件写入失败 → 降级到直接执行
    return execDirect(command, opts)
  }

  return new Promise((resolve) => {
    // sandbox-exec -p <policy_file> <shell> -c <command>
    const sandboxCommand = `sandbox-exec -p "${policyFile}" ${opts.shell} -c ${JSON.stringify(command)}`

    childExec(
      sandboxCommand,
      {
        timeout: opts.timeout,
        maxBuffer: 1024 * 1024,
        shell: opts.shell,
        env: { ...process.env, ...opts.env },
        cwd: opts.cwd || config.projectRoot,
      },
      (error, stdout, stderr) => {
        // 清理临时策略文件
        try {
          if (existsSync(policyFile)) unlinkSync(policyFile)
        } catch {
          // 清理失败不影响结果
        }

        const exitCode = error ? (error as any).code || 1 : 0
        const timedOut = error ? !!(error as any).killed : false
        resolve({
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim(),
          exitCode,
          timedOut,
          sandboxed: true,
          platform: 'macos',
        })
      },
    )
  })
}
