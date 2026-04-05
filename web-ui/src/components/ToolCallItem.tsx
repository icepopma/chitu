import type { Item } from '../types'
import { Wrench, ChevronDown, ChevronRight, Terminal, FileText } from 'lucide-react'
import { useState } from 'react'

function getToolIcon(name?: string) {
  if (!name) return <Wrench className="w-4 h-4" />
  if (name === 'exec') return <Terminal className="w-4 h-4" />
  if (name.includes('file')) return <FileText className="w-4 h-4" />
  return <Wrench className="w-4 h-4" />
}

function formatArgs(args?: Record<string, unknown>): string {
  if (!args) return ''
  // exec 只显示 command
  if (args.command) return args.command as string
  return JSON.stringify(args, null, 2)
}

export function ToolCallItem({ call, result }: { call: Item; result?: Item }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="my-1">
      {/* Tool Call Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-2 py-1 text-xs text-[#888] hover:text-white hover:bg-[#2a2a2a] rounded w-full text-left transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {getToolIcon(call.toolName)}
        <span className="font-medium text-[#5865f2]">{call.toolName}</span>
        {call.toolArgs && (
          <span className="truncate text-[#666] flex-1">{formatArgs(call.toolArgs)}</span>
        )}
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="ml-5 mt-1 space-y-1 text-xs">
          {call.content && (
            <div className="bg-[#1a1a1a] rounded p-2 font-mono text-[#aaa] whitespace-pre-wrap break-all">
              {call.content.length > 500 ? call.content.slice(0, 500) + '...' : call.content}
            </div>
          )}
          {result && (
            <div className={`bg-[#1a1a1a] rounded p-2 font-mono whitespace-pre-wrap break-all ${result.isError ? 'text-[#da373c]' : 'text-[#43b581]'}`}>
              {result.content.length > 500 ? result.content.slice(0, 500) + '...' : result.content}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
