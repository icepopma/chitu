import { useAppStore } from '../lib/store'
import { useChituSocket } from '../hooks/useChituSocket'
import { MessageSquare, Plus, Wifi, WifiOff } from 'lucide-react'
import { cn } from '../lib/utils'

export function Sidebar() {
  const { threads, currentThreadId } = useAppStore()
  const { createThread, resumeThread, connected } = useChituSocket()

  const handleSelect = async (id: string) => {
    if (id !== currentThreadId) {
      await resumeThread(id)
    }
  }

  return (
    <div className="w-60 bg-[#1e1e1e] flex flex-col border-r border-[#2a2a2a] shrink-0">
      {/* Header */}
      <div className="h-12 flex items-center px-4 border-b border-[#2a2a2a] shrink-0">
        <span className="text-base font-semibold text-white">🐰 赤兔</span>
        <div className="ml-auto">
          {connected ? (
            <Wifi className="w-4 h-4 text-[#43b581]" />
          ) : (
            <WifiOff className="w-4 h-4 text-[#da373c]" />
          )}
        </div>
      </div>

      {/* Thread List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <div className="px-2 py-1 text-xs font-semibold text-[#888] uppercase tracking-wide">
          对话列表
        </div>
        {threads.map((thread) => (
          <button
            key={thread.id}
            onClick={() => handleSelect(thread.id)}
            className={cn(
              'w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm hover:bg-[#2a2a2a] transition-colors',
              thread.id === currentThreadId ? 'bg-[#2a2a2a] text-white' : 'text-[#888] hover:text-white',
            )}
          >
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span className="truncate">{thread.title}</span>
          </button>
        ))}
        {threads.length === 0 && (
          <div className="px-2 py-8 text-center text-xs text-[#888]">
            还没有对话
          </div>
        )}
      </div>

      {/* New Thread Button */}
      <div className="p-2 border-t border-[#2a2a2a]">
        <button
          onClick={() => createThread('新对话')}
          disabled={!connected}
          className="w-full flex items-center gap-2 px-3 py-2 rounded bg-[#5865f2] hover:bg-[#4752c4] text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" />
          新建对话
        </button>
      </div>
    </div>
  )
}
