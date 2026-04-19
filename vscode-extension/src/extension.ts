/**
 * 扩展入口 — 激活/停用生命周期
 *
 * 注册侧边栏 Chat WebView、命令、快捷键
 * 管理与 App Server 的 WebSocket 连接生命周期
 */

import * as vscode from 'vscode'
import { ChituClient } from './client'
import { ChatProvider } from './chat-provider'
import { DiffProvider } from './diff-provider'

let client: ChituClient | undefined
let chatProvider: ChatProvider | undefined
let diffProvider: DiffProvider | undefined

export function activate(context: vscode.ExtensionContext) {
  console.log('赤兔 VS Code 扩展已激活')

  // 读取配置
  const config = vscode.workspace.getConfiguration('chitu')
  const serverUrl = config.get<string>('serverUrl', 'ws://localhost:8080')
  const autoApprove = config.get<boolean>('autoApprove', false)
  const token = config.get<string>('token', '')

  // 创建 JSON-RPC 客户端
  client = new ChituClient(serverUrl, token)

  // 创建 Chat WebView Provider
  chatProvider = new ChatProvider(context.extensionUri, client, autoApprove)

  // 注册 WebView
  const chatView = vscode.window.registerWebviewViewProvider(
    'chitu.chatView',
    chatProvider,
    {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }
  )

  // 创建 Diff Provider
  diffProvider = new DiffProvider(context.extensionUri)

  // 注册命令
  const commands = [
    vscode.commands.registerCommand('chitu.openChat', () => {
      vscode.commands.executeCommand('workbench.view.extension.chitu-sidebar')
    }),
    vscode.commands.registerCommand('chitu.sendSelection', () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        vscode.window.showWarningMessage('没有打开的编辑器')
        return
      }
      const selection = editor.document.getText(editor.selection)
      if (!selection) {
        vscode.window.showWarningMessage('没有选中的文本')
        return
      }
      const fileName = editor.document.fileName
      const message = `请看这段代码（来自 ${fileName}）：\n\`\`\`\n${selection}\n\`\`\``
      chatProvider?.sendMessage(message)
      vscode.commands.executeCommand('workbench.view.extension.chitu-sidebar')
    }),
    vscode.commands.registerCommand('chitu.showDiffPreview', async () => {
      diffProvider?.showPreview()
    }),
    vscode.commands.registerCommand('chitu.newThread', async () => {
      await chatProvider?.createThread()
    }),
  ]

  // 监听配置变更
  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('chitu')) {
      const newConfig = vscode.workspace.getConfiguration('chitu')
      const newUrl = newConfig.get<string>('serverUrl', 'ws://localhost:8080')
      const newToken = newConfig.get<string>('token', '')
      const newAutoApprove = newConfig.get<boolean>('autoApprove', false)
      client?.updateConfig(newUrl, newToken)
      chatProvider?.updateAutoApprove(newAutoApprove)
    }
  })

  context.subscriptions.push(
    chatView,
    ...commands,
    configListener,
    { dispose: () => diffProvider?.dispose() }
  )

  // 尝试连接
  client.connect().catch(() => {
    vscode.window.showWarningMessage('赤兔: 无法连接 App Server，请确认服务器已启动')
  })
}

export function deactivate() {
  client?.disconnect()
  console.log('赤兔 VS Code 扩展已停用')
}
