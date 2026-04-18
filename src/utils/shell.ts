/**
 * Shell 检测工具
 *
 * 自动检测当前用户的 Shell（zsh/bash/sh），
 * 按平台派发不同默认值：macOS 默认 zsh，Linux 默认 bash。
 *
 * 参考 Codex codex-rs/core/src/shell.rs + shell_detect.rs
 *
 * 学习重点：
 * - process.env.SHELL 在 macOS/Linux 上由 login 程序设置
 * - Windows 没有 SHELL 环境变量，需用 COMSPEC
 * - 检测顺序：SHELL 环境变量 → 平台默认 → 兜底 /bin/sh
 */

import { platform } from 'node:os'

/** 支持的 Shell 类型 */
export type ShellType = 'zsh' | 'bash' | 'sh' | 'fish' | 'other'

/** Shell 信息 */
export interface ShellInfo {
	/** Shell 可执行文件路径 */
	path: string
	/** Shell 类型 */
	type: ShellType
	/** 是否为登录 shell */
	isLoginShell: boolean
}

/**
 * 检测当前用户的 Shell
 *
 * 优先级：
 * 1. SHELL 环境变量（macOS/Linux 标准方式）
 * 2. 平台默认（macOS → /bin/zsh, Linux → /bin/bash）
 * 3. 兜底 /bin/sh（POSIX 标准，所有 Unix 都有）
 */
export function detectShell(): ShellInfo {
	const envShell = process.env.SHELL
	const currentPlatform = platform()

	// 1. 尝试 SHELL 环境变量
	if (envShell) {
		return {
			path: envShell,
			type: classifyShell(envShell),
			isLoginShell: false,
		}
	}

	// 2. Windows 用 COMSPEC
	if (currentPlatform === 'win32') {
		const comspec = process.env.COMSPEC || 'cmd.exe'
		return {
			path: comspec,
			type: 'other',
			isLoginShell: false,
		}
	}

	// 3. 平台默认
	const defaultShell = currentPlatform === 'darwin' ? '/bin/zsh' : '/bin/bash'
	return {
		path: defaultShell,
		type: classifyShell(defaultShell),
		isLoginShell: false,
	}
}

/**
 * 从 Shell 路径推断 Shell 类型
 */
function classifyShell(shellPath: string): ShellType {
	const base = shellPath.split('/').pop()?.toLowerCase() || ''

	if (base.includes('zsh')) return 'zsh'
	if (base.includes('bash')) return 'bash'
	if (base.includes('fish')) return 'fish'
	if (base === 'sh') return 'sh'
	return 'other'
}

/**
 * 获取 Shell 执行参数
 *
 * 不同 Shell 需要不同参数来执行命令：
 * - bash/zsh/sh: -c "command"
 * - fish: -c "command"
 */
export function getShellArgs(shellInfo: ShellInfo): string[] {
	switch (shellInfo.type) {
		case 'bash':
		case 'zsh':
		case 'sh':
		case 'fish':
			return ['-c']
		default:
			return ['-c']
	}
}

/**
 * 获取检测到的 Shell 路径（便捷函数）
 */
export function getShellPath(): string {
	return detectShell().path
}
