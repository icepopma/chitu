import { useAppStore } from '../lib/store'
import { useChituSocket } from '../hooks/useChituSocket'
import { MessageSquare, Plus, Trash2, GitFork, Wifi, WifiOff, Activity } from 'lucide-react'
import { cn } from '../lib/utils'
import { useState } from 'react'
import { UserPanel } from './UserPanel'

export function Sidebar({ onShowDashboard }: { onShowDashboard?: () => void }) {
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
      {/* Header with new thread button */}
      <div className="h-12 flex items-center px-3 border-b border-[#2a2a2a] shrink-0 gap-2">
        <button
          onClick={() => createThread('新对话')}
          disabled={!connected}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          新建对话
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          {onShowDashboard && (
            <button
              onClick={onShowDashboard}
              className="text-[#888] hover:text-[#5865f2] transition-colors"
              title="监控面板"
            >
              <Activity className="w-3.5 h-3.5" />
            </button>
          )}
          {connected ? (
            <Wifi className="w-3.5 h-3.5 text-[#43b581]" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-[#da373c]" />
          )}
        </div>
      </div>

      {/* Thread List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <div className="px-2 py-1 text-[10px] font-semibold text-[#666] uppercase tracking-wide">
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
              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate text-xs">{thread.title}</span>
            </button>
            {/* Hover actions */}
            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pr-1 gap-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); forkThread(thread.id) }}
                disabled={!connected}
                className="p-1 text-[#555] hover:text-[#5865f2] transition-colors disabled:opacity-30"
                title="派生对话"
              >
                <GitFork className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(thread.id) }}
                disabled={!connected}
                className="p-1 text-[#555] hover:text-red-400 transition-colors disabled:opacity-30"
                title="删除对话"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
        {threads.length === 0 && (
          <div className="px-2 py-8 text-center text-[10px] text-[#666]">
            还没有对话
          </div>
        )}
      </div>

      {/* User Panel — bottom area */}
      <UserPanel />
    </div>
  )
}
