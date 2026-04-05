import { useEffect, useRef } from 'react'
import { useAppStore } from '../lib/store'
import { MessageItem } from './MessageItem'
import { WelcomeScreen } from './WelcomeScreen'
import { Loader2 } from 'lucide-react'

export function ChatArea() {
  const { currentThreadId, items, turnStatus } = useAppStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [items])

  // 没有选中线程 → 欢迎页
  if (!currentThreadId) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <WelcomeScreen />
      </div>
    )
  }

  // 有线程但没消息
  const isEmpty = items.length === 0

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-12 flex items-center px-4 border-b border-[#2a2a2a] bg-[#1e1e1e] shrink-0">
        <span className="text-sm font-medium text-white">对话</span>
        {turnStatus === 'in_progress' && (
          <span className="ml-3 flex items-center gap-1.5 text-xs text-[#5865f2]">
            <Loader2 className="w-3 h-3 animate-spin" />
            Agent 运行中...
          </span>
        )}
        {turnStatus === 'completed' && (
          <span className="ml-3 text-xs text-[#43b581]">已完成</span>
        )}
        {turnStatus === 'failed' && (
          <span className="ml-3 text-xs text-[#da373c]">失败</span>
        )}
        {turnStatus === 'interrupted' && (
          <span className="ml-3 text-xs text-[#da373c]">已中断</span>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4">
        {isEmpty ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="max-w-sm text-center">
              <div className="text-3xl mb-3">🐰</div>
              <p className="text-[#888] text-sm">有什么我可以帮你的？</p>
            </div>
          </div>
        ) : (
          <MessageItem items={items} />
        )}
      </div>
    </div>
  )
}
