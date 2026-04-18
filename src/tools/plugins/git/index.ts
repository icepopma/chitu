import type { Plugin } from '../../plugin-types.js'
import { gitCheckpointTool } from '../../git/checkpoint.js'
import { gitRollbackTool } from '../../git/rollback.js'
import { gitStatusTool } from '../../git/status.js'
import { gitDiffTool } from '../../git/diff.js'
import { gitBlameTool } from '../../git/blame.js'
import { gitLogTool } from '../../git/log.js'
import { ghostCommitTool, ghostRollbackTool } from '../../git/ghost.js'

export const gitPlugin: Plugin = {
  name: 'git',
  version: '2.0.0',
  description: 'Git integration: status, diff, blame, log, checkpoint, rollback, ghost commit (stash snapshot)',
  category: 'vcs',
  tools: [
    gitStatusTool,
    gitDiffTool,
    gitBlameTool,
    gitLogTool,
    gitCheckpointTool,
    gitRollbackTool,
    ghostCommitTool,
    ghostRollbackTool,
  ],
}
