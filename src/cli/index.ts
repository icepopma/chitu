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

import * as readline from 'readline/promises'
import { stdin as input, stdout as output } from 'process'
import { ThreadManager } from '../thread/manager.js'
import { HookDispatcher } from '../hooks/dispatcher.js'
import { FileWatcher, FileChangeBuffer, SkillsWatcher } from '../watcher/index.js'
import { logger } from '../monitoring/logger.js'
import type { AppEvent } from '../types.js'

export async function startCli(): Promise<void> {
	console.log('\n🐎 赤兔 (Chitu) CLI')
	console.log('   输入消息开始对话，Ctrl+C 退出\n')

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
			console.log(`\n🔄 Skills 热加载完成 (${skills.length} skills)`)
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
	console.log(`📝 Thread: ${thread.id}\n`)

	// readline 循环
	const rl = readline.createInterface({ input, output })
	let running = true

	const cleanup = async () => {
		if (!running) return
		running = false
		console.log('\n👋 正在退出...')
		fileWatcher.stop()
		skillsWatcher.stop()
		rl.close()
		process.exit(0)
	}

	process.on('SIGINT', cleanup)

	while (running) {
		try {
			const message = await rl.question('你 > ')
			if (!message.trim()) continue

			// 运行 turn（阻塞等待完成）
			console.log('')
			await manager.runTurn(thread.id, message, {
				onApprovalNeeded: async (toolName: string, args: Record<string, unknown>) => {
					const command = toolName === 'exec' ? (args.command as string) : JSON.stringify(args)
					console.log(`\n⚠️  需要审批: ${command}`)
					const answer = await rl.question('   允许执行？(y/N) ')
					return answer.toLowerCase() === 'y'
				},
			})
			console.log('')
		} catch (err: any) {
			if (err.message?.includes('Interface closed')) break
			console.error(`❌ 错误: ${err.message}`)
		}
	}
}

/** 处理 AppEvent，输出到终端 */
function handleEvent(event: AppEvent): void {
	switch (event.type) {
		case 'turn/started':
			process.stdout.write('🐎 ')
			break

		case 'item/started': {
			const item = event.item
			if (item.type === 'assistant_message') {
				// 流式输出会在 item/delta 中处理
			} else if (item.type === 'tool_call') {
				process.stdout.write(`\n🔧 ${item.toolName || 'unknown'}`)
				if (item.toolName === 'exec') {
					const command = item.toolArgs?.command as string | undefined
					if (command) process.stdout.write(`: ${command.substring(0, 80)}`)
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
					process.stdout.write(`   ${preview}\n   ... (${lines.length} 行)\n`)
				} else {
					process.stdout.write(`   ${preview}\n`)
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
