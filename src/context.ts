/**
 * 项目上下文加载 — AGENTS.md
 *
 * 对齐 Codex codex-rs/core/src/project_doc.rs
 *
 * 做的事：
 * 1. 从项目根目录（找 .git）加载 AGENTS.md
 * 2. 加 32KiB 大小限制
 * 3. 用 <INSTRUCTIONS> 包裹，作为 user-role message 注入
 *
 * Codex 的发现机制：
 * - 从 CWD 向上找项目根（.git 目录）
 * - 从项目根向下到 CWD，收集所有 AGENTS.md
 * - 优先级：AGENTS.override.md > AGENTS.md
 *
 * 赤兔简化版：只读项目根的 AGENTS.md
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { loadSkills, formatSkillsSummary, type Skill } from './skills/index.js'
import { captureEnvSnapshot, formatFullEnvContext, type EnvDiff } from './utils/env-diff.js'

/** AGENTS.md 最大字节数（对齐 Codex project_doc_max_bytes） */
const MAX_BYTES = 32 * 1024 // 32 KiB

/** AGENTS.md 包裹格式（对齐 Codex fragment.rs） */
const START_MARKER = '# AGENTS.md instructions for'
const BEGIN_TAG = '<INSTRUCTIONS>'
const END_TAG = '</INSTRUCTIONS>'

/**
 * 从 CWD 向上查找项目根目录
 * 项目根 = 包含 .git 目录的最近祖先
 */
export function findProjectRoot(cwd: string): string | null {
  let dir = resolve(cwd)
  for (let i = 0; i < 20; i++) { // 防止无限循环
    if (existsSync(join(dir, '.git'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break // 到达根目录
    dir = parent
  }
  return null
}

/**
 * 加载 AGENTS.md 内容
 *
 * 查找顺序（对齐 Codex candidate_filenames）：
 * 1. AGENTS.override.md（本地覆盖）
 * 2. AGENTS.md（默认）
 *
 * 返回 null 表示没找到
 */
export function loadAgentsMd(projectRoot: string): { content: string; path: string } | null {
  const candidates = ['AGENTS.override.md', 'AGENTS.md']

  for (const filename of candidates) {
    const filePath = join(projectRoot, filename)
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf-8')

      // 大小限制
      if (raw.length > MAX_BYTES) {
        console.warn(`[context] ${filePath} 超过 ${MAX_BYTES} 字节限制，截断`)
      }
      const content = raw.slice(0, MAX_BYTES)

      return { content, path: filePath }
    }
  }

  return null
}

/**
 * 构建 AGENTS.md 注入文本
 *
 * 对齐 Codex fragment.rs 的 serialize_to_text()：
 * ```
 * # AGENTS.md instructions for /path/to/project
 *
 * <INSTRUCTIONS>
 * ...内容...
 * </INSTRUCTIONS>
 * ```
 */
export function formatAgentsMdInjection(content: string, projectPath: string): string {
  return `${START_MARKER} ${projectPath}\n\n${BEGIN_TAG}\n${content}\n${END_TAG}`
}

/**
 * 构建环境上下文（对齐 Codex codex-rs/core/src/environment_context.rs）
 *
 * 使用 XML 子元素格式（serialize_to_xml）：
 * <environment_context>
 *   <cwd>...</cwd>
 *   <shell>...</shell>
 *   ...
 * </environment_context>
 */
export function buildEnvironmentContext(cwd?: string): string {
  const snapshot = captureEnvSnapshot(cwd)
  return formatFullEnvContext(snapshot)
}

/**
 * 一次性构建完整的项目上下文
 *
 * 返回给 Agent Loop 用的初始 messages
 */
export function buildProjectContext(cwd?: string): {
  agentsMdMessage: string | null
  environmentMessage: string
  projectRoot: string | null
  skills: Skill[]
  skillsSummary: string
} {
  const workDir = cwd || process.cwd()
  const projectRoot = findProjectRoot(workDir)

  let agentsMdMessage: string | null = null
  if (projectRoot) {
    const agentsMd = loadAgentsMd(projectRoot)
    if (agentsMd) {
      agentsMdMessage = formatAgentsMdInjection(agentsMd.content, projectRoot)
    }
  }

  const environmentMessage = buildEnvironmentContext(workDir)

  // 加载 Skills
  const skills = projectRoot ? loadSkills(projectRoot) : []
  const skillsSummary = formatSkillsSummary(skills)

  return { agentsMdMessage, environmentMessage, projectRoot, skills, skillsSummary }
}
