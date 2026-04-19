/**
 * CLI 入口 — 终端界面模式
 *
 * 使用 Node.js 内置 readline 模块构建交互式终端界面。
 * 在同一进程内启动 App Server，直接调用 ThreadManager。
 *
 * 参考 Codex codex-rs/tui/ 的终端界面设计
 *
 * 学习重点：
 * - readline 提供 readline/promises 的 async 接口，比回调式更现代
 * - CLI 模式和 WebSocket 模式共享同一个 ThreadManager
 * - 事件监听直接订阅 AppEvent，不需要经过 JSON-RPC 序列化
 */

import 'dotenv/config'
import * as readline from 'readline/promises'
import { stdin as input, stdout as output } from 'process'
import { ThreadManager } from '../thread/manager.js'
import { HookDispatcher } from '../hooks/dispatcher.js'
import { FileWatcher, FileChangeBuffer, SkillsWatcher } from '../watcher/index.js'
import { logger } from '../monitoring/logger.js'
import type { AppEvent } from '../types.js'

// ANSI escape codes
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const BLUE = '\x1b[34m'
const MAGENTA = '\x1b[35m'
const CYAN = '\x1b[36m'
const BG_BLUE = '\x1b[44m'
const WHITE = '\x1b[37m'
const GRAY = '\x1b[90m'

function showWelcome(): void {
  const version = '0.1.0'
  const apiKey = process.env.ZHIPU_API_KEY
  const dbUrl = process.env.NEON_DATABASE_URL
  const jwtSecret = process.env.CHITU_JWT_SECRET
  const isMac = process.platform === 'darwin'
  const cwd = process.cwd()

  console.log('')
  console.log(`  ${CYAN}╭─────────────────────────────────────────────╮${RESET}`)
  console.log(`  ${CYAN}│${RESET}                                             ${CYAN}│${RESET}`)
  console.log(`  ${CYAN}│${RESET}  ${BOLD}🐎 赤兔${RESET} ${DIM}Chitu${RESET}  ${GRAY}v${version}${RESET}                   ${CYAN}│${RESET}`)
  console.log(`  ${CYAN}│${RESET}  ${GRAY}AI Agent 编程助手${RESET}                          ${CYAN}│${RESET}`)
  console.log(`  ${CYAN}│${RESET}                                             ${CYAN}│${RESET}`)
  console.log(`  ${CYAN}╰─────────────────────────────────────────────╯${RESET}`)
  console.log('')

  // Status indicators
  const check = (ok: boolean, label: string, detail: string) => {
    const icon = ok ? `${GREEN}✓${RESET}` : `${YELLOW}!${RESET}`
    console.log(`    ${icon}  ${WHITE}${label}${RESET}  ${GRAY}${detail}${RESET}`)
  }

  check(!!apiKey, 'API Key', apiKey ? '已配置' : '未设置 ZHIPU_API_KEY')
  check(!!dbUrl, 'Database', dbUrl ? 'Neon PostgreSQL' : '本地 JSON 存储')
  check(!!jwtSecret, 'Auth', jwtSecret ? 'JWT 已启用' : '开放模式')
  check(isMac, 'Sandbox', isMac ? 'macOS sandbox-exec' : '未启用')

  console.log('')
  console.log(`  ${DIM}─────────────────────────────────────────────${RESET}`)
  console.log(`  ${GRAY}cwd ${DIM}${cwd}${RESET}`)
  console.log('')

  // Commands
  console.log(`  ${BOLD}Commands${RESET}`)
  const commands = [
    ['/help',   '显示帮助信息'],
    ['/status', '查看当前状态'],
    ['/clear',  '清空当前对话'],
    ['/fork',   '派生当前对话'],
    ['/exit',   '退出赤兔'],
  ]
  for (const [cmd, desc] of commands) {
    console.log(`    ${BLUE}${cmd.padEnd(10)}${RESET} ${GRAY}${desc}${RESET}`)
  }

  console.log('')
  console.log(`  ${DIM}输入消息开始对话，Ctrl+C 退出${RESET}`)
  console.log('')
}

export async function startCli(): Promise<void> {
  showWelcome()

  // 初始化 ThreadManager
  const manager = new ThreadManager()
  manager.setHookDispatcher(new HookDispatcher())

  // M7: 文件监听
  const fileChangeBuffer = new FileChangeBuffer()
  const projectRoot = process.cwd()

  const fileWatcher = new FileWatcher({
    rootDir: projectRoot,
    onChange: (events) => fileChangeBuffer.push(events),
  })
  fileWatcher.start()

  const skillsWatcher = new SkillsWatcher({
    projectRoot,
    onSkillsChanged: (skills) => {
      console.log(`\n  🔄 Skills 热加载完成 (${skills.length} skills)`)
    },
  })
  skillsWatcher.start()

  manager.setFileChangeBuffer(fileChangeBuffer)

  // 监听事件，输出到终端
  manager.onEvent((event: AppEvent) => {
    handleEvent(event)
  })

  // 创建默认 thread
  const thread = await manager.create('CLI Session')
  console.log(`  ${GRAY}Thread: ${thread.id}${RESET}\n`)

  // readline 循环
  const rl = readline.createInterface({ input, output })
  let running = true

  const cleanup = async () => {
    if (!running) return
    running = false
    console.log('\n  👋 正在退出...')
    fileWatcher.stop()
    skillsWatcher.stop()
    rl.close()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)

  while (running) {
    try {
      const message = await rl.question(`${BOLD}${CYAN}你 >${RESET} `)
      if (!message.trim()) continue

      // Handle commands
      if (message.trim().startsWith('/')) {
        handleCommand(message.trim(), manager, thread.id)
        continue
      }

      // 运行 turn（阻塞等待完成）
      console.log('')
      await manager.runTurn(thread.id, message, {
        onApprovalNeeded: async (toolName: string, args: Record<string, unknown>) => {
          const command = toolName === 'exec' ? (args.command as string) : JSON.stringify(args)
          console.log(`\n  ${YELLOW}⚠ 需要审批:${RESET} ${command}`)
          const answer = await rl.question(`  ${YELLOW}允许执行？${RESET} (y/N) `)
          return answer.toLowerCase() === 'y'
        },
      })
      console.log('')
    } catch (err: any) {
      if (err.message?.includes('Interface closed')) break
      console.error(`  ${RED}✗ 错误:${RESET} ${err.message}`)
    }
  }
}

/** Handle slash commands */
function handleCommand(cmd: string, manager: ThreadManager, threadId: string): void {
  switch (cmd) {
    case '/help':
      console.log('')
      console.log(`  ${BOLD}赤兔 CLI 帮助${RESET}`)
      console.log('')
      console.log('  /help     显示帮助信息')
      console.log('  /status   查看当前状态')
      console.log('  /clear    清空当前对话')
      console.log('  /fork     派生当前对话')
      console.log('  /exit     退出赤兔')
      console.log('')
      break
    case '/status':
      console.log(`  Thread: ${threadId}`)
      console.log(`  PID:    ${process.pid}`)
      console.log(`  Uptime: ${Math.floor(process.uptime())}s`)
      break
    case '/clear':
      console.log(`  ${GREEN}✓${RESET} 对话已清空`)
      break
    default:
      console.log(`  ${YELLOW}未知命令:${RESET} ${cmd}`)
      break
  }
}

/** 处理 AppEvent，输出到终端 */
function handleEvent(event: AppEvent): void {
  switch (event.type) {
    case 'turn/started':
      process.stdout.write('  🐎 ')
      break

    case 'item/started': {
      const item = event.item
      if (item.type === 'assistant_message') {
        // 流式输出会在 item/delta 中处理
      } else if (item.type === 'tool_call') {
        process.stdout.write(`  ${MAGENTA}▸${RESET} ${item.toolName || 'unknown'}`)
        if (item.toolName === 'exec') {
          const command = item.toolArgs?.command as string | undefined
          if (command) process.stdout.write(`: ${GRAY}${command.substring(0, 80)}${RESET}`)
        }
        process.stdout.write('\n')
      }
      break
    }

    case 'item/delta': {
      if (event.delta) {
        process.stdout.write(event.delta)
      }
      break
    }

    case 'item/completed': {
      const item = event.item
      if (item.type === 'tool_call' && item.content) {
        const lines = item.content.split('\n')
        const preview = lines.slice(0, 5).join('\n')
        if (lines.length > 5) {
          process.stdout.write(`    ${GRAY}${preview}${RESET}\n    ${DIM}... (${lines.length} 行)${RESET}\n`)
        } else {
          process.stdout.write(`    ${GRAY}${preview}${RESET}\n`)
        }
      }
      break
    }

    case 'turn/completed':
      console.log('')
      break
  }
}

// 直接运行
if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') || '')) {
  startCli().catch(console.error)
}
