import { useAppStore } from '../lib/store'
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import type { PlanStep, StepStatus } from '../types'

const statusConfig: Record<StepStatus, { icon: typeof Circle; className: string; label: string }> = {
  completed: { icon: CheckCircle2, className: 'text-[#43b581]', label: '已完成' },
  in_progress: { icon: Loader2, className: 'text-[#5865f2] animate-spin', label: '进行中' },
  pending: { icon: Circle, className: 'text-[#666]', label: '待处理' },
  failed: { icon: XCircle, className: 'text-[#ed4245]', label: '失败' },
}

export function PlanPanel() {
  const currentPlan = useAppStore((s) => s.currentPlan)

  if (!currentPlan || currentPlan.length === 0) return null

  const completed = currentPlan.filter((s) => s.status === 'completed').length
  const allCompleted = completed === currentPlan.length
  const progressPct = Math.round((completed / currentPlan.length) * 100)

  return (
    <div className={`mx-4 mt-3 mb-1 rounded-lg border ${allCompleted ? 'border-[#2a2a2a] bg-[#1e1e1e]' : 'border-[#3b4f8a] bg-[#1a1e3a]'} transition-all`}>
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-medium text-[#8b9cf7]">执行计划</span>
          <span className="text-[10px] text-[#666]">
            {completed}/{currentPlan.length} ({progressPct}%)
          </span>
        </div>
        <div className="space-y-1 max-h-64 overflow-y-auto scrollbar-thin">
          {currentPlan.map((step: PlanStep, i: number) => {
            const config = statusConfig[step.status]
            const Icon = config.icon
            return (
              <div key={i} className="flex items-center gap-2">
                <Icon className={`w-3.5 h-3.5 shrink-0 ${config.className}`} />
                <span className={`text-xs ${
                  step.status === 'completed' ? 'text-[#888] line-through' :
                  step.status === 'in_progress' ? 'text-white font-medium' :
                  step.status === 'failed' ? 'text-[#ed4245]' :
                  'text-[#aaa]'
                }`}>
                  {step.step}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
