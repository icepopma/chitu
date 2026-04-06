/**
 * ApprovalBanner — 审批横幅
 *
 * 当 Agent 需要执行高风险命令时，显示此横幅让用户审批。
 * 显示命令内容、风险等级，提供"允许"和"拒绝"按钮。
 */

import { useAppStore } from '../lib/store'
import { ShieldAlert, ShieldCheck, ShieldQuestion, Check, X } from 'lucide-react'
import { useChituSocket } from '../hooks/useChituSocket'

const riskConfig = {
  read: { icon: ShieldCheck, color: 'text-[#43b581]', bg: 'bg-[#1a3a2a]', border: 'border-[#2a5a3a]', label: '只读' },
  write: { icon: ShieldQuestion, color: 'text-[#faa61a]', bg: 'bg-[#3a2a1a]', border: 'border-[#5a3a1a]', label: '写入' },
  dangerous: { icon: ShieldAlert, color: 'text-[#da373c]', bg: 'bg-[#3a1a1a]', border: 'border-[#5a1a1a]', label: '危险' },
} as const

export function ApprovalBanner() {
  const { pendingApproval, setPendingApproval } = useAppStore()
  const { respondApproval } = useChituSocket()

  if (!pendingApproval) return null

  const { id, command, riskLevel, toolName } = pendingApproval
  const config = riskConfig[riskLevel] || riskConfig.write
  const Icon = config.icon

  const handleApprove = async () => {
    await respondApproval(id, true)
    setPendingApproval(null)
  }

  const handleReject = async () => {
    await respondApproval(id, false)
    setPendingApproval(null)
  }

  return (
    <div className={`mx-4 my-2 rounded-lg border ${config.border} ${config.bg} p-3`}>
      {/* 标题 */}
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${config.color}`} />
        <span className={`text-sm font-medium ${config.color}`}>
          审批请求 · {config.label}
        </span>
        <span className="text-xs text-[#666] ml-auto">
          {toolName}
        </span>
      </div>

      {/* 命令内容 */}
      <div className="bg-[#111] rounded px-3 py-2 mb-3 font-mono text-xs text-[#ccc] break-all max-h-24 overflow-y-auto">
        {command}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2 justify-end">
        <button
          onClick={handleReject}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
            bg-[#2a2a2a] text-[#888] hover:bg-[#3a1a1a] hover:text-[#da373c]
            transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          拒绝
        </button>
        <button
          onClick={handleApprove}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
            bg-[#5865f2] text-white hover:bg-[#4752c4]
            transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
          允许执行
        </button>
      </div>
    </div>
  )
}
