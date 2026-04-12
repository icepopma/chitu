/**
 * Agent Loop — 核心循环
 *
 * 这是整个系统的心脏。
 * 做的事很简单：不断问 LLM "下一步做什么"，直到任务完成。
 *
 * v8 更新：对齐 Codex prompt.md 的系统提示 + 初始上下文组装
 * - system-role: 身份 + 人格 + AGENTS.md spec + 自主性 + 验证 + 工具指南
 * - user-role: AGENTS.md 片段（<INSTRUCTIONS> 包裹）
 * - user-role: 环境上下文（cwd、shell、日期）
 * - user-role: 用户实际输入
 *
 * 学习重点：
 * - while 循环 = Agent 的"自主运行"
 * - 每次循环：LLM 返回 → 判断是 tool_call 还是纯文字 → 执行或结束
 * - MAX_ITERATIONS 防止死循环
 * - signal 支持中途取消
 */

import type { Message, ToolCall, ToolDefinition } from '../llm/client.js'
import { LLMClient } from '../llm/client.js'
import type { Tool } from '../tools/base.js'
import { toolToDefinition } from '../tools/base.js'
import { buildProjectContext } from '../context.js'
import { truncateOutput } from '../utils/truncate.js'
import { compactMessages } from './compact.js'
import { formatSkillInjection, type Skill } from '../skills/index.js'

// ===== 系统提示（对齐 Codex codex-rs/core/prompt.md） =====

/**
 * 构建系统提示
 *
 * 对齐 Codex prompt.md 的结构：
 * 1. 身份定义
 * 2. 人格设定
 * 3. AGENTS.md spec
 * 4. 自主性指令
 * 5. 验证指令
 * 6. 工具使用指南
 */
export function buildSystemPrompt(): string {
  return `You are a coding agent running in 赤兔 (Chitu), a terminal-based coding assistant. 赤兔 is an open source project. You are expected to be precise, safe, and helpful.

Your capabilities:
- Receive user prompts and other context provided by the harness, such as files in the workspace.
- Communicate with the user by streaming thinking & responses.
- Emit function calls to run terminal commands, read/write/edit files.

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
- The contents of the AGENTS.md file at the root of the repo are included with the developer message and don't need to be re-read.

# Autonomous behavior
You are autonomous and proactive. Once a user gives you direction:
- Actively gather context, plan, implement, test, and iterate without waiting for additional prompts.
- Persist until the task is fully resolved end-to-end. Do not stop at analysis or partial fixes.
- Prefer action: default to implementation under reasonable assumptions. Do not end your turn with questions unless genuinely blocked.
- If you find yourself repeatedly reading or editing the same files without clear progress, stop and summarize concisely with targeted clarification questions.

# Validating work

## Exit codes
Every command you run returns an exit code:
- **exit code 0** = success — the command completed without errors
- **exit code non-zero** = failure — something went wrong, you MUST fix it

## Verification loop (MANDATORY)
After making ANY code changes, you MUST follow this loop:
1. **Run tests** — Use \`exec\` to run relevant tests (\`npm test\`, \`npx tsc --noEmit\`, etc.)
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
- \`npx tsc --noEmit\` — TypeScript type checking
- \`npm test\` or \`npm run test\` — Run test suite
- \`npm run build\` — Build the project
- Choose the command appropriate for the project's test framework

# Tool guidelines
- Prefer dedicated tools over raw shell commands: use \`read_file\` over \`cat\`, \`write_file\` over \`echo >\`.
- Use \`exec\` for running commands like \`npm test\`, \`git status\`, \`ls\`.
- Keep tool calls focused — one clear task per call.
- If a command fails, read the error output carefully before retrying.

## File editing
- Use \`apply_patch\` as your primary tool for editing files. It uses fuzzy matching and handles minor whitespace differences.
- Use \`edit_file\` only for simple, small changes where the exact text is known and unique.
- For new files, use either \`write_file\` or \`apply_patch\` with \`*** Add File\`.

## apply_patch format
\`\`\`
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
\`\`\`
- Use \`@@\` headers to narrow scope when multiple matches exist (e.g., \`@@ class Foo\` or \`@@ def method()\`).
- Include 3 lines of context around changes for reliable matching.
- Multiple hunks (code blocks) can appear in a single \`*** Update File\` section.

# Planning
You have access to an \`update_plan\` tool which tracks steps and progress and renders them to the user. Using the tool helps demonstrate that you have understood the task and convey how you are approaching it. Plans can help to make complex, ambiguous, or multi-phase work clearer and more collaborative for the user. A good plan should break the task into meaningful, logically ordered steps that are easy to verify as you go.

Note that plans are not for padding out simple work with filler steps or stating the obvious. The content of your plan should not involve doing anything that you are not capable of doing (i.e. do not try to test things that you can't test). Do not use plans for simple or single-step queries that you can just do or answer immediately.

Do not repeat the full contents of the plan after an \`update_plan\` call — the harness already displays it. Instead, summarize the change made and highlight any important context or next step.

Before running a command, consider whether or not you have completed the previous step, and make sure to mark it as completed before moving on to the next step. It may be the case that you complete all steps in your plan after a single pass of implementation. If this is the case, you can simply mark all the planned steps as completed. Sometimes, you may need to change plans in the middle of a task: call \`update_plan\` with the updated plan and make sure to provide an \`explanation\` of the rationale when doing so.

Maintain statuses in the tool: exactly one item in_progress at a time; mark items complete when done; post timely status transitions. Do not jump an item from pending to completed: always set it to in_progress first. Do not batch-complete multiple items after the fact. Finish with all items completed or explicitly canceled/deferred before ending the turn. Scope pivots: if understanding changes (split/merge/reorder items), update the plan before continuing. Do not let the plan go stale while coding.

Use a plan when:
- The task is non-trivial and will require multiple actions over a long time horizon.
- There are logical phases or dependencies where sequencing matters.
- The work has ambiguity that benefits from outlining high-level goals.
- You want intermediate checkpoints for feedback and validation.
- When the user asked you to do more than one thing in a single prompt
- You generate additional steps while working, and plan to do them before yielding to the user

### Examples

**High-quality plans**

1. Add CLI entry with file args
2. Parse Markdown via CommonMark library
3. Apply semantic HTML template
4. Handle code blocks, images, links
5. Add error handling for invalid files

**Low-quality plans**

1. Create CLI tool
2. Add Markdown parser
3. Convert to HTML

If you need to write a plan, only write high quality plans, not low quality ones.`
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
   * 审批回调 — 当工具需要用户确认时调用
   *
   * 返回 true = 批准执行
   * 返回 false = 拒绝（Agent 收到拒绝消息）
   * 不设置 = 全部自动批准（开发模式）
   */
  onApprovalNeeded?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>
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
 * 3. user-role: 环境上下文（cwd、shell、日期）
 * 4. user-role: 用户实际输入
 */
export function buildInitialMessages(task: string, systemPrompt?: string): Message[] {
  const messages: Message[] = []

  // 1. system-role: 系统提示
  messages.push({
    role: 'system',
    content: systemPrompt || buildSystemPrompt(),
  })

  // 2-3. AGENTS.md + Skills + 环境上下文
  const { agentsMdMessage, environmentMessage, skills, skillsSummary } = buildProjectContext()

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

  // 环境上下文也作为 user-role 注入
  messages.push({ role: 'user', content: environmentMessage })

  // 4. 用户实际输入
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
    maxIterations = 50,
    signal,
    onStep,
  } = config

  // 1. 构建工具查找表
  const toolMap = new Map<string, Tool>()
  for (const tool of tools) {
    toolMap.set(tool.name, tool)
  }

  // 2. 生成 GLM 格式的工具定义
  const toolDefinitions: ToolDefinition[] = tools.map(toolToDefinition)

  // 3. 构建初始上下文（对齐 Codex build_initial_context）
  const messages = buildInitialMessages(task, systemPrompt)

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

    // 4b. 调用 LLM
    const response = await client.chat(messages, toolDefinitions)
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
      const args = JSON.parse(tc.function.arguments)
      const tool = toolMap.get(toolName)

      let resultContent: string
      let isError: boolean
      let exitCode: number | undefined

      if (!tool) {
        resultContent = `错误：未知工具 "${toolName}"`
        isError = true
        exitCode = 1
      } else {
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
