/**
 * Diff Provider — 编辑器内联 diff 预览
 *
 * 在编辑器中显示文件变更的内联 diff
 * 使用 vscode.TextDocumentContentProvider 渲染 diff 视图
 * 支持监听 Agent 的文件变更操作，自动弹出 diff 预览
 */

import * as vscode from 'vscode'
import * as path from 'path'

/** Diff 条目 */
interface DiffEntry {
  filePath: string
  originalContent: string
  newContent: string
  timestamp: number
}

export class DiffProvider {
  private extensionUri: vscode.Uri
  private diffs: Map<string, DiffEntry> = new Map()
  private pendingDiffs: DiffEntry[] = []
  private disposables: vscode.Disposable[] = []

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri

    // 注册 TextDocumentContentProvider 用于 diff 视图
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        'chitu-diff',
        {
          provideTextDocumentContent: (uri: vscode.Uri) => {
            const filePath = uri.path
            const diff = this.diffs.get(filePath)
            if (diff) {
              return diff.newContent
            }
            return ''
          },
        }
      )
    )

    // 监听文件系统变更（Agent 写入文件时触发 diff 预览）
    const watcher = vscode.workspace.createFileSystemWatcher(
      '**/*',
      false,
      true,
      false
    )
    watcher.onDidCreate((uri) => this.checkDiff(uri))
    watcher.onDidChange((uri) => this.checkDiff(uri))
    this.disposables.push(watcher)
  }

  /** 释放资源 */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables = []
  }

  /** 显示 diff 预览面板 */
  async showPreview(): Promise<void> {
    if (this.pendingDiffs.length === 0) {
      vscode.window.showInformationMessage('没有待预览的 diff')
      return
    }

    const diff = this.pendingDiffs.shift()!
    await this.showDiff(diff)
  }

  /** 显示指定文件的 diff */
  async showDiffForFile(filePath: string, originalContent: string, newContent: string): Promise<void> {
    const diff: DiffEntry = {
      filePath,
      originalContent,
      newContent,
      timestamp: Date.now(),
    }
    await this.showDiff(diff)
  }

  /** 添加待预览的 diff */
  addPendingDiff(filePath: string, originalContent: string, newContent: string): void {
    this.pendingDiffs.push({
      filePath,
      originalContent,
      newContent,
      timestamp: Date.now(),
    })
  }

  /** 获取待处理的 diff 数量 */
  getPendingCount(): number {
    return this.pendingDiffs.length
  }

  // ===== 内部方法 =====

  private async showDiff(diff: DiffEntry): Promise<void> {
    const fileName = path.basename(diff.filePath)

    // 存储到 map
    this.diffs.set(diff.filePath, diff)

    // 创建虚拟 URI 用于 diff 视图
    const originalUri = vscode.Uri.parse(`untitled:${fileName}.original`)
    const modifiedUri = vscode.Uri.parse(`chitu-diff:${diff.filePath}`)

    // 写入原始内容到临时文档
    const originalDoc = await vscode.workspace.openTextDocument(originalUri)
    const editor = await vscode.window.showTextDocument(originalDoc, { preview: true })
    await editor.edit((editBuilder) => {
      const fullRange = new vscode.Range(
        originalDoc.lineAt(0).range.start,
        originalDoc.lineAt(Math.max(0, originalDoc.lineCount - 1)).range.end
      )
      editBuilder.replace(fullRange, diff.originalContent)
    })

    // 显示 diff
    try {
      await vscode.commands.executeCommand(
        'vscode.diff',
        originalUri,
        modifiedUri,
        `赤兔 Diff: ${fileName} (原始 → 修改)`,
        { preserveFocus: true }
      )
    } catch {
      // 如果 vscode.diff 不可用，直接显示修改后的内容
      const newDoc = await vscode.workspace.openTextDocument(modifiedUri)
      await vscode.window.showTextDocument(newDoc, { preview: true })
    }
  }

  private async checkDiff(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath
    if (filePath.includes('node_modules') || filePath.includes('.git')) {
      return
    }

    const diff = this.diffs.get(filePath)
    if (diff) {
      await this.showDiff(diff)
    }
  }
}
