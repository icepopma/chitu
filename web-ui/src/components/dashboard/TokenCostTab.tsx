/**
 * TokenCostTab — Token 成本面板
 *
 * Token 使用量按天统计 + 成本估算 + CapacityBar 可视化
 */

import { Hash, DollarSign, TrendingUp } from 'lucide-react'
import { CapacityBar } from './CapacityBar'
import { Sparkline } from './Sparkline'

interface TokenCostTabProps {
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

export function TokenCostTab({ data }: TokenCostTabProps) {
  const tokenCost = data.analytics?.tokenCost || { totalTokens: 0, estimatedCostUsd: 0, byDay: [] }
  const { totalTokens, estimatedCostUsd, byDay } = tokenCost

  const dailyTokens = byDay.map((d: any) => d.tokens)
  const dailyCost = byDay.map((d: any) => d.costUsd)
  const dailyLabels = byDay.map((d: any) => d.date)

  const maxDailyTokens = byDay.length > 0 ? Math.max(...dailyTokens) : 0
  const TOKEN_LIMIT = 1_000_000

  return (
    <div className="space-y-4">
      {/* 摘要卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <Card title="总 Token 消耗" icon={<Hash className="w-3.5 h-3.5 text-[#5865f2]" />}>
          <div className="text-center">
            <div className="text-3xl font-bold text-white">
              {totalTokens >= 1_000_000 ? `${(totalTokens / 1_000_000).toFixed(2)}M` :
               totalTokens >= 1_000 ? `${(totalTokens / 1_000).toFixed(1)}K` :
               String(totalTokens)}
            </div>
            <div className="text-xs text-[#888] mt-1">累计 Token</div>
          </div>
        </Card>

        <Card title="估算成本" icon={<DollarSign className="w-3.5 h-3.5 text-[#43b581]" />}>
          <div className="text-center">
            <div className="text-3xl font-bold text-[#43b581]">
              ${estimatedCostUsd.toFixed(4)}
            </div>
            <div className="text-xs text-[#888] mt-1">基于 GLM-5 定价估算</div>
          </div>
        </Card>

        <Card title="日均消耗" icon={<TrendingUp className="w-3.5 h-3.5 text-[#faa61a]" />}>
          <div className="text-center">
            <div className="text-3xl font-bold text-[#faa61a]">
              {byDay.length > 0
                ? (totalTokens / byDay.length >= 1_000
                  ? `${(totalTokens / byDay.length / 1_000).toFixed(1)}K`
                  : Math.round(totalTokens / byDay.length))
                : '—'}
            </div>
            <div className="text-xs text-[#888] mt-1">Token / 天</div>
          </div>
        </Card>
      </div>

      {/* 每日 Token 趋势 */}
      <Card title="每日 Token 消耗趋势" icon={<Hash className="w-3.5 h-3.5 text-[#5865f2]" />}>
        {dailyTokens.length >= 2 ? (
          <div>
            <Sparkline data={dailyTokens} width={800} height={100} color="#5865f2" />
            <div className="flex justify-between text-[10px] text-[#555] mt-1">
              <span>{dailyLabels[0]}</span>
              <span>{dailyLabels[dailyLabels.length - 1]}</span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-[#888] text-center py-6">数据不足，至少需要 2 天</div>
        )}
      </Card>

      {/* 每日成本趋势 */}
      <Card title="每日成本趋势 (USD)" icon={<DollarSign className="w-3.5 h-3.5 text-[#43b581]" />}>
        {dailyCost.length >= 2 ? (
          <div>
            <Sparkline data={dailyCost} width={800} height={80} color="#43b581" />
            <div className="flex justify-between text-[10px] text-[#555] mt-1">
              <span>{dailyLabels[0]}</span>
              <span>{dailyLabels[dailyLabels.length - 1]}</span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-[#888] text-center py-6">数据不足，至少需要 2 天</div>
        )}
      </Card>

      {/* 容量条 */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Token 预算使用">
          <CapacityBar value={totalTokens} max={TOKEN_LIMIT} label="Token 消耗 / 1M 预算" color="#5865f2" />
        </Card>
        <Card title="每日峰值">
          <CapacityBar value={maxDailyTokens} max={Math.max(maxDailyTokens * 2, 10000)} label="最高日消耗 vs 2x 均值" color="#faa61a" />
        </Card>
      </div>
    </div>
  )
}
