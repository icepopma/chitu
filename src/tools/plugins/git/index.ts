import type { Plugin } from '../../plugin-types.js'
import { gitCheckpointTool } from '../../git/checkpoint.js'
import { gitRollbackTool } from '../../git/rollback.js'

export const gitPlugin: Plugin = {
  name: 'git',
  version: '1.0.0',
  description: 'Git checkpoint and rollback for milestone-driven development',
  category: 'vcs',
  tools: [gitCheckpointTool, gitRollbackTool],
}
