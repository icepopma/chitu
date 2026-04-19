/**
 * ToolUsageTab — 工具使用面板
 *
 * 工具使用频率横向条形图（Top N）+ 每日工具调用趋势
 */

import { Wrench, BarChart3, TrendingUp } from 'lucide-react'
import { ToolBarChart } from './ToolBarChart'
import { Sparkline } from './Sparkline'

interface ToolUsageTabProps {
  data: any
}

function Card({ title, icon, children, className = '' }: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-[#2a2a2a] rounded-lg overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1a1a1a]">
        {icon}
        <span className="text-xs font-semibold text-[#888] uppercase tracking-wide">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

export function ToolUsageTab({ data }: ToolUsageTabProps) {
  const toolUsage = data.analytics?.toolUsage || []
  const dailyActivity = data.analytics?.dailyActivity || []

  const totalCalls = toolUsage.reduce((sum: number, t: any) => sum + t.count, 0)
  const uniqueTools = toolUsage.length
  const dailyToolCalls = dailyActivity.map((d: any) => d.toolCalls)
  const dailyLabels = dailyActivity.map((d: any) => d.date)

  return (
    <div className="space-y-4">
      {/* 摘要 */}
      <div className="grid grid-cols-3 gap-4">
        <Card title="总调用次数" icon={<Wrench className="w-3.5 h-3.5 text-[#5865f2]" />}>
          <div className="text-center">
            <div className="text-3xl font-bold text-white">{totalCalls}</div>
            <div className="text-xs text-[#888] mt-1">次工具调用</div>
          </div>
        </Card>

        <Card title="工具种类" icon={<BarChart3 className="w-3.5 h-3.5 text-[#43b581]" />}>
          <div className="text-center">
            <div className="text-3xl font-bold text-[#43b581]">{uniqueTools}</div>
            <div className="text-xs text-[#888] mt-1">种不同工具</div>
          </div>
        </Card>

        <Card title="日均调用" icon={<TrendingUp className="w-3.5 h-3.5 text-[#faa61a]" />}>
          <div className="text-center">
            <div className="text-3xl font-bold text-[#faa61a]">
              {dailyActivity.length > 0 ? Math.round(totalCalls / dailyActivity.length) : '—'}
            </div>
            <div className="text-xs text-[#888] mt-1">次 / 天</div>
          </div>
        </Card>
      </div>

      {/* 工具使用频率 Top N */}
      <Card title="工具使用频率 (Top 8)" icon={<Wrench className="w-3.5 h-3.5 text-[#5865f2]" />}>
        <ToolBarChart tools={toolUsage} maxItems={8} />
      </Card>

      {/* 每日工具调用趋势 */}
      <Card title="每日工具调用趋势" icon={<TrendingUp className="w-3.5 h-3.5 text-[#faa61a]" />}>
        {dailyToolCalls.length >= 2 ? (
          <div>
            <Sparkline data={dailyToolCalls} width={800} height={80} color="#faa61a" />
            <div className="flex justify-between text-[10px] text-[#555] mt-1">
              <span>{dailyLabels[0]}</span>
              <span>{dailyLabels[dailyLabels.length - 1]}</span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-[#888] text-center py-6">数据不足，至少需要 2 天</div>
        )}
      </Card>

      {/* 工具详情列表 */}
      <Card title="全部工具" icon={<BarChart3 className="w-3.5 h-3.5 text-[#43b581]" />}>
        <div className="max-h-[300px] overflow-y-auto space-y-1">
          {toolUsage.map((tool: any) => (
            <div key={tool.name} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-[#1e1e1e] text-xs">
              <span className="font-mono text-[#ccc]">{tool.name}</span>
              <div className="flex items-center gap-3">
                <span className="text-[#888]">{tool.count} 次</span>
                <span className="text-[10px] text-[#555]">{new Date(tool.lastUsed).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
          {toolUsage.length === 0 && (
            <div className="text-sm text-[#888] text-center py-6">暂无工具使用数据</div>
          )}
        </div>
      </Card>
    </div>
  )
}
