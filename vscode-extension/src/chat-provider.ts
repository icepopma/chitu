/**
 * Chat WebView Provider — 侧边栏聊天面板
 *
 * 使用 VS Code WebView API 渲染 Chat UI
 * 通过 postMessage 与 WebView 通信
 * 通过 ChituClient 与 App Server 通信
 */

import * as vscode from 'vscode'
import type { ChituClient, EventCallback } from './client'

/** Chat 消息 */
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: string }>
  status?: 'streaming' | 'completed'
}

/** WebView 发给扩展的消息 */
interface WebviewMessage {
  type: 'sendMessage' | 'createThread' | 'interrupt' | 'approveResponse' | 'ready'
  data?: Record<string, unknown>
}

export class ChatProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined
  private client: ChituClient
  private autoApprove: boolean
  private extensionUri: vscode.Uri
  private currentThreadId: string | undefined
  private messages: ChatMessage[] = []
  private streamingMessageId: string | undefined
  private disposables: vscode.Disposable[] = []

  constructor(extensionUri: vscode.Uri, client: ChituClient, autoApprove: boolean) {
    this.extensionUri = extensionUri
    this.client = client
    this.autoApprove = autoApprove

    // 监听服务端事件
    const eventHandler: EventCallback = (method, params) => {
      this.handleServerEvent(method, params)
    }
    this.client.onEvent(eventHandler)

    // 监听连接状态
    this.client.onStatusChange((status) => {
      this.postMessage({ type: 'connectionStatus', status })
    })
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview)

    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      this.handleWebviewMessage(message)
    })

    webviewView.onDidDispose(() => {
      for (const d of this.disposables) {
        d.dispose()
      }
      this.disposables = []
    })
  }

  /** 从外部发送消息（如 sendSelection 命令） */
  async sendMessage(text: string): Promise<void> {
    if (!this.currentThreadId) {
      await this.createThread()
    }
    if (!this.currentThreadId) return

    // 添加用户消息到 UI
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      status: 'completed',
    }
    this.messages.push(userMsg)
    this.postMessage({ type: 'addMessage', message: userMsg })

    // 发送到服务端
    try {
      await this.client.sendRequest('turn/start', {
        threadId: this.currentThreadId,
        message: text,
        autoApprove: this.autoApprove,
      })
    } catch (err: any) {
      this.postMessage({
        type: 'addError',
        message: `发送失败: ${err.message}`,
      })
    }
  }

  /** 创建新 Thread */
  async createThread(): Promise<void> {
    try {
      const result = await this.client.sendRequest('thread/create', {}) as any
      if (result?.thread?.id) {
        this.currentThreadId = result.thread.id
        this.messages = []
        this.postMessage({ type: 'threadCreated', threadId: this.currentThreadId })
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`创建对话失败: ${err.message}`)
    }
  }

  /** 更新自动审批设置 */
  updateAutoApprove(value: boolean): void {
    this.autoApprove = value
  }

  // ===== 事件处理 =====

  private handleServerEvent(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case 'item/started': {
        const item = params.item as any
        if (item?.type === 'assistant_message') {
          const msg: ChatMessage = {
            id: item.id,
            role: 'assistant',
            content: '',
            status: 'streaming',
          }
          this.messages.push(msg)
          this.streamingMessageId = item.id
          this.postMessage({ type: 'addMessage', message: msg })
        } else if (item?.type === 'tool_call') {
          this.postMessage({
            type: 'toolCallStarted',
            itemId: item.id,
            toolName: item.toolName,
            toolArgs: item.toolArgs,
          })
        }
        break
      }
      case 'item/delta': {
        if (this.streamingMessageId === params.itemId) {
          this.postMessage({
            type: 'appendDelta',
            itemId: params.itemId,
            delta: params.delta,
          })
          // 更新本地消息内容
          const msg = this.messages.find(m => m.id === params.itemId)
          if (msg) {
            msg.content += params.delta
          }
        }
        break
      }
      case 'item/completed': {
        const item = params.item as any
        if (item?.type === 'assistant_message' && this.streamingMessageId === item.id) {
          this.streamingMessageId = undefined
          this.postMessage({
            type: 'messageCompleted',
            itemId: item.id,
            content: item.content,
          })
        } else if (item?.type === 'tool_result') {
          this.postMessage({
            type: 'toolCallCompleted',
            itemId: item.id,
            toolName: item.toolName,
            content: item.content,
            isError: item.isError,
            exitCode: item.exitCode,
          })
        }
        break
      }
      case 'turn/completed': {
        this.postMessage({ type: 'turnCompleted' })
        break
      }
      case 'approval/requested': {
        this.postMessage({
          type: 'approvalRequested',
          id: params.id,
          command: params.command,
          riskLevel: params.riskLevel,
        })
        break
      }
    }
  }

  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'sendMessage':
        await this.sendMessage((message.data?.text as string) || '')
        break
      case 'createThread':
        await this.createThread()
        break
      case 'interrupt':
        if (this.currentThreadId) {
          await this.client.sendRequest('turn/interrupt', {
            threadId: this.currentThreadId,
          })
        }
        break
      case 'approveResponse':
        await this.client.sendRequest('approval/respond', {
          id: message.data?.id,
          approved: message.data?.approved,
        })
        break
      case 'ready':
        this.postMessage({ type: 'connectionStatus', status: this.client.isConnected() ? 'connected' : 'disconnected' })
        if (this.currentThreadId) {
          this.postMessage({ type: 'threadCreated', threadId: this.currentThreadId })
        }
        break
    }
  }

  private postMessage(data: unknown): void {
    this.view?.webview.postMessage(data)
  }

  // ===== WebView HTML =====

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce()

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>赤兔 Chat</title>
  <style nonce="${nonce}">
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --input-border: var(--vscode-input-border);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --muted: var(--vscode-descriptionForeground);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--fg);
      background: var(--bg);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    .status-bar {
      padding: 4px 8px;
      font-size: 11px;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .status-dot {
      width: 6px; height: 6px; border-radius: 50%;
    }
    .status-dot.connected { background: #4caf50; }
    .status-dot.disconnected { background: #f44336; }
    .status-dot.connecting { background: #ff9800; }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .msg {
      margin-bottom: 12px;
      padding: 8px 10px;
      border-radius: 6px;
      max-width: 100%;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .msg.user {
      background: var(--btn-bg);
      color: var(--btn-fg);
      margin-left: 20%;
    }
    .msg.assistant {
      background: var(--input-bg);
      color: var(--input-fg);
      margin-right: 10%;
    }
    .msg.streaming {
      border-left: 2px solid #007acc;
    }
    .msg .role {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      margin-bottom: 4px;
      color: var(--muted);
    }
    .tool-call {
      margin: 4px 0;
      padding: 6px 8px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 12px;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .tool-call .tool-name {
      color: #569cd6;
      font-weight: 600;
    }
    .tool-result {
      margin-top: 4px;
      padding: 4px 8px;
      font-size: 11px;
      color: var(--muted);
      max-height: 120px;
      overflow-y: auto;
    }
    .tool-result.error { color: #f44336; }
    .approval-box {
      margin: 8px 0;
      padding: 8px;
      border: 1px solid #ff9800;
      border-radius: 4px;
      background: rgba(255, 152, 0, 0.1);
    }
    .approval-box .command {
      font-family: monospace;
      font-size: 12px;
      padding: 4px;
      background: var(--bg);
      border-radius: 2px;
      margin: 4px 0;
    }
    .approval-box .buttons {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    .approval-box button {
      padding: 4px 12px;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn-approve { background: #4caf50; color: white; }
    .btn-reject { background: #f44336; color: white; }
    .input-area {
      padding: 8px;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .input-row {
      display: flex;
      gap: 6px;
    }
    textarea {
      flex: 1;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 6px 8px;
      font-family: inherit;
      font-size: inherit;
      resize: none;
      min-height: 60px;
      outline: none;
    }
    textarea:focus {
      border-color: var(--vscode-focusBorder);
    }
    button.send-btn {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      border-radius: 4px;
      padding: 6px 14px;
      cursor: pointer;
      font-size: 12px;
      align-self: flex-end;
    }
    button.send-btn:hover {
      background: var(--btn-hover);
    }
    button.send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .toolbar {
      display: flex;
      gap: 4px;
      justify-content: flex-end;
    }
    .toolbar button {
      background: none;
      border: 1px solid var(--border);
      color: var(--fg);
      border-radius: 3px;
      padding: 2px 8px;
      cursor: pointer;
      font-size: 11px;
    }
    .toolbar button:hover {
      background: var(--input-bg);
    }
    .error-msg {
      color: #f44336;
      padding: 4px 8px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="status-bar">
    <span class="status-dot disconnected" id="statusDot"></span>
    <span id="statusText">未连接</span>
  </div>

  <div class="messages" id="messages"></div>

  <div class="input-area">
    <div class="toolbar">
      <button id="btnNewThread" title="新建对话">+ 新对话</button>
      <button id="btnInterrupt" title="中断">⏹ 中断</button>
    </div>
    <div class="input-row">
      <textarea id="inputBox" placeholder="输入消息... (Enter 发送, Shift+Enter 换行)" rows="3"></textarea>
    </div>
    <button class="send-btn" id="btnSend" disabled>发送</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputBox = document.getElementById('inputBox');
    const btnSend = document.getElementById('btnSend');
    const btnNewThread = document.getElementById('btnNewThread');
    const btnInterrupt = document.getElementById('btnInterrupt');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    let connected = false;
    let threadId = null;

    // ===== 发送消息 =====
    function sendMessage() {
      const text = inputBox.value.trim();
      if (!text || !connected) return;
      vscode.postMessage({ type: 'sendMessage', data: { text } });
      inputBox.value = '';
    }

    btnSend.addEventListener('click', sendMessage);
    inputBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    btnNewThread.addEventListener('click', () => {
      vscode.postMessage({ type: 'createThread' });
    });

    btnInterrupt.addEventListener('click', () => {
      vscode.postMessage({ type: 'interrupt' });
    });

    inputBox.addEventListener('input', () => {
      btnSend.disabled = !inputBox.value.trim() || !connected;
    });

    // ===== 渲染消息 =====
    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function addMessageEl(msg) {
      const div = document.createElement('div');
      div.className = 'msg ' + msg.role + (msg.status === 'streaming' ? ' streaming' : '');
      div.id = 'msg-' + msg.id;
      div.innerHTML = '<div class="role">' + (msg.role === 'user' ? '你' : '赤兔') + '</div>'
        + '<div class="content">' + escapeHtml(msg.content || '') + '</div>';
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function appendDelta(itemId, delta) {
      const el = document.getElementById('msg-' + itemId);
      if (el) {
        const content = el.querySelector('.content');
        if (content) {
          content.textContent += delta;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }
    }

    function messageCompleted(itemId, content) {
      const el = document.getElementById('msg-' + itemId);
      if (el) {
        el.classList.remove('streaming');
        const contentEl = el.querySelector('.content');
        if (contentEl && content) {
          contentEl.textContent = content;
        }
      }
    }

    function addToolCall(itemId, toolName, toolArgs) {
      const div = document.createElement('div');
      div.className = 'tool-call';
      div.id = 'tool-' + itemId;
      div.innerHTML = '<span class="tool-name">' + escapeHtml(toolName) + '</span> '
        + escapeHtml(JSON.stringify(toolArgs, null, 2)).substring(0, 200);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function toolCallCompleted(itemId, content, isError) {
      const el = document.getElementById('tool-' + itemId);
      if (el) {
        const result = document.createElement('div');
        result.className = 'tool-result' + (isError ? ' error' : '');
        result.textContent = (content || '').substring(0, 500);
        el.appendChild(result);
      }
    }

    function addApproval(id, command, riskLevel) {
      const div = document.createElement('div');
      div.className = 'approval-box';
      div.id = 'approval-' + id;
      div.innerHTML = '<div>⚠️ 需要审批 <strong>' + escapeHtml(riskLevel) + '</strong></div>'
        + '<div class="command">' + escapeHtml(command) + '</div>'
        + '<div class="buttons">'
        + '<button class="btn-approve" data-id="' + escapeHtml(id) + '">✅ 允许</button>'
        + '<button class="btn-reject" data-id="' + escapeHtml(id) + '">❌ 拒绝</button>'
        + '</div>';
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      div.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          vscode.postMessage({
            type: 'approveResponse',
            data: { id: btn.dataset.id, approved: btn.classList.contains('btn-approve') }
          });
          div.remove();
        });
      });
    }

    function addError(message) {
      const div = document.createElement('div');
      div.className = 'error-msg';
      div.textContent = message;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ===== 接收扩展消息 =====
    window.addEventListener('message', (event) => {
      const data = event.data;
      switch (data.type) {
        case 'connectionStatus':
          connected = data.status === 'connected';
          statusDot.className = 'status-dot ' + data.status;
          statusText.textContent = data.status === 'connected' ? '已连接'
            : data.status === 'connecting' ? '连接中...'
            : '未连接';
          btnSend.disabled = !inputBox.value.trim() || !connected;
          break;
        case 'threadCreated':
          threadId = data.threadId;
          messagesEl.innerHTML = '';
          break;
        case 'addMessage':
          addMessageEl(data.message);
          break;
        case 'appendDelta':
          appendDelta(data.itemId, data.delta);
          break;
        case 'messageCompleted':
          messageCompleted(data.itemId, data.content);
          break;
        case 'toolCallStarted':
          addToolCall(data.itemId, data.toolName, data.toolArgs);
          break;
        case 'toolCallCompleted':
          toolCallCompleted(data.itemId, data.content, data.isError);
          break;
        case 'approvalRequested':
          addApproval(data.id, data.command, data.riskLevel);
          break;
        case 'turnCompleted':
          break;
        case 'addError':
          addError(data.message);
          break;
      }
    });

    // 通知扩展 WebView 已就绪
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}
