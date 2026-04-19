import type { Item } from '../types'
import { ToolCallItem } from './ToolCallItem'
import { User, Bot } from 'lucide-react'
import { useMemo, useState } from 'react'

const IMAGE_BASE = 'http://localhost:8080'

/** 消息内嵌图片预览 */
function MessageImages({ images }: { images: string[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const urls = images.map(p => p.startsWith('http') ? p : `${IMAGE_BASE}${p}`)

  return (
    <>
      <div className="flex gap-2 mt-1.5 flex-wrap">
        {urls.map((url, i) => (
          <img
            key={i}
            src={url}
            alt={`图片 ${i + 1}`}
            className="max-w-[200px] max-h-[200px] object-cover rounded-lg border border-[#3a3a3a] cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => setExpanded(url)}
          />
        ))}
      </div>
      {/* 大图查看 */}
      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
          onClick={() => setExpanded(null)}
        >
          <img src={expanded} alt="大图" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" />
        </div>
      )}
    </>
  )
}

function groupItems(items: Item[]) {
  const groups: Array<{ type: 'user' | 'assistant'; message: Item; tools: Array<{ call: Item; result?: Item }> }> = []
  let currentGroup: typeof groups[0] | null = null

  for (const item of items) {
    if (item.type === 'user_message') {
      currentGroup = { type: 'user', message: item, tools: [] }
      groups.push(currentGroup)
    } else if (item.type === 'assistant_message') {
      currentGroup = { type: 'assistant', message: item, tools: [] }
      groups.push(currentGroup)
    } else if (item.type === 'tool_call' && currentGroup) {
      currentGroup.tools.push({ call: item })
    } else if (item.type === 'tool_result' && currentGroup) {
      const lastTool = currentGroup.tools[currentGroup.tools.length - 1]
      if (lastTool && !lastTool.result) {
        lastTool.result = item
      }
    }
  }

  return groups
}

export function MessageItem({ items }: { items: Item[] }) {
  const groups = useMemo(() => groupItems(items), [items])

  return (
    <div className="space-y-4">
      {groups.map((group, i) => (
        <div key={i} className="group">
          {group.type === 'user' ? (
            /* User Message */
            <div className="flex gap-3 px-4 py-2 hover:bg-[#2a2a2a]/30">
              <div className="w-8 h-8 rounded-full bg-[#5865f2] flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-white">你</span>
                  <span className="text-[10px] text-[#888]">
                    {new Date(group.message.startedAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-sm text-[#ddd] mt-0.5 whitespace-pre-wrap">
                  {group.message.content}
                </div>
                {/* M21: 多模态 — 用户上传的图片 */}
                {group.message.images && group.message.images.length > 0 && (
                  <MessageImages images={group.message.images} />
                )}
              </div>
            </div>
          ) : (
            /* Assistant Message */
            <div className="flex gap-3 px-4 py-2 hover:bg-[#2a2a2a]/30">
              <div className="w-8 h-8 rounded-full bg-[#43b581] flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-white">赤兔</span>
                  <span className="text-[10px] text-[#888]">
                    {new Date(group.message.startedAt).toLocaleTimeString()}
                  </span>
                  {group.message.isError && (
                    <span className="text-[10px] text-[#da373c] bg-[#da373c]/10 px-1.5 py-0.5 rounded">错误</span>
                  )}
                </div>

                {/* Tool Calls */}
                {group.tools.map((tool, j) => (
                  <ToolCallItem key={j} call={tool.call} result={tool.result} />
                ))}

                {/* Assistant Text — streaming shows cursor */}
                {group.message.content && (
                  <div className="text-sm text-[#ddd] mt-1 whitespace-pre-wrap">
                    {group.message.content}
                    {group.message.status === 'started' && (
                      <span className="inline-block w-1.5 h-4 bg-[#43b581] ml-0.5 animate-pulse align-text-bottom" />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
