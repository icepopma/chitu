/**
 * 环境差异检测 — 回合间环境上下文 diff
 *
 * 对齐 Codex codex-rs/core/src/environment_context.rs 的 diff_from_turn_context_item()
 *
 * 做的事：
 * 1. 捕获环境快照（cwd, shell, date, platform）
 * 2. 比较两次快照，只返回变化的字段
 * 3. 格式化为 XML delta 或完整上下文
 *
 * Codex 的做法：
 * - equals_except_shell() 比较除 shell 外的所有字段
 * - diff_from_turn_context_item() 只返回变化部分
 * - 变化通过新消息追加，不修改原有消息
 */

/** 环境快照（结构化数据，用于比较） */
export interface EnvSnapshot {
  cwd: string
  shell: string
  currentDate: string
  platform: string
}

/** 环境差异（只包含变化的字段） */
export type EnvDiff = Partial<EnvSnapshot>

/**
 * 捕获当前环境快照
 *
 * 对齐 Codex EnvironmentContext::new()
 * cwd、shell 来自 process.env，date 实时生成
 */
export function captureEnvSnapshot(cwd?: string): EnvSnapshot {
  const now = new Date()
  return {
    cwd: cwd || process.cwd(),
    shell: process.env.SHELL || '/bin/bash',
    currentDate: now.toISOString().split('T')[0],
    platform: process.platform,
  }
}

/**
 * 比较两次快照，返回变化的字段
 *
 * 对齐 Codex diff_from_turn_context_item()
 * 返回 null 表示完全相同（无需注入）
 */
export function diffEnvSnapshots(before: EnvSnapshot, after: EnvSnapshot): EnvDiff | null {
  const diff: EnvDiff = {}

  if (before.cwd !== after.cwd) diff.cwd = after.cwd
  if (before.shell !== after.shell) diff.shell = after.shell
  if (before.currentDate !== after.currentDate) diff.currentDate = after.currentDate
  if (before.platform !== after.platform) diff.platform = after.platform

  return Object.keys(diff).length > 0 ? diff : null
}

/** XML 转义 */
function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 格式化环境差异为 XML delta 消息
 *
 * 对齐 Codex：只包含变化的字段
 * 格式：<environment_context_update> ... </environment_context_update>
 */
export function formatEnvDelta(diff: EnvDiff): string {
  const fields: string[] = []

  if (diff.cwd !== undefined) {
    fields.push(`  <cwd>${xmlEscape(diff.cwd)}</cwd>`)
  }
  if (diff.shell !== undefined) {
    fields.push(`  <shell>${xmlEscape(diff.shell)}</shell>`)
  }
  if (diff.currentDate !== undefined) {
    fields.push(`  <current_date>${xmlEscape(diff.currentDate)}</current_date>`)
  }
  if (diff.platform !== undefined) {
    fields.push(`  <platform>${xmlEscape(diff.platform)}</platform>`)
  }

  return [
    '<environment_context_update>',
    ...fields,
    '</environment_context_update>',
  ].join('\n')
}

/**
 * 格式化完整环境上下文为 XML
 *
 * 对齐 Codex serialize_to_xml()
 * 用于首次注入（第一个 turn）
 */
export function formatFullEnvContext(snapshot: EnvSnapshot): string {
  const now = new Date()
  return [
    '<environment_context>',
    `  <cwd>${xmlEscape(snapshot.cwd)}</cwd>`,
    `  <shell>${xmlEscape(snapshot.shell)}</shell>`,
    `  <current_date>${xmlEscape(snapshot.currentDate)}</current_date>`,
    `  <current_time>${now.toISOString()}</current_time>`,
    `  <platform>${xmlEscape(snapshot.platform)}</platform>`,
    '</environment_context>',
  ].join('\n')
}
