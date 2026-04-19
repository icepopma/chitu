/**
 * Review 模式 — 专用系统提示词
 *
 * Agent 只审查代码，不修改文件。
 * 参考 Codex codex-rs/core/review_prompt.md 的审查行为指导。
 *
 * 学习重点：
 * - 通过 system prompt 约束 Agent 行为（只读 vs 读写）
 * - Review 模式下只允许只读工具，禁止写入操作
 * - 输出结构化审查结果（问题列表 + 建议修改）
 */

/**
 * Review 模式下允许的工具（只读）
 */
export const REVIEW_ALLOWED_TOOLS = new Set([
	'exec',           // 用于 cat、ls、git diff 等只读命令
	'read_file',      // 读取文件内容
	'git_status',     // 查看 git 状态
	'git_diff',       // 查看 diff
	'git_blame',      // 查看代码归属
	'git_log',        // 查看提交历史
	'update_plan',    // 允许更新计划（只读操作）
])

/**
 * 构建审查模式的系统提示词
 *
 * 对齐 Codex review_prompt.md：
 * - Agent 只分析不修改
 * - 输出结构化审查结果
 * - 问题按严重程度分级
 */
export function buildReviewSystemPrompt(): string {
	return `You are a code reviewer running in 赤兔 (Chitu), operating in **Review Mode**. You analyze code but NEVER modify any files.

# CRITICAL CONSTRAINTS (Review Mode)
- You are in READ-ONLY mode. You MUST NOT modify, create, or delete any files.
- You MUST NOT use tools that write files: write_file, edit_file, apply_patch, exec (with write/dangerous commands).
- You MAY use read-only tools: read_file, exec (read-only commands like cat, ls, git diff, git log, rg), git_status, git_diff, git_blame, git_log.
- If you need to run a command, only use read-only commands (no mkdir, no npm install, no file writes).

# Your Task
Analyze the code or changes the user asks about and provide a structured review.

# Review Output Format
Structure your review as follows:

## 摘要
Brief summary of what was reviewed and overall assessment.

## 问题列表
List each issue found, formatted as:
- **[严重程度]** 文件:行号 — 问题描述
  - 严重程度: 🔴 Critical | 🟡 Warning | 🔵 Suggestion
  - Include the relevant code snippet if helpful

## 建议修改
For each issue, suggest a concrete fix. Use code blocks to show the before/after.

## 总体评价
Overall quality assessment and recommendations.

# Review Guidelines
- Focus on correctness, security, performance, and maintainability
- Check for common issues: null/undefined handling, resource leaks, error handling gaps
- Consider edge cases and boundary conditions
- Evaluate code style consistency with the surrounding codebase
- Use 用中文回复，但代码和技术术语保持英文原文
- Be constructive and specific — every issue should have a suggested fix
- Prioritize real issues over style preferences`
}

/**
 * 判断工具在 review 模式下是否被允许
 */
export function isToolAllowedInReview(toolName: string, args?: Record<string, unknown>): boolean {
	if (REVIEW_ALLOWED_TOOLS.has(toolName)) {
		// exec 工具需要额外检查命令是否只读
		if (toolName === 'exec' && args?.command) {
			return isReadOnlyCommand(args.command as string)
		}
		return true
	}
	return false
}

/**
 * 判断 shell 命令是否只读
 */
function isReadOnlyCommand(command: string): boolean {
	const readOnlyPatterns = [
		/^(cat|head|tail|less|more|wc|sort|uniq|grep|rg|ag|ack|find|ls|tree|file|stat)\b/,
		/^(git)\s+(status|diff|log|blame|show|branch|tag|remote|stash list)\b/,
		/^(echo|printf)\b/,  // echo for displaying info
		/^(npx\s+)?tsc\s+--noEmit/,
		/^(npm\s+)?(list|ls|view|info|outdated)\b/,
		/^(node\s+-e|node\s+--eval)\b/,
		/^(which|type|command\s+-v)\b/,
		/^(env|printenv|echo\s+\$)\b/,
	]

	// 去除前导空白和管道
	const trimmed = command.trim()

	// 如果有管道，检查第一段命令
	const firstSegment = trimmed.split('|')[0].trim()

	return readOnlyPatterns.some(pattern => pattern.test(firstSegment))
}
