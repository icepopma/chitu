/**
 * Hook 分发器 — 加载配置、执行 hook 命令、解析输出
 *
 * 对齐 Codex codex-rs/hooks/src/engine/dispatcher.rs
 *
 * 执行模型：
 * - Hook 命令通过 stdin 接收 JSON 输入
 * - 通过 stdout 返回 JSON 输出
 * - 超时则视为 pass-through（不阻断主流程）
 * - 执行失败则视为 pass-through（fail-open）
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import type {
  HookEvent, HookConfig, HooksConfigFile,
  PreToolUseInput, PreToolUseOutput,
  PostToolUseInput, PostToolUseOutput,
  SessionStartInput,
  UserPromptSubmitInput, UserPromptSubmitOutput,
  HookResult,
} from './types.js'
import { logger } from '../monitoring/logger.js'

/** 默认配置文件路径 */
const DEFAULT_CONFIG_PATH = join(process.cwd(), 'chitu-data', 'hooks.json')

/** 默认超时（毫秒） */
const DEFAULT_TIMEOUT = 5_000

/**
 * Hook 分发器
 *
 * 职责：
 * 1. 加载 hooks.json 配置
 * 2. 按事件类型查找匹配的 hooks
 * 3. 顺序执行 hook 命令
 * 4. 解析输出，返回 HookResult
 */
export class HookDispatcher {
  private config: HooksConfigFile
  private configPath: string

  constructor(configPath?: string) {
    this.configPath = configPath ?? DEFAULT_CONFIG_PATH
    this.config = this.loadConfig()
  }

  /** 加载配置文件 */
  private loadConfig(): HooksConfigFile {
    try {
      if (!existsSync(this.configPath)) return { hooks: {} }
      const raw = readFileSync(this.configPath, 'utf-8')
      return JSON.parse(raw) as HooksConfigFile
    } catch {
      return { hooks: {} }
    }
  }

  /** 重新加载配置（支持热更新） */
  reload(): void {
    this.config = this.loadConfig()
  }

  /** 获取指定事件的 hook 列表 */
  private getHooks(event: HookEvent): HookConfig[] {
    return (this.config.hooks[event] || []).filter(h => h.enabled !== false)
  }

  /** 执行单个 hook 命令，返回 stdout */
  private executeHook(
    hook: HookConfig,
    input: object,
  ): Promise<string> {
    const timeout = hook.timeout ?? DEFAULT_TIMEOUT
    const inputJson = JSON.stringify(input)

    return new Promise((resolve, reject) => {
      const child = execFile('sh', ['-c', hook.command], {
        timeout,
        maxBuffer: 1024 * 1024, // 1MB
        env: { ...process.env },
      }, (error, stdout) => {
        if (error) {
          reject(new Error(`Hook "${hook.name}" failed: ${error.message}`))
          return
        }
        resolve(stdout.trim())
      })

      if (child.stdin) {
        child.stdin.write(inputJson)
        child.stdin.end()
      }
    })
  }

  /**
   * 分发 pre_tool_use 事件
   *
   * 执行所有 pre_tool_use hooks，任一 hook 返回 block 则阻止
   * 返回 modify 则更新工具参数
   */
  async dispatchPreToolUse(input: PreToolUseInput): Promise<HookResult> {
    const hooks = this.getHooks('pre_tool_use')
    if (hooks.length === 0) return { blocked: false }

    let modifiedArgs: Record<string, unknown> | undefined

    for (const hook of hooks) {
      try {
        const output = await this.executeHook(hook, input)
        const parsed = this.parseOutput<PreToolUseOutput>(output)

        if (!parsed) continue

        if (parsed.action === 'block') {
          logger.info('Hook blocked', { hookName: hook.name, reason: parsed.reason || 'no reason' })
          return { blocked: true, blockReason: parsed.reason }
        }

        if (parsed.action === 'modify' && parsed.args) {
          modifiedArgs = parsed.args
        }
      } catch (err) {
        logger.warn('Hook error (fail-open)', { hookName: hook.name, error: (err as Error).message })
      }
    }

    return { blocked: false, modifiedArgs }
  }

  /**
   * 分发 post_tool_use 事件
   *
   * 执行所有 post_tool_use hooks，可以修改工具输出
   */
  async dispatchPostToolUse(input: PostToolUseInput): Promise<HookResult> {
    const hooks = this.getHooks('post_tool_use')
    if (hooks.length === 0) return { blocked: false }

    let currentResult = input.result

    for (const hook of hooks) {
      try {
        const hookInput = { ...input, result: currentResult }
        const output = await this.executeHook(hook, hookInput)
        const parsed = this.parseOutput<PostToolUseOutput>(output)

        if (!parsed) continue

        if (parsed.action === 'modify' && parsed.result !== undefined) {
          currentResult = parsed.result
        }
      } catch (err) {
        logger.warn('Hook error (fail-open)', { hookName: hook.name, error: (err as Error).message })
      }
    }

    return { blocked: false, modifiedResult: currentResult !== input.result ? currentResult : undefined }
  }

  /**
   * 分发 user_prompt_submit 事件
   *
   * 可以修改用户输入
   */
  async dispatchUserPromptSubmit(input: UserPromptSubmitInput): Promise<HookResult> {
    const hooks = this.getHooks('user_prompt_submit')
    if (hooks.length === 0) return { blocked: false }

    let currentPrompt = input.prompt

    for (const hook of hooks) {
      try {
        const hookInput = { ...input, prompt: currentPrompt }
        const output = await this.executeHook(hook, hookInput)
        const parsed = this.parseOutput<UserPromptSubmitOutput>(output)

        if (!parsed) continue

        if (parsed.action === 'modify' && parsed.prompt !== undefined) {
          currentPrompt = parsed.prompt
        }
      } catch (err) {
        logger.warn('Hook error (fail-open)', { hookName: hook.name, error: (err as Error).message })
      }
    }

    return { blocked: false, modifiedPrompt: currentPrompt !== input.prompt ? currentPrompt : undefined }
  }

  /**
   * 分发 session_start / session_end 事件（单向通知，不修改任何东西）
   */
  async dispatchSessionEvent(
    event: 'session_start' | 'session_end',
    input: SessionStartInput,
  ): Promise<void> {
    const hooks = this.getHooks(event)
    for (const hook of hooks) {
      try {
        await this.executeHook(hook, input)
      } catch (err) {
        logger.warn('Hook error (fail-open)', { hookName: hook.name, error: (err as Error).message })
      }
    }
  }

  /** 安全解析 JSON 输出 */
  private parseOutput<T>(output: string): T | null {
    if (!output) return null
    try {
      return JSON.parse(output) as T
    } catch {
      return null
    }
  }

  /** 获取当前配置（调试用） */
  getConfig(): HooksConfigFile {
    return this.config
  }
}
