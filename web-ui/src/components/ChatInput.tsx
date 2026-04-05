import { useState, useRef, useCallback } from 'react'
import { useChituSocket } from '../hooks/useChituSocket'
import { useAppStore } from '../lib/store'
import { Send, Square } from 'lucide-react'

export function ChatInput() {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { sendMessage, interruptTurn } = useChituSocket()
  const { currentThreadId, turnStatus } = useAppStore()

  const isRunning = turnStatus === 'in_progress'
  const canSend = input.trim() && currentThreadId && !isRunning

  const handleSend = useCallback(async () => {
    if (!input.trim() || !currentThreadId) return
    const msg = input
    setInput('')
    // 重置 textarea 高度
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    try {
      await sendMessage(msg)
    } catch (err: any) {
      console.error('发送失败:', err.message)
    }
  }, [input, currentThreadId, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) handleSend()
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 200) + 'px'
    }
  }

  return (
    <div className="px-4 pb-4">
      <div className="bg-[#2a2a2a] rounded-lg flex items-end gap-2 p-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={currentThreadId ? '输入消息...' : '请先新建一个对话'}
          disabled={!currentThreadId}
          rows={1}
          className="flex-1 bg-transparent text-white text-sm resize-none outline-none placeholder-[#888] disabled:opacity-50 max-h-[200px] py-1 px-2"
        />
        {isRunning ? (
          <button
            onClick={interruptTurn}
            className="p-2 rounded bg-[#da373c] hover:bg-[#a12828] text-white transition-colors"
            title="停止"
          >
            <Square className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="p-2 rounded bg-[#5865f2] hover:bg-[#4752c4] text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="发送"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
