/**
 * Hooks 类型定义
 *
 * 对齐 Codex codex-rs/hooks/ 的 5 个 hook 事件点：
 * - pre_tool_use: 工具执行前（可阻止或修改参数）
 * - post_tool_use: 工具执行后（可修改输出）
 * - session_start: 会话启动
 * - user_prompt_submit: 用户输入提交（可修改 prompt）
 * - session_end: 会话结束
 */

/** Hook 事件类型 */
export type HookEvent =
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'session_start'
  | 'session_end'
  | 'user_prompt_submit'

/** 单个 Hook 配置 */
export interface HookConfig {
  /** Hook 名称（标识用） */
  name: string
  /** 要执行的 shell 命令 */
  command: string
  /** 超时时间（毫秒），默认 5000 */
  timeout?: number
  /** 是否启用，默认 true */
  enabled?: boolean
}

/** Hook 配置文件格式 */
export interface HooksConfigFile {
  hooks: Partial<Record<HookEvent, HookConfig[]>>
}

/** pre_tool_use hook 的输入 */
export interface PreToolUseInput {
  toolName: string
  args: Record<string, unknown>
}

/** pre_tool_use hook 的输出 */
export interface PreToolUseOutput {
  action: 'proceed' | 'block' | 'modify'
  reason?: string
  args?: Record<string, unknown>
}

/** post_tool_use hook 的输入 */
export interface PostToolUseInput {
  toolName: string
  args: Record<string, unknown>
  result: string
  isError: boolean
  exitCode?: number
}

/** post_tool_use hook 的输出 */
export interface PostToolUseOutput {
  action: 'pass-through' | 'modify'
  result?: string
}

/** session_start hook 的输入 */
export interface SessionStartInput {
  threadId: string
}

/** user_prompt_submit hook 的输入 */
export interface UserPromptSubmitInput {
  prompt: string
  threadId: string
}

/** user_prompt_submit hook 的输出 */
export interface UserPromptSubmitOutput {
  action: 'proceed' | 'modify'
  prompt?: string
}

/** Hook 执行结果（通用） */
export interface HookResult {
  /** 是否被 hook 阻止 */
  blocked: boolean
  /** 阻止原因 */
  blockReason?: string
  /** 修改后的工具参数（pre hook） */
  modifiedArgs?: Record<string, unknown>
  /** 修改后的工具输出（post hook） */
  modifiedResult?: string
  /** 修改后的用户输入（prompt hook） */
  modifiedPrompt?: string
}
