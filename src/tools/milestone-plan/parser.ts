import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Milestone, MilestonePlan, MilestoneStatus } from './types.js'

const DEFAULT_PLANS_FILE = 'docs/plans.md'
const ACTIVE_PLAN_FILE = '.chitu/active-plan.json'

/** Resolve which plan file to use: active-plan pointer → fallback to docs/plans.md */
export function resolvePlanPath(projectRoot: string): string {
  const pointerPath = join(projectRoot, ACTIVE_PLAN_FILE)
  if (existsSync(pointerPath)) {
    try {
      const raw = JSON.parse(readFileSync(pointerPath, 'utf-8'))
      if (raw.path && existsSync(join(projectRoot, raw.path))) {
        return raw.path
      }
    } catch { /* invalid json, fall through */ }
  }
  return DEFAULT_PLANS_FILE
}

/** Set the active plan file pointer */
export function setActivePlan(projectRoot: string, planPath: string): void {
  const chituDir = join(projectRoot, '.chitu')
  if (!existsSync(chituDir)) {
    mkdirSync(chituDir, { recursive: true })
  }
  const pointerPath = join(projectRoot, ACTIVE_PLAN_FILE)
  writeFileSync(pointerPath, JSON.stringify({ path: planPath, updatedAt: Date.now() }, null, 2), 'utf-8')
}

/** Clear the active plan pointer (revert to default) */
export function clearActivePlan(projectRoot: string): void {
  const pointerPath = join(projectRoot, ACTIVE_PLAN_FILE)
  if (existsSync(pointerPath)) {
    unlinkSync(pointerPath)
  }
}

export function loadMilestonePlan(projectRoot: string): MilestonePlan | null {
  const planFile = resolvePlanPath(projectRoot)
  const filePath = join(projectRoot, planFile)
  if (!existsSync(filePath)) return null
  try {
    const content = readFileSync(filePath, 'utf-8')
    return parsePlansMd(content)
  } catch {
    return null
  }
}

export function saveMilestonePlan(projectRoot: string, plan: MilestonePlan): void {
  const planFile = resolvePlanPath(projectRoot)
  const filePath = join(projectRoot, planFile)
  const content = serializePlansMd(plan)
  try {
    writeFileSync(filePath, content, 'utf-8')
    plan.lastUpdated = Date.now()
  } catch (err: any) {
    console.error(`[MilestonePlan] Failed to write ${filePath}: ${err.message}`)
  }
}

export function getNextMilestone(plan: MilestonePlan): Milestone | undefined {
  return plan.milestones.find(m => m.status === 'pending')
}

export function getCurrentMilestone(plan: MilestonePlan): Milestone | undefined {
  return plan.milestones.find(m => m.status === 'in_progress')
}

export function formatMilestoneForContext(milestone: Milestone): string {
  const lines: string[] = [
    `# Current Milestone`,
    ``,
    `## ${milestone.id}: ${milestone.title}`,
    `- **Status**: ${milestone.status}`,
    `- **Scope**: ${milestone.scope}`,
  ]

  if (milestone.keyFiles.length > 0) {
    lines.push(`- **Key Files**: ${milestone.keyFiles.map(f => '`' + f + '`').join(', ')}`)
  }

  if (milestone.acceptanceCriteria.length > 0) {
    lines.push(`- **Acceptance Criteria**:`)
    for (const c of milestone.acceptanceCriteria) {
      lines.push(`  - ${c}`)
    }
  }

  if (milestone.verificationCommands.length > 0) {
    lines.push(`- **Verification Commands**: ${milestone.verificationCommands.map(c => '`' + c + '`').join(', ')}`)
  }

  if (milestone.decisionLog.length > 0) {
    lines.push(``)
    lines.push(`### Decisions`)
    for (const d of milestone.decisionLog) {
      lines.push(`- ${d}`)
    }
  }

  return lines.join('\n')
}

function parsePlansMd(content: string): MilestonePlan {
  const milestones: Milestone[] = []
  const sections = content.split(/^## /m).slice(1)

  for (const section of sections) {
    const headerMatch = section.match(/^(M\d+):\s+(.+?)(?:\n|$)/)
    if (!headerMatch) continue

    const id = headerMatch[1]
    const title = headerMatch[2].trim()

    let scope = ''
    let keyFiles: string[] = []
    let acceptanceCriteria: string[] = []
    let verificationCommands: string[] = []
    let status: MilestoneStatus = 'pending'
    let notes: string[] = []
    let decisionLog: string[] = []

    const scopeMatch = section.match(/\*\*Scope\*\*:\s*(.+)/)
    if (scopeMatch) scope = scopeMatch[1].trim()

    const filesMatch = section.match(/\*\*Key Files\*\*:\s*(.+)/)
    if (filesMatch) {
      keyFiles = filesMatch[1].match(/`([^`]+)`/g)?.map(s => s.slice(1, -1)) ?? []
    }

    const criteriaMatch = section.match(/\*\*Acceptance Criteria\*\*:\s*\n((?:\s+- .+\n?)+)/)
    if (criteriaMatch) {
      acceptanceCriteria = criteriaMatch[1].match(/- (.+)/g)?.map(s => s.replace(/^-\s*/, '')) ?? []
    }

    const verifyMatch = section.match(/\*\*Verification Commands\*\*:\s*(.+)/)
    if (verifyMatch) {
      verificationCommands = verifyMatch[1].match(/`([^`]+)`/g)?.map(s => s.slice(1, -1)) ?? []
    }

    const statusMatch = section.match(/\*\*Status\*\*:\s*(pending|in_progress|completed|failed)/)
    if (statusMatch) status = statusMatch[1] as MilestoneStatus

    const notesMatch = section.match(/### Notes\n((?:- .+\n?)+)/)
    if (notesMatch) {
      notes = notesMatch[1].match(/- (.+)/g)?.map(s => s.replace(/^-\s*/, '')) ?? []
    }

    const decisionsMatch = section.match(/### Decisions\n((?:- .+\n?)+)/)
    if (decisionsMatch) {
      decisionLog = decisionsMatch[1].match(/- (.+)/g)?.map(s => s.replace(/^-\s*/, '')) ?? []
    }

    let startedAt: number | undefined
    let completedAt: number | undefined
    const startedMatch = section.match(/\*\*Started\*\*:\s*(\d+)/)
    if (startedMatch) startedAt = parseInt(startedMatch[1], 10)
    const completedMatch = section.match(/\*\*Completed\*\*:\s*(\d+)/)
    if (completedMatch) completedAt = parseInt(completedMatch[1], 10)

    milestones.push({ id, title, scope, keyFiles, acceptanceCriteria, verificationCommands, status, notes, decisionLog, startedAt, completedAt })
  }

  return { version: 1, milestones, lastUpdated: Date.now() }
}

function serializePlansMd(plan: MilestonePlan): string {
  const lines: string[] = [
    `# Implementation Plan`,
    ``,
    `## Verification Checklist`,
  ]

  for (const m of plan.milestones) {
    const check = m.status === 'completed' ? 'x' : ' '
    lines.push(`- [${check}] ${m.id}: ${m.title}`)
  }

  lines.push('')

  for (const m of plan.milestones) {
    lines.push(`## ${m.id}: ${m.title}`)
    lines.push(`- **Scope**: ${m.scope}`)

    if (m.keyFiles.length > 0) {
      lines.push(`- **Key Files**: ${m.keyFiles.map(f => '`' + f + '`').join(', ')}`)
    }

    if (m.acceptanceCriteria.length > 0) {
      lines.push(`- **Acceptance Criteria**:`)
      for (const c of m.acceptanceCriteria) {
        lines.push(`  - ${c}`)
      }
    }

    if (m.verificationCommands.length > 0) {
      lines.push(`- **Verification Commands**: ${m.verificationCommands.map(c => '`' + c + '`').join(', ')}`)
    }

    lines.push(`- **Status**: ${m.status}`)

    if (m.startedAt) lines.push(`- **Started**: ${m.startedAt}`)
    if (m.completedAt) lines.push(`- **Completed**: ${m.completedAt}`)

    if (m.decisionLog.length > 0) {
      lines.push('')
      lines.push(`### Decisions`)
      for (const d of m.decisionLog) {
        lines.push(`- ${d}`)
      }
    }

    if (m.notes.length > 0) {
      lines.push('')
      lines.push(`### Notes`)
      for (const n of m.notes) {
        lines.push(`- ${n}`)
      }
    }

    lines.push('')
  }

  return lines.join('\n')
}
