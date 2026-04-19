/**
 * CapacityBar — 容量条组件
 *
 * 可视化 value/max 比例，用于 token/memory 使用量展示
 */

interface CapacityBarProps {
  value: number
  max: number
  label: string
  color?: string
  showValues?: boolean
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function CapacityBar({ value, max, label, color = '#5865f2', showValues = true }: CapacityBarProps) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const barColor = pct > 90 ? '#f04747' : pct > 70 ? '#faa61a' : color

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[#aaa]">{label}</span>
        {showValues && (
          <span className="text-[#888] font-mono">
            {formatNum(value)} / {formatNum(max)}
          </span>
        )}
      </div>
      <div className="h-2.5 bg-[#1e1e1e] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
      <div className="text-right text-[10px] text-[#666]">{pct.toFixed(1)}%</div>
    </div>
  )
}
