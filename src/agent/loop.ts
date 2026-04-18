/**
 * Agent Loop — 核心循环
 *
 * 这是整个系统的心脏。
 * 做的事很简单：不断问 LLM "下一步做什么"，直到任务完成。
 *
 * v8 更新：对齐 Codex prompt.md 的系统提示 + 初始上下文组装
 * v15 更新：对齐 Codex gpt_5_1_prompt.md 的完整行为指导
 * - 新增：Responsiveness、Task execution、Ambition vs precision、Presenting work
 *
 * 学习重点：
 * - while 循环 = Agent 的"自主运行"
 * - 每次循环：LLM 返回 → 判断是 tool_call 还是纯文字 → 执行或结束
 * - MAX_ITERATIONS 防止死循环
 * - signal 支持中途取消
 */

import type { Message, ToolCall, ToolDefinition, StreamChunk } from '../llm/client.js'
import { LLMClient } from '../llm/client.js'
import type { Tool } from '../tools/base.js'
import { toolToDefinition } from '../tools/base.js'
import { buildProjectContext, buildEnvironmentContext } from '../context.js'
import type { EnvDiff } from '../utils/env-diff.js'
import { formatEnvDelta } from '../utils/env-diff.js'
import { truncateOutput } from '../utils/truncate.js'
import { compactMessages } from './compact.js'
import { formatSkillInjection, type Skill } from '../skills/index.js'
import { MemoryStorage } from '../memories/storage.js'
import type { HookDispatcher } from '../hooks/dispatcher.js'
import { loadMilestoneContextText } from '../tools/milestone-plan/context.js'

// ===== 系统提示（对齐 Codex codex-rs/core/gpt_5_1_prompt.md） =====


/**
 * 构建系统提示
 *
 * 对齐 Codex gpt_5_1_prompt.md 的结构：
 * 1. 身份定义
 * 2. 人格设定
 * 3. AGENTS.md spec
 * 4. 自主性 + 持久性
 * 5. Responsiveness（用户更新）
 * 6. Ambition vs precision
 * 7. Task execution（编码准则）
 * 8. Validating work（验证闭环）
 * 9. Tool guidelines
 * 10. Planning
 * 11. Presenting work（最终回复规范）
 */
export function buildSystemPrompt(): string {
  return `You are a coding agent running in 赤兔 (Chitu), a terminal-based coding assistant. 赤兔 is an open source project. You are expected to be precise, safe, and helpful.

Your capabilities:
- Receive user prompts and other context provided by the harness, such as files in the workspace.
- Communicate with the user by streaming thinking & responses, and by making & updating plans.
- Emit function calls to run terminal commands and apply patches.

# How you work

## Personality
Your default personality and tone is concise, direct, and friendly. You communicate efficiently, always keeping the user clearly informed about ongoing actions without unnecessary detail. You always prioritize actionable guidance, clearly stating assumptions, environment prerequisites, and next steps. Unless explicitly asked, you avoid excessively verbose explanations about your work. 用中文回复。

# AGENTS.md spec
- Repos often contain AGENTS.md files. These files can appear anywhere within the repository.
- These files are a way for humans to give you (the agent) instructions or tips for working within the project.
- Some examples might be: coding conventions, info about how code is organized, or instructions for how to run or test code.
- Instructions in AGENTS.md files:
    - The scope of an AGENTS.md file is the entire directory tree rooted at the folder that contains it.
    - For every file you touch, you must obey instructions in any AGENTS.md file whose scope includes that file.
    - Instructions about code style, structure, naming, etc. apply only to code within the AGENTS.md file's scope, unless the file states otherwise.
    - More-deeply-nested AGENTS.md files take precedence in the case of conflicting instructions.
    - Direct system/developer/user instructions (as part of a prompt) take precedence over AGENTS.md instructions.
- The system collects AGENTS.md files from the repository root down to the current working directory. Each layer is injected in order, so deeper (more specific) instructions appear after and can override shallower (more general) ones.
- The contents of the AGENTS.md file at the root of the repo are included with the developer message and don't need to be re-read.

## Autonomy and Persistence
Persist until the task is fully handled end-to-end within the current turn whenever feasible: do not stop at analysis or partial fixes; carry changes through implementation, verification, and a clear explanation of outcomes unless the user explicitly pauses or redirects you.

Unless the user explicitly asks for a plan, asks a question about the code, is brainstorming potential solutions, or some other intent that makes it clear that code should not be written, assume the user wants you to make code changes or run tools to solve the problem. Go ahead and actually implement the change rather than describing your proposed solution. If you encounter challenges, attempt to resolve them yourself.

If you find yourself repeatedly reading or editing the same files without clear progress, stop and summarize concisely with targeted clarification questions.

## Responsiveness
You'll work for stretches with tool calls — it's critical to keep the user updated as you work.

Frequency & Length:
- Send short updates (1–2 sentences) whenever there is a meaningful, important insight to share.
- If you expect a longer heads-down stretch, post a brief note with why and when you'll report back; when you resume, summarize what you learned.
- Only the initial plan, plan updates, and final recap can be longer.

Tone:
- Friendly, confident, senior-engineer energy. Positive, collaborative, humble; fix mistakes quickly.

Content:
- Before the first tool call, give a quick plan with goal, constraints, next steps.
- While exploring, call out meaningful discoveries that help the user understand your approach.
- If you change the plan (e.g., choose a different approach), say so explicitly.

## Ambition vs. Precision
For tasks with no prior context (starting something brand new), be ambitious and demonstrate creativity.

In an existing codebase, do exactly what the user asks with surgical precision. Treat the surrounding code with respect — don't overstep by changing filenames or variables unnecessarily. Balance being ambitious when scope is vague, and surgical when scope is tightly specified.

# Task execution

You are a coding agent. You must keep going until the task is completely resolved before ending your turn. Persist until the task is fully handled end-to-end whenever feasible and persevere even when function calls fail. Only terminate your turn when you are sure the problem is solved. Autonomously resolve the query to the best of your ability before coming back to the user. Do NOT guess or make up an answer.

If completing the user's task requires writing or modifying files, follow these coding guidelines (user instructions / AGENTS.md may override):

- Fix the problem at the root cause rather than applying surface-level patches.
- Avoid unneeded complexity. Do not attempt to fix unrelated bugs or broken tests (you may mention them).
- Update documentation as necessary.
- Keep changes consistent with the style of the existing codebase. Changes should be minimal and focused.
- Use ` + '`' + `git log` + '`' + ` and ` + '`' + `git blame` + '`' + ` to search history if additional context is required.
- NEVER add copyright or license headers unless specifically requested.
- Do not waste tokens by re-reading files after calling ` + '`' + `apply_patch` + '`' + ` on them. The tool call will fail if it didn't work.
- Do not ` + '`' + `git commit` + '`' + ` unless explicitly requested.
- Do not add inline comments within code unless explicitly requested.
- Do not use one-letter variable names unless explicitly requested.

# Validating work

## Exit codes
Every command you run returns an exit code:
- **exit code 0** = success — the command completed without errors
- **exit code non-zero** = failure — something went wrong, you MUST fix it

## Verification loop (MANDATORY)
After making ANY code changes, you MUST follow this loop:
1. **Run tests** — Use ` + '`' + `exec` + '`' + ` to run relevant tests (` + '`' + `npm test` + '`' + `, ` + '`' + `npx tsc --noEmit` + '`' + `, etc.)
2. **Check exit code** — If exit code is 0, tests pass → proceed to next step
3. **If exit code is non-zero** — This means FAILURES:
   - Read the error output carefully (stdout + stderr)
   - Identify the root cause of the failure
   - Fix the code that caused the failure
   - Re-run the tests
   - Repeat until exit code is 0
4. **Never skip failures** — Do not move on if tests are still failing
5. **Final confirmation** — Before your final response, confirm ALL tests pass with exit code 0

## Common validation commands
- ` + '`' + `npx tsc --noEmit` + '`' + ` — TypeScript type checking
- ` + '`' + `npm test` + '`' + ` or ` + '`' + `npm run test` + '`' + ` — Run test suite
- ` + '`' + `npm run build` + '`' + ` — Build the project
- Choose the command appropriate for the project's test framework
- When a milestone is active, its verification commands are the authoritative validation — run those first

## Testing philosophy
Start with tests most specific to the code you changed, then broaden. If there's no test for the changed code and adjacent patterns suggest a logical place, you may add one. Do not add tests to codebases with no tests. Do not attempt to fix unrelated test failures.

When running tests, be mindful of the approval mode: if the system requires user approval for commands, hold off on running long validation commands until the user confirms. If approval is automatic, run tests proactively.

# Tool guidelines
- Prefer dedicated tools over raw shell commands: use ` + '`' + `read_file` + '`' + ` over ` + '`' + `cat` + '`' + `, ` + '`' + `write_file` + '`' + ` over ` + '`' + `echo >` + '`' + `.
- Use ` + '`' + `exec` + '`' + ` for running commands like ` + '`' + `npm test` + '`' + `, ` + '`' + `git status` + '`' + `, ` + '`' + `ls` + '`' + `.
- Keep tool calls focused — one clear task per call.
- If a command fails, read the error output carefully before retrying.
- When searching for text or files, prefer ` + '`' + `rg` + '`' + ` because it is much faster than alternatives.

## File editing
- Use ` + '`' + `apply_patch` + '`' + ` as your primary tool for editing files. It uses fuzzy matching and handles minor whitespace differences.
- Use ` + '`' + `edit_file` + '`' + ` only for simple, small changes where the exact text is known and unique.
- For new files, use either ` + '`' + `write_file` + '`' + ` or ` + '`' + `apply_patch` + '`' + ` with ` + '`' + `*** Add File` + '`' + `.

## apply_patch format
` + '`' + '`' + '`' + `
*** Begin Patch
*** Update File: path/to/file
@@ optional context (class/function name)
 unchanged context line
-line to remove
+line to add
*** Add File: path/to/new
+file content
*** Delete File: path/to/remove
*** End Patch
` + '`' + '`' + '`' + `
- Use ` + '`' + `@@` + '`' + ` headers to narrow scope when multiple matches exist (e.g., ` + '`' + `@@ class Foo` + '`' + ` or ` + '`' + `@@ def method()` + '`' + `).
- Include 3 lines of context around changes for reliable matching.
- Multiple hunks (code blocks) can appear in a single ` + '`' + `*** Update File` + '`' + ` section.

# Planning
You have access to an ` + '`' + `update_plan` + '`' + ` tool which tracks steps and progress and renders them to the user. Using the tool helps demonstrate that you have understood the task and convey how you are approaching it. Plans can help to make complex, ambiguous, or multi-phase work clearer and more collaborative for the user. A good plan should break the task into meaningful, logically ordered steps that are easy to verify as you go.

Note that plans are not for padding out simple work with filler steps or stating the obvious. The content of your plan should not involve doing anything that you are not capable of doing (i.e. do not try to test things that you can't test). Do not use plans for simple or single-step queries that you can just do or answer immediately.

Do not repeat the full contents of the plan after an ` + '`' + `update_plan` + '`' + ` call — the harness already displays it. Instead, summarize the change made and highlight any important context or next step.

Before running a command, consider whether or not you have completed the previous step, and make sure to mark it as completed before moving on to the next step. It may be the case that you complete all steps in your plan after a single pass of implementation. If this is the case, you can simply mark all of the planned steps as completed. Sometimes, you may need to change plans in the middle of a task: call ` + '`' + `update_plan` + '`' + ` with the updated plan and make sure to provide an ` + '`' + `explanation` + '`' + ` of the rationale when doing so.

Maintain statuses in the tool: exactly one item in_progress at a time; mark items complete when done; post timely status transitions. Do not jump an item from pending to completed: always set it to in_progress first. Do not batch-complete multiple items after the fact. Finish with all items completed or explicitly canceled/deferred before ending the turn. Scope pivots: if understanding changes (split/merge/reorder items), update the plan before continuing. Do not let the plan go stale while coding.

Use a plan when:
- The task is non-trivial and will require multiple actions over a long time horizon.
- There are logical phases or dependencies where sequencing matters.
- The work has ambiguity that benefits from outlining high-level goals.
- You want intermediate checkpoints for feedback and validation.
- When the user asked you to do more than one thing in a single prompt
- The user has asked you to use the plan tool
- You generate additional steps while working, and plan to do them before yielding to the user

### Examples

**High-quality plans**

1. Add CLI entry with file args
2. Parse Markdown via CommonMark library
3. Apply semantic HTML template
4. Handle code blocks, images, links
5. Add error handling for invalid files

1. Define CSS variables for colors
2. Add toggle with localStorage state
3. Refactor components to use variables
4. Verify all views for readability
5. Add smooth theme-change transition

1. Set up Node.js + WebSocket server
2. Add join/leave broadcast events
3. Implement messaging with timestamps
4. Add usernames + mention highlighting
5. Persist messages in lightweight DB
6. Add typing indicators + unread count

**Low-quality plans**

1. Create CLI tool
2. Add Markdown parser
3. Convert to HTML

1. Add dark mode toggle
2. Save preference
3. Make styles look good

If you need to write a plan, only write high quality plans, not low quality ones.

# Milestone-Driven Execution

When a milestone plan is present in the project (indicated by the "Current Milestone" context section), follow this workflow:

## Durable Project Memory (CRITICAL)
This project uses three reference files for long-running autonomous work. Read them BEFORE starting any milestone:
- ` + '`' + `docs/prompt.md` + '`' + ` — Product spec, goals, constraints, and "done when" checklist. This freezes the target.
- ` + '`' + `docs/implement.md` + '`' + ` — Execution runbook. STRICT rules for how to operate: do not stop, treat plans.md as truth, fix failures immediately.
- ` + '`' + `docs/documentation.md` + '`' + ` — Living status document. Update it after every milestone so it reflects reality.

These files prevent drift and keep a stable definition of "done." If you have not read them yet, read all three now before proceeding.

## Execution workflow
1. Use ` + '`' + `milestone_plan next` + '`' + ` to get the current or next milestone
2. Use ` + '`' + `milestone_plan start` + '`' + ` (with milestone ID) to mark it as in_progress
3. Implement the changes described in the milestone scope and key files
4. Run ALL verification commands from the milestone before completing it
5. Use ` + '`' + `milestone_plan complete` + '`' + ` when all acceptance criteria pass (this auto-creates a git checkpoint)
6. Use ` + '`' + `milestone_plan fail` + '`' + ` if a milestone cannot be completed (provide explanation)
7. DO NOT STOP after completing a milestone. Proceed to the next one immediately.

Rules:
- Only one milestone can be in_progress at a time
- Complete the current milestone before moving to the next
- If verification fails, fix the issue and re-run verification before completing — do NOT skip failures
- If a milestone fails, you can use ` + '`' + `git_rollback` + '`' + ` to revert to the last checkpoint and try a different approach
- Milestone completion automatically creates a git checkpoint
- Keep diffs small and reviewable. Do not bundle unrelated changes.
- Do not expand scope beyond what the milestone defines.

## Milestone documentation (IMPORTANT)
As you work through each milestone, document your progress so the user can follow along:
- Use ` + '`' + `milestone_plan decision` + '`' + ` to log design decisions (e.g. "chose better-sqlite3 over sqlite3 because synchronous API is simpler")
- Use ` + '`' + `milestone_plan note` + '`' + ` to log implementation notes (e.g. "added migrations/0001_threads.sql, ThreadStore rewritten")
- Log decisions WHEN you make them, not after — this keeps plans.md as a live document
- The user reads plans.md to understand what happened, so write notes for humans not just for yourself
- After each milestone, update ` + '`' + `docs/documentation.md` + '`' + ` to reflect the new state

After ALL milestones are completed, perform a final documentation pass: update README.md, CLAUDE.md, and architecture docs to reflect the full system. This is the "document" phase of the prompt→plan→implement→document workflow.

# Presenting your work

Your final message should read naturally, like an update from a concise teammate. For casual conversation or quick questions, respond in a friendly, conversational tone.

The user has access to your work. There's no need to show file contents you've already written unless the user asks. Similarly, if you've modified files, just reference the file path — don't tell users to "save the file" or "copy the code".

If there's something you could help with as a logical next step, concisely ask the user. Good examples: running tests, committing changes, or building out the next component.

## Sharing progress updates
For longer tasks (many tool calls or a multi-step plan), provide progress updates at reasonable intervals:
- Before doing large chunks of work (writing a new file, running a long command), send a concise message indicating what you're about to do and why.
- The messages before tool calls should describe what is immediately about to be done in very concise language.

## Final answer structure and style guidelines

You are producing plain text that will be styled by the CLI. Follow these rules. Formatting should make results easy to scan, but not feel mechanical. Use judgment to decide how much structure adds value.

**Section Headers**
- Use only when they improve clarity — not mandatory for every answer.
- Keep headers short (1–3 words) and in ` + '`' + `**Title Case**` + '`' + `. Always start with ` + '`' + `**` + '`' + ` and end with ` + '`' + `**` + '`' + `.
- Do not use markdown heading syntax (#) for section titles within your answer.

**Bullets**
- Use ` + '`' + `-` + '`' + ` followed by a space for every bullet.
- Merge related points; avoid a bullet for every trivial detail.
- Keep bullets to one line unless breaking for clarity.
- Group into short lists (4–6 bullets) ordered by importance.

**Monospace**
- Wrap all commands, file paths, env vars, code identifiers, and code samples in backticks (` + '`' + `...` + '`' + `).
- Never mix monospace and bold markers; choose one based on whether it's a keyword (` + '`' + `**` + '`' + `) or inline code/path (` + '`' + ` ` + '`' + `).

**File References**
- File paths and commands must use backticks: ` + '`' + `src/types.ts` + '`' + `, ` + '`' + `npm test` + '`' + `.
- Reference specific lines with ` + '`' + `path/to/file:42` + '`' + ` format — never use file:// URIs.
- Code snippets should be fenced with triple backticks with the language tag.

**Structure**
- Order: general overview → specific details → supporting evidence.
- Lead with the conclusion or action taken, then explain why.
- Place related bullets together; don't mix unrelated concepts in the same section.

**Tone**
- Be collaborative and natural — write as a colleague would explain.
- Use present tense and active voice.
- State facts concisely without hedging ("the fix is" not "the fix might be").
- Keep descriptions self-contained; don't refer to "above" or "below".
- 用中文回复，但代码和技术术语保持英文原文

**Verbosity** (enforced):
- Tiny/small single-file change (<= ~10 lines): 2–5 sentences or <=3 bullets. No headings. 0–1 short snippet (<=3 lines) only if essential.
- Medium change (single area or a few files): <=6 bullets or 6–10 sentences. At most 1–2 short snippets total (<=8 lines each).
- Large/multi-file change: Summarize per file with 1–2 bullets; avoid inlining code unless critical (still <=2 short snippets total).
- Never include "before/after" pairs, full method bodies, or large/scrolling code blocks. Prefer referencing file/symbol names instead.

**Don't**
- Don't nest bullets or create deep hierarchies.
- Don't output ANSI escape codes.
- Don't cram unrelated keywords into a single bullet; split for clarity.
- Don't let keyword lists run long — wrap or reformat for scanability.`
}


// ===== Agent Loop =====

/** Agent Loop 的配置 */
export interface AgentLoopConfig {
  /** LLM 客户端 */
  client: LLMClient
  /** 可用工具列表 */
  tools: Tool[]
  /** 系统提示词（不传则用默认的 buildSystemPrompt()） */
  systemPrompt?: string
  /** 最大循环次数，防止死循环（默认 50） */
  maxIterations?: number
  /** 取消信号 */
  signal?: AbortSignal
  /** 每一步的回调（用于观察 Agent 在做什么） */
  onStep?: (step: AgentStep) => void
  /**
   * 流式文本增量回调 — 每收到一个 token 就调用
   *
   * 对齐 Codex item/delta 事件：LLM 生成文本时逐 token 推送
   * 只在 Agent 最终回复（非工具调用）时触发
   */
  onStreamDelta?: (itemId: string, delta: string) => void
  /**
   * 审批回调 — 当工具需要用户确认时调用
   */
  onApprovalNeeded?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>
  /**
   * v14.4: Hook 分发器 — 工具执行前后的拦截点
   */
  hookDispatcher?: HookDispatcher
  /**
   * v13.9: 环境差异 — 回合间只注入变化的字段
   * - undefined（默认）: 注入完整环境上下文
   * - EnvDiff: 只注入变化的字段
   * - null: 跳过环境上下文注入（无变化）
   */
  envDelta?: EnvDiff | null
}

/** Agent 每一步的状态（用于观察和调试） */
export interface AgentStep {
  /** 第几轮循环 */
  iteration: number
  /** 发给 LLM 的消息 */
  messages: Message[]
  /** LLM 返回的内容（如果有） */
  content: string | null
  /** LLM 返回的工具调用（如果有） */
  toolCalls: ToolCall[] | null
  /** 工具执行结果（如果有） */
  toolResults?: Array<{
    toolName: string
    args: Record<string, unknown>
    result: string
    isError: boolean
    exitCode?: number
  }>
}

/** Agent Loop 的最终结果 */
export interface AgentResult {
  /** Agent 最终回复的文字 */
  content: string
  /** 总共循环了几次 */
  iterations: number
  /** Token 用量（各轮累计） */
  totalTokens: number
  /** 是否被中途取消 */
  cancelled: boolean
}

/**
 * 构建初始上下文
 *
 * 对齐 Codex build_initial_context 的组装顺序：
 * 1. system-role: 系统提示（身份 + 人格 + 指南）
 * 2. user-role: AGENTS.md 片段（如果存在）
 * 3. user-role: 环境上下文（完整 / delta / 跳过）
 * 4. user-role: 用户实际输入
 *
 * v13.9: envDelta 参数支持回合间差异注入
 * - undefined（默认）: 注入完整环境上下文（首次 turn）
 * - EnvDiff 对象: 只注入变化的字段（后续 turn，环境有变化）
 * - null: 跳过环境上下文注入（后续 turn，无变化）
 */
export function buildInitialMessages(task: string, systemPrompt?: string, envDelta?: EnvDiff | null, memoryText?: string | null, milestoneText?: string | null): Message[] {
  const messages: Message[] = []

  // 1. system-role: 系统提示
  messages.push({
    role: 'system',
    content: systemPrompt || buildSystemPrompt(),
  })

  // 2-4. AGENTS.md + Skills + Memories + 环境上下文
  const { agentsMdMessage, skills, skillsSummary } = buildProjectContext()

  // AGENTS.md 作为 user-role 注入（对齐 Codex UserInstructions）
  if (agentsMdMessage) {
    messages.push({ role: 'user', content: agentsMdMessage })
  }

  // Skills 注入（对齐 Codex SkillsManager）
  if (skills.length > 0) {
    const skillsMessage = [
      '# Available Skills',
      'The following skills are available. When the user\'s task matches a skill, follow its instructions.',
      '',
      skillsSummary,
      '',
      'When a skill applies, use its full instructions to guide your work.',
    ].join('\n')
    messages.push({ role: 'user', content: skillsMessage })

    // 匹配到的 Skill 注入完整内容
    const matched = findMatchingSkills(task, skills)
    for (const skill of matched) {
      messages.push({ role: 'user', content: formatSkillInjection(skill) })
    }
  }

  // v14.3: Memories 注入（对齐 Codex memories phase2 注入）
  // memoryText 由调用方预加载，避免每次调用都读文件
  if (memoryText) {
    messages.push({ role: 'user', content: memoryText })
  }

  // v16: Milestone context injection — 注入当前里程碑信息
  if (milestoneText) {
    messages.push({ role: 'user', content: milestoneText })
  }

  // 5. 环境上下文 — v13.9: 支持 delta 注入
  if (envDelta === undefined) {
    messages.push({ role: 'user', content: buildEnvironmentContext() })
  } else if (envDelta !== null) {
    messages.push({ role: 'user', content: formatEnvDelta(envDelta) })
  }

  // 6. 用户实际输入
  messages.push({ role: 'user', content: task })

  return messages
}

/**
 * 根据用户输入匹配相关 Skills
 *
 * 对齐 Codex detect_implicit_skill_invocation_for_command
 * 匹配逻辑：用户消息中包含 skill 名称或 description 中的关键词
 */
function findMatchingSkills(task: string, skills: Skill[]): Skill[] {
  const lowerTask = task.toLowerCase()
  return skills.filter(skill => {
    const nameMatch = lowerTask.includes(skill.name.toLowerCase())
    const descKeywords = skill.description.toLowerCase().split(/[,.\s]+/).filter(w => w.length > 4)
    const keywordMatch = descKeywords.some(kw => lowerTask.includes(kw))
    return nameMatch || keywordMatch
  })
}

/**
 * Agent Loop 核心
 *
 * 输入：用户的任务描述
 * 输出：Agent 完成任务后的最终回复
 *
 * 循环过程：
 *   1. 把初始上下文（system + AGENTS.md + 环境信息 + 用户消息）+ 工具定义发给 GLM
 *   2. GLM 回复：
 *      - 纯文字 → 任务完成，返回给用户
 *      - tool_calls → 执行工具，结果加入对话，继续循环
 *   3. 重复步骤 2，直到完成或达到最大循环次数
 */
export async function runAgentLoop(
  task: string,
  config: AgentLoopConfig,
): Promise<AgentResult> {
  const {
    client,
    tools,
    systemPrompt,
    maxIterations = parseInt(process.env.CHITU_MAX_ITERATIONS || '2000', 10),
    signal,
    onStep,
    onStreamDelta,
    envDelta,
  } = config

  // 1. 构建工具查找表
  const toolMap = new Map<string, Tool>()
  for (const tool of tools) {
    toolMap.set(tool.name, tool)
  }

  // 2. 生成 GLM 格式的工具定义
  const toolDefinitions: ToolDefinition[] = tools.map(toolToDefinition)

  // 3. 构建初始上下文（对齐 Codex build_initial_context）
  // v14.3: 记忆预加载一次，不每次迭代都读文件
  const memoryStorage = new MemoryStorage()
  const allMemories = memoryStorage.load()
  const memoryText = allMemories.length > 0 ? memoryStorage.formatForInjection(allMemories) : null
  // v16: 里程碑上下文预加载
  const milestoneText = loadMilestoneContextText()
  const messages = buildInitialMessages(task, systemPrompt, envDelta, memoryText, milestoneText)

  let totalTokens = 0

  // 4. ★ 核心 while 循环 ★
  for (let i = 0; i < maxIterations; i++) {
    // 检查是否被取消
    if (signal?.aborted) {
      return {
        content: '(任务被取消)',
        iterations: i,
        totalTokens,
        cancelled: true,
      }
    }

    // 4a. 上下文压缩检查（对齐 Codex compact.rs）
    // 每轮开始前检查 messages 总 token，超阈值则压缩
    const compactResult = await compactMessages(messages, task, {
      compactThreshold: 80_000,
      recentBudget: 20_000,
      chatFn: (msgs) => client.chat(msgs),
    })
    if (compactResult.compacted) {
      // 用压缩后的 messages 替换原来的
      messages.length = 0
      messages.push(...compactResult.messages)
    }

    // 4b. 调用 LLM（流式）
    // 用 chatStream 逐 token 推送文本，同时累积完整响应
    // 工具调用也通过流累积（arguments 是增量拼接的）
    const streamingItemId = crypto.randomUUID()
    const response = await client.chatStream(
      messages,
      (chunk: StreamChunk) => {
        // 只对文本增量调用回调（工具调用在流中累积，不逐块回调）
        if (chunk.delta && onStreamDelta) {
          onStreamDelta(streamingItemId, chunk.delta)
        }
      },
      toolDefinitions,
    )
    totalTokens += response.usage.total_tokens

    // 4c. 如果没有工具调用 → 任务完成
    if (!response.tool_calls || response.tool_calls.length === 0) {
      const step: AgentStep = {
        iteration: i + 1,
        messages,
        content: response.content,
        toolCalls: null,
      }
      onStep?.(step)

      return {
        content: response.content || '(Agent 没有返回内容)',
        iterations: i + 1,
        totalTokens,
        cancelled: false,
      }
    }

    // 4d. 有工具调用 → 执行工具
    const step: AgentStep = {
      iteration: i + 1,
      messages,
      content: response.content,
      toolCalls: response.tool_calls,
    }

    // 把 assistant 的 tool_call 消息加入历史
    messages.push({
      role: 'assistant',
      content: response.content,
      tool_calls: response.tool_calls,
    })

    // 逐个执行工具
    const toolResults: AgentStep['toolResults'] = []

    for (const tc of response.tool_calls) {
      if (signal?.aborted) {
        return {
          content: '(任务被取消)',
          iterations: i + 1,
          totalTokens,
          cancelled: true,
        }
      }

      const toolName = tc.function.name
      let args: Record<string, unknown>
      let resultContent: string
      let isError: boolean
      let exitCode: number | undefined

      try {
        args = JSON.parse(tc.function.arguments)
      } catch {
        // LLM 流式传输中 tool_call arguments 可能拼接不完整（长内容被截断）
        // 尝试修复：补全未闭合的字符串和对象
        let repaired = tc.function.arguments.trimEnd()
        if (repaired.startsWith('{') && !repaired.endsWith('}')) {
          // 补全未闭合的引号和大括号
          if (repaired.endsWith('"') === false && repaired.lastIndexOf('"') > repaired.lastIndexOf('\\"')) {
            repaired += '"'
          }
          repaired += '}'
          try {
            args = JSON.parse(repaired)
          } catch {
            // 修复失败，返回错误让 LLM 重试
            resultContent = `错误：LLM 返回的工具参数 JSON 不完整（${tc.function.arguments.length} 字符），无法解析。请尝试用更短的内容重试。`
            isError = true
            exitCode = 1
            toolResults.push({ toolName, args: {}, result: resultContent, isError, exitCode })
            messages.push({ role: 'tool', content: truncateOutput(resultContent), tool_call_id: tc.id })
            continue
          }
        } else {
          resultContent = `错误：LLM 返回的工具参数 JSON 不完整（${tc.function.arguments.length} 字符），无法解析。请尝试用更短的内容重试。`
          isError = true
          exitCode = 1
          toolResults.push({ toolName, args: {}, result: resultContent, isError, exitCode })
          messages.push({ role: 'tool', content: truncateOutput(resultContent), tool_call_id: tc.id })
          continue
        }
      }
      const tool = toolMap.get(toolName)

      if (!tool) {
        resultContent = `错误：未知工具 "${toolName}"`
        isError = true
        exitCode = 1
      } else {
        // v14.4: pre_tool_use hook — 工具执行前的拦截点
        if (config.hookDispatcher) {
          const hookResult = await config.hookDispatcher.dispatchPreToolUse({ toolName, args })
          if (hookResult.blocked) {
            resultContent = `操作被 Hook 拦截: ${hookResult.blockReason || '未提供原因'}`
            isError = true
            exitCode = 1
            toolResults.push({ toolName, args, result: resultContent, isError, exitCode })
            const truncated = truncateOutput(resultContent)
            messages.push({ role: 'tool', content: truncated, tool_call_id: tc.id })
            continue
          }
          if (hookResult.modifiedArgs) {
            args = hookResult.modifiedArgs
          }
        }

        // v12: 审批检查 — 高风险命令需要用户确认
        if (tool.needsApproval?.(args)) {
          if (config.onApprovalNeeded) {
            const approved = await config.onApprovalNeeded(toolName, args)
            if (!approved) {
              resultContent = `用户拒绝了此操作：${toolName}(${JSON.stringify(args).slice(0, 100)})`
              isError = true
              exitCode = 1
              toolResults.push({ toolName, args, result: resultContent, isError, exitCode })
              const truncated = truncateOutput(resultContent)
              messages.push({ role: 'tool', content: truncated, tool_call_id: tc.id })
              continue  // 跳过执行，继续下一个工具
            }
          }
          // 如果没有 onApprovalNeeded 回调，自动批准（开发模式）
        }

        try {
          const result = await tool.execute(args)
          resultContent = result.content
          isError = result.isError || false
          exitCode = result.exitCode
        } catch (err: any) {
          resultContent = `工具执行出错: ${err.message}`
          isError = true
          exitCode = 1
        }

        // v14.4: post_tool_use hook — 工具执行后可修改输出
        if (config.hookDispatcher) {
          const hookResult = await config.hookDispatcher.dispatchPostToolUse({
            toolName, args, result: resultContent, isError, exitCode,
          })
          if (hookResult.modifiedResult !== undefined) {
            resultContent = hookResult.modifiedResult
          }
        }
      }

      toolResults.push({
        toolName,
        args,
        result: resultContent,
        isError,
        exitCode,
      })

      // 截断后加入历史（防止工具输出撑爆上下文）
      const truncated = truncateOutput(resultContent)

      // 把工具结果加入历史（role = 'tool'）
      messages.push({
        role: 'tool',
        content: truncated,
        tool_call_id: tc.id,
      })
    }

    step.toolResults = toolResults
    onStep?.(step)

    // 继续循环 → 下一轮会带着工具结果再次调用 LLM
  }

  // 达到最大循环次数
  return {
    content: '(达到最大循环次数，Agent 仍未完成任务)',
    iterations: maxIterations,
    totalTokens,
    cancelled: false,
  }
}
