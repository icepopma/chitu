/**
 * Hooks 模块入口
 *
 * 对齐 Codex codex-rs/hooks/
 * - 5 个 hook 事件点：pre/post tool use, session start/end, user prompt submit
 * - JSON 配置文件：chitu-data/hooks.json
 * - Shell 命令执行，stdin/stdout JSON 通信
 * - Fail-open：hook 失败不阻断主流程
 */

export { HookDispatcher } from './dispatcher.js'
export type {
  HookEvent, HookConfig, HooksConfigFile,
  PreToolUseInput, PreToolUseOutput,
  PostToolUseInput, PostToolUseOutput,
  SessionStartInput,
  UserPromptSubmitInput, UserPromptSubmitOutput,
  HookResult,
} from './types.js'
