import { readFileSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Milestone, MilestonePlan, MilestoneStatus } from './types.js'

const PLANS_FILE = 'plans.md'

export function loadMilestonePlan(projectRoot: string): MilestonePlan | null {
  const filePath = join(projectRoot, PLANS_FILE)
  if (!existsSync(filePath)) return null
  try {
    const content = readFileSync(filePath, 'utf-8')
    return parsePlansMd(content)
  } catch {
    return null
  }
}

export function saveMilestonePlan(projectRoot: string, plan: MilestonePlan): void {
  const filePath = join(projectRoot, PLANS_FILE)
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

    milestones.push({ id, title, scope, keyFiles, acceptanceCriteria, verificationCommands, status })
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
    lines.push('')
  }

  return lines.join('\n')
}
