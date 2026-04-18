import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, RefreshCw, Activity, Zap, Target, CheckCircle2, XCircle, AlertCircle, Circle, Clock, Hash, Cpu, MessageSquare } from 'lucide-react'

interface DashboardData {
  status: {
    uptime: number
    startedAt: number
    totalThreads: number
    totalTurns: number
    activeTurns: number
    totalTokens: number
    totalIterations: number
  }
  milestones: {
    total: number
    completed: number
    inProgress: number
    pending: number
    failed: number
    progressPct: number
    items: Array<{
      id: string
      title: string
      status: string
      scope: string
      keyFiles: string[]
      acceptanceCriteria: string[]
      verificationCommands: string[]
      notesCount: number
      decisionsCount: number
      recentNotes: string[]
      recentDecisions: string[]
    }>
  }
  recentEvents: Array<{ type: string; timestamp: string; data: any }>
  timestamp: number
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'bg-[#43b581]',
    in_progress: 'bg-[#faa61a]',
    pending: 'bg-[#72767d]',
    failed: 'bg-[#f04747]',
  }
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || 'bg-[#72767d]'}`} />
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    completed: { bg: 'bg-[#43b581]/15', text: 'text-[#43b581]' },
    in_progress: { bg: 'bg-[#faa61a]/15', text: 'text-[#faa61a]' },
    pending: { bg: 'bg-[#72767d]/15', text: 'text-[#72767d]' },
    failed: { bg: 'bg-[#f04747]/15', text: 'text-[#f04747]' },
  }
  const c = config[status] || config.pending
  const labels: Record<string, string> = { completed: '已完成', in_progress: '进行中', pending: '待处理', failed: '失败' }
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>
      <StatusDot status={status} />
      {labels[status] || status}
    </span>
  )
}

function ProgressBar({ value, max, color = '#43b581' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
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
      <div className="p-4">
        {children}
      </div>
    </div>
  )
}

function StatBlock({ value, label, icon }: { value: string | number; label: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-xl font-bold text-white">{value}</span>
      </div>
      <span className="text-[11px] text-[#888]">{label}</span>
    </div>
  )
}

function ServerInfo({ data }: { data: DashboardData }) {
  const { status } = data
  return (
    <Card title="服务器信息" icon={<Cpu className="w-3.5 h-3.5 text-[#5865f2]" />}>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-[#888]">模型</span>
          <span className="text-white">GLM-5 / 智谱AI</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#888]">运行时长</span>
          <span className="text-white font-mono">{formatUptime(status.uptime)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#888]">启动时间</span>
          <span className="text-white text-xs">{new Date(status.startedAt).toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#888]">类型</span>
          <span className="text-white">自主编程 Agent</span>
        </div>
      </div>
    </Card>
  )
}

function MetricsOverview({ data }: { data: DashboardData }) {
  const { status } = data
  return (
    <Card title="运行指标" icon={<Zap className="w-3.5 h-3.5 text-[#faa61a]" />}>
      <div className="grid grid-cols-2 gap-4">
        <StatBlock value={status.totalTurns} label="Turns" icon={<MessageSquare className="w-4 h-4 text-[#5865f2]" />} />
        <StatBlock value={formatTokens(status.totalTokens)} label="Tokens" icon={<Hash className="w-4 h-4 text-[#43b581]" />} />
        <StatBlock value={status.totalIterations} label="迭代次数" icon={<RefreshCw className="w-4 h-4 text-[#faa61a]" />} />
        <StatBlock value={formatUptime(status.uptime)} label="运行时长" icon={<Clock className="w-4 h-4 text-[#888]" />} />
      </div>
    </Card>
  )
}

function MilestoneProgress({ data }: { data: DashboardData }) {
  const { milestones } = data
  return (
    <Card title="里程碑进度" icon={<Target className="w-3.5 h-3.5 text-[#5865f2]" />} className="col-span-2">
      <div className="space-y-3">
        <div className="flex items-center gap-4">
          <span className="text-2xl font-bold text-white">{milestones.progressPct}%</span>
          <div className="flex-1">
            <ProgressBar value={milestones.completed} max={milestones.total} />
          </div>
          <span className="text-sm text-[#888]">{milestones.completed} / {milestones.total}</span>
        </div>
        <div className="flex gap-4 text-sm">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#43b581]" />{milestones.completed} 已完成</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#faa61a]" />{milestones.inProgress} 进行中</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#72767d]" />{milestones.pending} 待处理</span>
          {milestones.failed > 0 && (
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#f04747]" />{milestones.failed} 失败</span>
          )}
        </div>
      </div>
    </Card>
  )
}

function MilestoneList({ data }: { data: DashboardData }) {
  const { milestones } = data
  return (
    <Card title="里程碑列表" className="col-span-2">
      <div className="space-y-2 max-h-[480px] overflow-y-auto">
        {milestones.items.map(m => (
          <div key={m.id} className="flex items-start gap-3 p-3 rounded bg-[#1e1e1e] hover:bg-[#252525] transition-colors">
            <StatusDot status={m.status} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-[#5865f2]">{m.id}</span>
                <span className="text-sm text-white font-medium truncate">{m.title}</span>
              </div>
              <p className="text-xs text-[#888] mt-0.5 line-clamp-2">{m.scope}</p>
              {(m.notesCount > 0 || m.decisionsCount > 0) && (
                <div className="flex gap-3 text-[11px] text-[#666] mt-1">
                  {m.notesCount > 0 && <span>{m.notesCount} 条笔记</span>}
                  {m.decisionsCount > 0 && <span>{m.decisionsCount} 个决策</span>}
                </div>
              )}
              {m.recentDecisions.length > 0 && (
                <div className="mt-1.5 pl-3 border-l-2 border-[#5865f2]/40 space-y-0.5">
                  {m.recentDecisions.map((d, i) => (
                    <div key={i} className="text-xs text-[#faa61a]">{d}</div>
                  ))}
                </div>
              )}
            </div>
            <StatusBadge status={m.status} />
          </div>
        ))}
        {milestones.items.length === 0 && (
          <div className="text-sm text-[#888] text-center py-8">未找到 plans.md</div>
        )}
      </div>
    </Card>
  )
}

function ActivityFeed({ data }: { data: DashboardData }) {
  const events = data.recentEvents
  return (
    <Card title="活动记录" icon={<Activity className="w-3.5 h-3.5 text-[#43b581]" />}>
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {events.slice(-20).reverse().map((evt, i) => (
          <div key={i} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-[#1e1e1e] text-xs">
            <span className="text-[#5865f2]">
              {evt.type.includes('thread') ? '◉' :
               evt.type.includes('turn') ? '▶' :
               evt.type.includes('delta') ? '·' :
               evt.type.includes('plan') ? '◆' : '◇'}
            </span>
            <span className="text-[#888] font-mono">{evt.type}</span>
          </div>
        ))}
        {events.length === 0 && (
          <div className="text-sm text-[#888] text-center py-8">暂无活动记录</div>
        )}
      </div>
    </Card>
  )
}

export function DashboardPage({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:8080/dashboard')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  return (
    <div className="h-screen flex flex-col bg-[#1a1a1a]">
      {/* 顶部栏 — 和主页面 ChatArea 的 header 一致 */}
      <div className="h-12 flex items-center px-4 border-b border-[#2a2a2a] shrink-0 bg-[#1e1e1e]">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[#888] hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" />
          <span>返回</span>
        </button>
        <span className="mx-3 text-[#333]">|</span>
        <span className="text-base font-semibold text-white">监控面板</span>
        <div className="ml-auto flex items-center gap-3">
          {data && (
            <span className="text-xs text-[#888]">
              {new Date(data.timestamp).toLocaleTimeString()} 更新
            </span>
          )}
          <button onClick={fetchData} className="text-[#888] hover:text-white transition-colors" title="刷新">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="bg-[#f04747]/10 border border-[#f04747]/30 rounded-lg p-4 mb-4 text-center">
            <AlertCircle className="w-5 h-5 text-[#f04747] inline-block mr-2" />
            <span className="text-[#f04747] text-sm">连接失败: {error}</span>
            <div className="text-xs text-[#888] mt-1">请确认 Chitu 服务器正在 8080 端口运行</div>
          </div>
        )}

        {!data && !error && (
          <div className="flex items-center justify-center h-64 text-[#888] text-sm">
            加载中...
          </div>
        )}

        {data && (
          <div className="max-w-[1100px] mx-auto space-y-4">
            {/* 第一行：服务器信息 + 运行指标 */}
            <div className="grid grid-cols-2 gap-4">
              <ServerInfo data={data} />
              <MetricsOverview data={data} />
            </div>

            {/* 第二行：里程碑进度 */}
            <MilestoneProgress data={data} />

            {/* 第三行：里程碑列表 + 活动记录 */}
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <MilestoneList data={data} />
              </div>
              <ActivityFeed data={data} />
            </div>
          </div>
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="h-8 flex items-center justify-between px-4 text-[11px] border-t border-[#2a2a2a] bg-[#1e1e1e] shrink-0 text-[#888]">
        <span>赤兔监控 v0.1.0</span>
        <span className="flex items-center gap-1.5">
          {data ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#43b581]" />
              已连接
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#f04747]" />
              未连接
            </>
          )}
        </span>
      </div>
    </div>
  )
}
