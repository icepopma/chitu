/**
 * Sparkline — 迷你折线图组件
 *
 * 纯 SVG 实现，无外部依赖
 * 用于展示每日活动趋势
 */

interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
  label?: string
}

export function Sparkline({ data, width = 240, height = 60, color = '#5865f2', label }: SparklineProps) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center text-xs text-[#666]" style={{ width, height }}>
        数据不足
      </div>
    )
  }

  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const padding = 4

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2)
    const y = height - padding - ((v - min) / range) * (height - padding * 2)
    return `${x},${y}`
  })

  const pathD = `M${points.join(' L')}`
  const areaD = `${pathD} L${padding + ((data.length - 1) / (data.length - 1)) * (width - padding * 2)},${height - padding} L${padding},${height - padding} Z`

  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-[11px] text-[#888]">{label}</span>}
      <svg width={width} height={height} className="overflow-visible">
        <defs>
          <linearGradient id={`grad-${label || 'default'}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#grad-${label || 'default'})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((v, i) => {
          const x = padding + (i / (data.length - 1)) * (width - padding * 2)
          const y = height - padding - ((v - min) / range) * (height - padding * 2)
          return <circle key={i} cx={x} cy={y} r="2" fill={color} opacity={i === data.length - 1 ? 1 : 0.4} />
        })}
      </svg>
    </div>
  )
}
