export type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface Milestone {
  id: string
  title: string
  scope: string
  keyFiles: string[]
  acceptanceCriteria: string[]
  verificationCommands: string[]
  status: MilestoneStatus
  notes: string[]
  decisionLog: string[]
  /** timestamp when milestone was started (marked in_progress) */
  startedAt?: number
  /** timestamp when milestone was completed or failed */
  completedAt?: number
}

export interface MilestonePlan {
  version: number
  milestones: Milestone[]
  lastUpdated: number
}
