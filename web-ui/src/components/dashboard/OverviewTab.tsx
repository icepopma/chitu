/**
 * OverviewTab — 总览面板
 *
 * 服务器信息 + 运行指标 + 里程碑进度 + 里程碑列表 + 活动记录 + 每日活动 Sparkline
 */

import { Cpu, Zap, Hash, RefreshCw, Clock, MessageSquare, Target, Activity, CheckCircle2, Circle, Loader2, XCircle, Layers } from 'lucide-react'
import { Sparkline } from './Sparkline'

interface OverviewTabProps {
  data: any
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

const statusConfig: Record<string, { icon: typeof Circle; className: string; label: string }> = {
  completed: { icon: CheckCircle2, className: 'text-[#43b581]', label: '已完成' },
  in_progress: { icon: Loader2, className: 'text-[#faa61a] animate-spin', label: '进行中' },
  pending: { icon: Circle, className: 'text-[#666]', label: '待处理' },
  failed: { icon: XCircle, className: 'text-[#ed4245]', label: '失败' },
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'bg-[#43b581]', in_progress: 'bg-[#faa61a]', pending: 'bg-[#72767d]', failed: 'bg-[#f04747]',
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

function MilestoneList({ milestones }: { milestones: any[] }) {
  return (
    <Card title="里程碑列表" className="col-span-2">
      <div className="space-y-2 max-h-[480px] overflow-y-auto">
        {milestones.map((m: any) => (
          <div key={m.id} className="flex items-start gap-3 p-3 rounded bg-[#1e1e1e] hover:bg-[#252525] transition-colors">
            <StatusDot status={m.status} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-[#5865f2]">{m.id}</span>
                <span className="text-sm text-white font-medium truncate">{m.title}</span>
                {m.durationMs != null && (
                  <span className="text-[11px] font-mono text-[#888] shrink-0">{formatUptime(m.durationMs)}</span>
                )}
              </div>
              <p className="text-xs text-[#888] mt-0.5 line-clamp-2">{m.scope}</p>
              {(m.notesCount > 0 || m.decisionsCount > 0) && (
                <div className="flex gap-3 text-[11px] text-[#666] mt-1">
                  {m.notesCount > 0 && <span>{m.notesCount} 条笔记</span>}
                  {m.decisionsCount > 0 && <span>{m.decisionsCount} 个决策</span>}
                </div>
              )}
              {m.recentDecisions?.length > 0 && (
                <div className="mt-1.5 pl-3 border-l-2 border-[#5865f2]/40 space-y-0.5">
                  {m.recentDecisions.map((d: string, i: number) => (
                    <div key={i} className="text-xs text-[#faa61a]">{d}</div>
                  ))}
                </div>
              )}
            </div>
            <StatusBadge status={m.status} />
          </div>
        ))}
        {milestones.length === 0 && (
          <div className="text-sm text-[#888] text-center py-8">未找到 plans.md</div>
        )}
      </div>
    </Card>
  )
}

function ActivityFeed({ events }: { events: any[] }) {
  return (
    <Card title="活动记录" icon={<Activity className="w-3.5 h-3.5 text-[#43b581]" />}>
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {events.slice(-30).reverse().map((evt: any, i: number) => {
          const ts = evt.timestamp ? new Date(typeof evt.timestamp === 'number' ? evt.timestamp : evt.timestamp) : null
          const timeStr = ts && !isNaN(ts.getTime()) ? ts.toLocaleTimeString() : ''
          const summary = (() => {
            const d = evt.data
            if (!d) return ''
            if (evt.type === 'item/completed' || evt.type === 'item/started') {
              const item = d.item
              if (!item) return ''
              if (item.type === 'tool_call') {
                try {
                  const c = typeof item.content === 'string' ? JSON.parse(item.content) : item.content
                  if (Array.isArray(c) && c[0]?.function) return c[0].function.name
                } catch {}
                return 'tool_call'
              }
              if (item.type === 'assistant_message') return item.content ? String(item.content).slice(0, 60) + (String(item.content).length > 60 ? '...' : '') : ''
              if (item.type === 'tool_result') return 'result'
              if (item.type === 'user_message') return 'user'
              return item.type
            }
            if (evt.type === 'turn/started') return '▶ turn started'
            if (evt.type === 'turn/completed') return `✓ ${d.turn?.status || 'completed'}`
            if (evt.type === 'plan/updated') return `plan: ${d.plan?.filter((s: any) => s.status === 'in_progress').length || 0} active`
            return ''
          })()

          return (
            <div key={i} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-[#1e1e1e] text-xs">
              <span className="text-[#5865f2]">
                {evt.type.includes('thread') ? '◉' :
                 evt.type.includes('turn') ? '▶' :
                 evt.type.includes('delta') ? '·' :
                 evt.type.includes('plan') ? '◆' : '◇'}
              </span>
              <span className="text-[#888] font-mono w-24 shrink-0">{evt.type}</span>
              {summary && <span className="text-[#666] truncate flex-1">{summary}</span>}
              {timeStr && <span className="text-[#555] font-mono shrink-0">{timeStr}</span>}
            </div>
          )
        })}
        {events.length === 0 && (
          <div className="text-sm text-[#888] text-center py-8">暂无活动记录</div>
        )}
      </div>
    </Card>
  )
}

export function OverviewTab({ data }: OverviewTabProps) {
  const { status, milestones, timing, analytics, recentEvents } = data

  const dailyMessages = analytics?.dailyActivity?.map((d: any) => d.messages) || []
  const dailyTurns = analytics?.dailyActivity?.map((d: any) => d.turns) || []



  return (
    <div className="space-y-4">
      {/* 第一行：服务器 + 运行指标 + 任务时长 */}
      <div className="grid grid-cols-3 gap-4">
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

        <Card title="运行指标" icon={<Zap className="w-3.5 h-3.5 text-[#faa61a]" />}>
          <div className="grid grid-cols-2 gap-4">
            <StatBlock value={status.totalThreads} label="Threads" icon={<Layers className="w-4 h-4 text-[#5865f2]" />} />
            <StatBlock value={status.totalTurns} label="Turns" icon={<MessageSquare className="w-4 h-4 text-[#5865f2]" />} />
            <StatBlock value={formatTokens(status.totalTokens)} label="Tokens" icon={<Hash className="w-4 h-4 text-[#43b581]" />} />
            <StatBlock value={status.totalIterations} label="迭代次数" icon={<RefreshCw className="w-4 h-4 text-[#faa61a]" />} />
          </div>
        </Card>

        <Card title="任务时长" icon={<Clock className="w-3.5 h-3.5 text-[#5865f2]" />}>
          {timing?.taskStartedAt ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#888]">任务开始</span>
                <span className="text-white text-xs">{new Date(timing.taskStartedAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#888]">已用时间</span>
                <span className="text-white font-mono font-bold">{timing.taskDurationMs ? formatUptime(timing.taskDurationMs) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#888]">状态</span>
                <span className={timing.hasActive ? 'text-[#faa61a]' : 'text-[#43b581]'}>
                  {timing.hasActive ? '运行中...' : '已暂停'}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-[#888] text-center py-4">尚未开始任务</div>
          )}
        </Card>
      </div>

      {/* 第二行：里程碑进度 */}
      <Card title="里程碑进度" icon={<Target className="w-3.5 h-3.5 text-[#5865f2]" />} className="col-span-3">
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <span className="text-2xl font-bold text-white">{milestones.progressPct}%</span>
            <div className="flex-1">
              <div className="h-2 bg-[#1e1e1e] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${milestones.progressPct}%`, background: '#43b581' }} />
              </div>
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

      {/* 第三行：每日活动趋势 */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="每日消息趋势" icon={<MessageSquare className="w-3.5 h-3.5 text-[#43b581]" />}>
          {dailyMessages.length >= 2 ? (
            <Sparkline data={dailyMessages} width={400} height={100} color="#43b581" showValues />
          ) : (
            <div className="text-sm text-[#888] text-center py-4">数据不足，至少需要 2 天</div>
          )}
        </Card>
        <Card title="每日 Turn 趋势" icon={<RefreshCw className="w-3.5 h-3.5 text-[#5865f2]" />}>
          {dailyTurns.length >= 2 ? (
            <Sparkline data={dailyTurns} width={400} height={100} color="#5865f2" showValues />
          ) : (
            <div className="text-sm text-[#888] text-center py-4">数据不足，至少需要 2 天</div>
          )}
        </Card>
      </div>

      {/* 第四行：里程碑列表 + 活动记录 */}
      <div className="grid grid-cols-3 gap-4">
        <MilestoneList milestones={milestones.items} />
        <ActivityFeed events={recentEvents} />
      </div>
    </div>
  )
}
