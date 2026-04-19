/**
 * ToolBarChart — 工具使用频率横向条形图
 *
 * 展示 Top N 工具使用频率
 */

interface ToolBarChartProps {
  tools: Array<{ name: string; count: number }>
  maxItems?: number
}

export function ToolBarChart({ tools, maxItems = 8 }: ToolBarChartProps) {
  const top = tools.slice(0, maxItems)
  if (top.length === 0) {
    return <div className="text-sm text-[#888] text-center py-6">暂无工具使用数据</div>
  }

  const maxCount = top[0]?.count || 1

  const colors = [
    '#5865f2', '#43b581', '#faa61a', '#f04747',
    '#9b59b6', '#e67e22', '#1abc9c', '#e91e63',
  ]

  return (
    <div className="space-y-2.5">
      {top.map((tool, i) => {
        const pct = (tool.count / maxCount) * 100
        const color = colors[i % colors.length]
        return (
          <div key={tool.name} className="flex items-center gap-3">
            <span className="text-xs text-[#ccc] font-mono w-32 shrink-0 truncate" title={tool.name}>
              {tool.name}
            </span>
            <div className="flex-1 h-5 bg-[#1e1e1e] rounded overflow-hidden relative">
              <div
                className="h-full rounded transition-all duration-700 flex items-center px-2"
                style={{ width: `${Math.max(pct, 8)}%`, background: color }}
              >
                {pct > 15 && (
                  <span className="text-[10px] font-bold text-white/90">{tool.count}</span>
                )}
              </div>
            </div>
            {pct <= 15 && (
              <span className="text-[11px] text-[#888] font-mono">{tool.count}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
