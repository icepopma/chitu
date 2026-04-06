/**
 * 命令审批策略（Command Approval Policy）
 *
 * 对齐 Codex codex-rs/core/src/exec.rs 的审批逻辑
 *
 * 核心思想：
 * - 只读命令（ls, cat, git status）→ 自动批准
 * - 写入命令（rm, git push, npm publish）→ 需要用户确认
 * - Agent 不应该有不受限制的权力
 *
 * 审批策略可配置：
 * - 'auto-approve' — 全部自动批准（开发/测试用）
 * - 'ask-user' — 高风险命令需用户确认（生产用）
 */

// ===== 命令分类 =====

/** 只读命令前缀（自动批准） */
const READ_ONLY_PREFIXES = [
  'ls', 'cat', 'head', 'tail', 'wc', 'file',
  'grep', 'rg', 'find', 'which', 'where', 'type',
  'echo', 'printf',   // 纯输出，无副作用
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote',
  'git stash list', 'git tag',
  'node -e', 'node --eval', 'node -p', 'node --print',
  'npm list', 'npm ls', 'npm view', 'npm info',
  'npx tsc --noEmit', 'npx tsc -p',
  'npm test', 'npm run test', 'npm t',
  'env', 'printenv', 'whoami', 'hostname', 'uname', 'date',
  'curl', 'wget',       // 网络请求（只读）
  'pwd',
]

/** 危险命令（需要确认） */
const DANGEROUS_COMMANDS = [
  'rm', 'rmdir', 'rm -rf',
  'git push', 'git push --force', 'git push -f',
  'git reset --hard', 'git clean',
  'git rebase',
  'npm publish',
  'sudo', 'su',
  'chmod 777', 'chown',
  'mkfs', 'dd',
  'shutdown', 'reboot',
  'kill -9',
  ':(){:|:&};:',  // fork bomb
]

/** 写入命令前缀（需要确认） */
const WRITE_PREFIXES = [
  'cp', 'mv', 'mkdir', 'touch', 'chmod', 'chown',
  'git add', 'git commit', 'git merge', 'git checkout',
  'git stash push', 'git stash drop', 'git stash pop',
  'git switch', 'git restore',
  'npm install', 'npm uninstall', 'npm ci',
  'pip install', 'pip uninstall',
  'brew install', 'brew uninstall',
]

/** 命令风险等级 */
export type RiskLevel = 'read' | 'write' | 'dangerous'

/** 审批决策 */
export type ApprovalDecision = 'auto-approved' | 'needs-approval' | 'rejected'

/**
 * 判断命令的风险等级
 *
 * 策略：
 * 1. 先检查危险命令（精确匹配最高优先）
 * 2. 再检查只读前缀（自动批准）
 * 3. 再检查写入前缀（需确认）
 * 4. 默认需确认（保守策略）
 */
export function classifyCommand(command: string): RiskLevel {
  const trimmed = command.trim()

  // 1. 检查危险命令
  for (const dangerous of DANGEROUS_COMMANDS) {
    if (trimmed === dangerous || trimmed.startsWith(dangerous + ' ') || trimmed.startsWith(dangerous + ';')) {
      return 'dangerous'
    }
  }

  // 2. 检查只读前缀
  for (const prefix of READ_ONLY_PREFIXES) {
    if (trimmed === prefix || trimmed.startsWith(prefix + ' ') || trimmed.startsWith(prefix + ';')) {
      return 'read'
    }
  }

  // 3. 检查写入前缀
  for (const prefix of WRITE_PREFIXES) {
    if (trimmed === prefix || trimmed.startsWith(prefix + ' ') || trimmed.startsWith(prefix + ';')) {
      return 'write'
    }
  }

  // 4. 未知命令 → 需确认（保守策略）
  return 'write'
}

/**
 * 判断命令是否需要用户审批
 *
 * @param command 要执行的命令
 * @param mode 审批模式：'auto-approve' 全部通过，'ask-user' 高风险需确认
 * @returns 审批决策
 */
export function checkApproval(
  command: string,
  mode: 'auto-approve' | 'ask-user' = 'ask-user',
): { decision: ApprovalDecision; riskLevel: RiskLevel } {
  const riskLevel = classifyCommand(command)

  if (mode === 'auto-approve') {
    return { decision: 'auto-approved', riskLevel }
  }

  switch (riskLevel) {
    case 'read':
      return { decision: 'auto-approved', riskLevel }
    case 'write':
      return { decision: 'needs-approval', riskLevel }
    case 'dangerous':
      return { decision: 'needs-approval', riskLevel }
  }
}
