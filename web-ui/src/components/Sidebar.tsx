import { useAppStore } from '../lib/store'
import { useChituSocket } from '../hooks/useChituSocket'
import { MessageSquare, Plus, Minus, Trash2, GitFork, Wifi, WifiOff } from 'lucide-react'
import { cn } from '../lib/utils'
import { useState } from 'react'

export function Sidebar() {
  const { threads, currentThreadId } = useAppStore()
  const { createThread, deleteThread, forkThread, resumeThread, connected } = useChituSocket()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleSelect = async (id: string) => {
    if (deletingId) return
    if (id !== currentThreadId) {
      await resumeThread(id)
    }
  }

  const handleDelete = async (id: string) => {
    await deleteThread(id)
    setDeletingId(null)
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
          <div
            key={thread.id}
            className={cn(
              'group flex items-center rounded text-sm transition-colors',
              thread.id === currentThreadId ? 'bg-[#2a2a2a]' : 'hover:bg-[#2a2a2a]',
              deletingId === thread.id && 'ring-1 ring-red-500/50',
            )}
          >
            <button
              onClick={() => handleSelect(thread.id)}
              className={cn(
                'flex-1 flex items-center gap-2 px-2 py-1.5 text-left transition-colors',
                thread.id === currentThreadId ? 'text-white' : 'text-[#888] hover:text-white',
              )}
            >
              <MessageSquare className="w-4 h-4 shrink-0" />
              <span className="truncate">{thread.title}</span>
            </button>
            <button
              onClick={() => handleDelete(thread.id)}
              className="px-2 py-1.5 text-[#555] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              title="删除对话"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {threads.length === 0 && (
          <div className="px-2 py-8 text-center text-xs text-[#888]">
            还没有对话
          </div>
        )}
      </div>

      {/* New / Delete Thread Buttons */}
      <div className="p-2 border-t border-[#2a2a2a] flex gap-2">
        <button
          onClick={() => createThread('新对话')}
          disabled={!connected}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded bg-[#5865f2] hover:bg-[#4752c4] text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" />
          新建
        </button>
        {currentThreadId && (
          <>
            <button
              onClick={() => forkThread(currentThreadId)}
              disabled={!connected}
              className="flex items-center justify-center px-3 py-2 rounded bg-[#4a4a4a] hover:bg-[#5865f2] text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="派生当前对话"
            >
              <GitFork className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleDelete(currentThreadId)}
              disabled={!connected}
              className="flex items-center justify-center px-3 py-2 rounded bg-[#4a4a4a] hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="删除当前对话"
            >
              <Minus className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
