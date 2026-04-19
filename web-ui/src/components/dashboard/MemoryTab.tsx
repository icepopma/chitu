/**
 * MemoryTab — 记忆面板
 *
 * 记忆条目数、按类别统计、最近记忆条目、CapacityBar 可视化
 */

import { Brain, Tag, Clock } from 'lucide-react'
import { CapacityBar } from './CapacityBar'

interface MemoryTabProps {
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

const CATEGORY_COLORS: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  preference: { bg: 'bg-[#5865f2]/15', text: 'text-[#5865f2]', dot: 'bg-[#5865f2]', label: '用户偏好' },
  architecture: { bg: 'bg-[#43b581]/15', text: 'text-[#43b581]', dot: 'bg-[#43b581]', label: '架构决策' },
  convention: { bg: 'bg-[#faa61a]/15', text: 'text-[#faa61a]', dot: 'bg-[#faa61a]', label: '项目约定' },
  failure: { bg: 'bg-[#f04747]/15', text: 'text-[#f04747]', dot: 'bg-[#f04747]', label: '已知问题' },
  fact: { bg: 'bg-[#9b59b6]/15', text: 'text-[#9b59b6]', dot: 'bg-[#9b59b6]', label: '关键事实' },
}

export function MemoryTab({ data }: MemoryTabProps) {
  const memory = data.analytics?.memory || { total: 0, byCategory: {}, recentItems: [] }
  const { total, byCategory, recentItems } = memory
  const MEMORY_LIMIT = 100

  return (
    <div className="space-y-4">
      {/* 摘要 */}
      <div className="grid grid-cols-3 gap-4">
        <Card title="总记忆数" icon={<Brain className="w-3.5 h-3.5 text-[#9b59b6]" />}>
          <div className="text-center">
            <div className="text-3xl font-bold text-white">{total}</div>
            <div className="text-xs text-[#888] mt-1">条记忆</div>
          </div>
        </Card>

        <Card title="类别分布" icon={<Tag className="w-3.5 h-3.5 text-[#43b581]" />}>
          <div className="flex flex-wrap gap-2">
            {Object.entries(CATEGORY_COLORS).map(([cat, cfg]) => {
              const count = byCategory[cat] || 0
              if (count === 0) return null
              return (
                <span key={cat} className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${cfg.bg} ${cfg.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  {cfg.label}: {count}
                </span>
              )
            })}
            {Object.keys(byCategory).length === 0 && (
              <span className="text-sm text-[#888]">暂无分类数据</span>
            )}
          </div>
        </Card>

        <Card title="容量使用">
          <CapacityBar value={total} max={MEMORY_LIMIT} label="记忆容量" color="#9b59b6" />
        </Card>
      </div>

      {/* 类别容量条 */}
      <Card title="按类别统计" icon={<Tag className="w-3.5 h-3.5 text-[#faa61a]" />}>
        <div className="space-y-3">
          {Object.entries(CATEGORY_COLORS).map(([cat, cfg]) => {
            const count = byCategory[cat] || 0
            if (count === 0) return null
            return (
              <CapacityBar key={cat} value={count} max={total} label={cfg.label} color={cfg.dot.replace('bg-[', '').replace(']', '')} showValues={false} />
            )
          })}
          {Object.keys(byCategory).length === 0 && (
            <div className="text-sm text-[#888] text-center py-4">暂无记忆数据</div>
          )}
        </div>
      </Card>

      {/* 最近记忆条目 */}
      <Card title="最近记忆" icon={<Clock className="w-3.5 h-3.5 text-[#5865f2]" />}>
        <div className="space-y-2">
          {recentItems.map((item: any, i: number) => {
            const cfg = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.fact
            return (
              <div key={i} className="flex items-start gap-2 p-2 rounded bg-[#1e1e1e]">
                <span className={`shrink-0 mt-0.5 w-2 h-2 rounded-full ${cfg.dot}`} />
                <div className="flex-1 min-w-0">
                  <span className={`text-[11px] ${cfg.text}`}>{cfg.label}</span>
                  <p className="text-xs text-[#aaa] mt-0.5 line-clamp-2">{item.content}</p>
                </div>
                <span className="text-[10px] text-[#555] shrink-0">
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
              </div>
            )
          })}
          {recentItems.length === 0 && (
            <div className="text-sm text-[#888] text-center py-6">暂无记忆条目</div>
          )}
        </div>
      </Card>
    </div>
  )
}
