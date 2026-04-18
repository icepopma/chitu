export type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface Milestone {
  id: string
  title: string
  scope: string
  keyFiles: string[]
  acceptanceCriteria: string[]
  verificationCommands: string[]
  status: MilestoneStatus
}

export interface MilestonePlan {
  version: number
  milestones: Milestone[]
  lastUpdated: number
}
