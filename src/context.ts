/**
 * 项目上下文加载 — AGENTS.md（分层收集）
 *
 * 对齐 Codex codex-rs/core/src/project_doc.rs + codex-rs/instructions/src/user_instructions.rs
 *
 * 做的事：
 * 1. 从 CWD 向上找项目根（.git 目录）
 * 2. 从项目根向下到 CWD，逐层收集 AGENTS.md
 * 3. 每层优先级：AGENTS.override.md > AGENTS.md
 * 4. 每个文件用 <INSTRUCTIONS> 独立包裹，按层级顺序拼接
 * 5. 总大小限制 32KiB
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname, join, relative } from 'path'
import { loadSkills, formatSkillsSummary, type Skill } from './skills/index.js'
import { captureEnvSnapshot, formatFullEnvContext, type EnvDiff } from './utils/env-diff.js'

/** AGENTS.md 总大小上限（对齐 Codex project_doc_max_bytes） */
const MAX_BYTES = 32 * 1024 // 32 KiB

/** 每层目录的候选文件名（优先级从高到低） */
const CANDIDATE_FILENAMES = ['AGENTS.override.md', 'AGENTS.md'] as const

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
 * 在单个目录中加载 AGENTS.md 内容
 *
 * 查找顺序（对齐 Codex candidate_filenames）：
 * 1. AGENTS.override.md（本地覆盖）
 * 2. AGENTS.md（默认）
 *
 * 返回 null 表示该目录没有 AGENTS.md
 */
export function loadAgentsMd(dir: string): { content: string; path: string } | null {
  for (const filename of CANDIDATE_FILENAMES) {
    const filePath = join(dir, filename)
    try {
      const raw = readFileSync(filePath, 'utf-8')
      return { content: raw, path: filePath }
    } catch {
      // 文件不存在，尝试下一个候选
    }
  }
  return null
}

/**
 * 计算从 projectRoot 到 cwd 的路径链
 *
 * 例如：projectRoot=/project, cwd=/project/src/server
 * 返回：['/project', '/project/src', '/project/src/server']
 */
export function buildPathChain(projectRoot: string, cwd: string): string[] {
  const resolvedRoot = resolve(projectRoot)
  const resolvedCwd = resolve(cwd)

  // CWD 在 projectRoot 之下（或相等）
  const rel = relative(resolvedRoot, resolvedCwd)
  if (rel.startsWith('..')) {
    // CWD 不在 projectRoot 下，只返回 projectRoot
    return [resolvedRoot]
  }

  const segments = rel === '' ? [] : rel.split('/')
  const chain: string[] = [resolvedRoot]
  let current = resolvedRoot
  for (const seg of segments) {
    current = join(current, seg)
    chain.push(current)
  }
  return chain
}

/**
 * 分层收集 AGENTS.md（对齐 Codex user_instructions.rs）
 *
 * 算法：
 * 1. 从 projectRoot 到 cwd 逐层扫描
 * 2. 每层按优先级选一个文件（AGENTS.override.md > AGENTS.md）
 * 3. 每个文件独立包装成 Codex 格式
 * 4. 按层级顺序拼接，总共不超过 MAX_BYTES
 *
 * 返回拼接后的完整注入文本，或 null（没有任何 AGENTS.md）
 */
export function loadHierarchicalAgentsMd(projectRoot: string, cwd: string): string | null {
  const chain = buildPathChain(projectRoot, cwd)
  const parts: string[] = []
  let totalBytes = 0

  for (const dir of chain) {
    const file = loadAgentsMd(dir)
    if (!file) continue

    const wrapped = formatAgentsMdInjection(file.content, dir)

    // 检查总预算
    if (totalBytes + wrapped.length > MAX_BYTES) {
      const remaining = MAX_BYTES - totalBytes
      // overhead = 包装标签的固定开销（不随内容长度变化）
      const overhead = wrapped.length - file.content.length
      const contentBudget = remaining - overhead

      if (contentBudget > 0) {
        console.warn(`[context] 分层 AGENTS.md 总预算即将用尽，${dir} 的内容被截断`)
        parts.push(formatAgentsMdInjection(file.content.slice(0, contentBudget), dir))
      } else {
        console.warn(`[context] 分层 AGENTS.md 预算不足，跳过 ${dir}（剩余 ${remaining} 字节，包装开销 ${overhead} 字节）`)
      }
      break
    }

    parts.push(wrapped)
    totalBytes += wrapped.length
  }

  return parts.length > 0 ? parts.join('\n\n') : null
}

/**
 * 构建 AGENTS.md 注入文本（单文件）
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

  // v13.6: 分层收集 AGENTS.md（root → CWD 逐层扫描）
  const agentsMdMessage = projectRoot
    ? loadHierarchicalAgentsMd(projectRoot, workDir)
    : null

  const environmentMessage = buildEnvironmentContext(workDir)

  // 加载 Skills
  const skills = projectRoot ? loadSkills(projectRoot) : []
  const skillsSummary = formatSkillsSummary(skills)

  return { agentsMdMessage, environmentMessage, projectRoot, skills, skillsSummary }
}
