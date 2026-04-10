/**
 * Skill Loader — 发现和解析 SKILL.md 文件
 *
 * 对齐 Codex codex-rs/skills/src/lib.rs + codex-rs/core/src/skills.rs
 *
 * Skills 是可复用的工作流模板，以 Markdown 文件形式存储。
 * 格式：YAML frontmatter（name, description, allowed-tools）+ Markdown 正文
 *
 * 发现位置（简化版，只支持项目级）：
 *   .agents/skills/<skill-name>/SKILL.md
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

/** 解析后的 Skill 结构 */
export interface Skill {
  /** Skill 名称（来自目录名或 frontmatter） */
  name: string
  /** 描述（用于匹配和展示） */
  description: string
  /** 允许使用的工具列表 */
  allowedTools: string[]
  /** 完整 Markdown 内容（不含 frontmatter） */
  content: string
  /** 文件路径 */
  path: string
}

/** 从项目根目录加载所有 Skills */
export function loadSkills(projectRoot: string): Skill[] {
  const skillsDir = join(projectRoot, '.agents', 'skills')
  if (!existsSync(skillsDir)) return []

  const skills: Skill[] = []

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillPath = join(skillsDir, entry.name, 'SKILL.md')
      if (!existsSync(skillPath)) continue

      try {
        const skill = parseSkillMd(skillPath, entry.name)
        if (skill) skills.push(skill)
      } catch {
        // 跳过解析失败的文件
      }
    }
  } catch {
    // 目录不可读
  }

  return skills
}

/** 解析 SKILL.md 文件（YAML frontmatter + Markdown body） */
export function parseSkillMd(filePath: string, fallbackName: string): Skill | null {
  const raw = readFileSync(filePath, 'utf-8')

  // 解析 YAML frontmatter
  const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!frontmatterMatch) return null

  const [, frontmatter, content] = frontmatterMatch

  // 简易 YAML 解析（只处理顶层 key: value）
  const meta = parseSimpleYaml(frontmatter)

  return {
    name: (meta['name'] as string) || fallbackName,
    description: (meta['description'] as string) || '',
    allowedTools: parseAllowedTools(meta['allowed-tools']),
    content: content.trim(),
    path: filePath,
  }
}

/** 解析 allowed-tools 字段（支持字符串或数组格式） */
function parseAllowedTools(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') return [value]
  return []
}

/** 简易 YAML 解析（顶层 key: value） */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const line of yaml.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colonIndex = trimmed.indexOf(':')
    if (colonIndex === -1) continue
    const key = trimmed.slice(0, colonIndex).trim()
    let value: unknown = trimmed.slice(colonIndex + 1).trim()
    // 去掉引号
    if (typeof value === 'string' && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

/** 将 Skills 描述格式化为注入文本 */
export function formatSkillsSummary(skills: Skill[]): string {
  if (skills.length === 0) return ''

  const lines = skills.map(s => {
    const desc = s.description.length > 100 ? s.description.slice(0, 100) + '...' : s.description
    return `- **${s.name}**: ${desc}`
  })

  return lines.join('\n')
}

/** 将匹配到的 Skill 完整内容格式化为注入文本 */
export function formatSkillInjection(skill: Skill): string {
  return `<skill name="${skill.name}">\n${skill.content}\n</skill>`
}
