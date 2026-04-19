/**
 * DashboardPage — 增强监控面板
 *
 * M15: 对标 Hermes HUD
 * Tab 导航：总览 / Token 成本 / 记忆 / 工具使用
 * 保持 Discord 风格 UI 一致性
 */

import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, RefreshCw, Activity, AlertCircle, LayoutDashboard, DollarSign, Brain, Wrench } from 'lucide-react'
import { OverviewTab } from './dashboard/OverviewTab'
import { TokenCostTab } from './dashboard/TokenCostTab'
import { MemoryTab } from './dashboard/MemoryTab'
import { ToolUsageTab } from './dashboard/ToolUsageTab'

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
      startedAt?: number
      completedAt?: number
      durationMs?: number
    }>
  }
  timing?: {
    taskStartedAt?: number
    taskDurationMs?: number
    hasActive: boolean
  }
  recentEvents: Array<{ type: string; timestamp: number | string; data: any }>
  analytics?: {
    toolUsage: Array<{ name: string; count: number; lastUsed: number }>
    dailyActivity: Array<{ date: string; messages: number; turns: number; toolCalls: number }>
    memory: {
      total: number
      byCategory: Record<string, number>
      recentItems: Array<{ category: string; content: string; createdAt: number }>
    }
    tokenCost: {
      totalTokens: number
      estimatedCostUsd: number
      byDay: Array<{ date: string; tokens: number; costUsd: number }>
    }
  }
  timestamp: number
}

type TabId = 'overview' | 'tokens' | 'memory' | 'tools'

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: '总览', icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
  { id: 'tokens', label: 'Token 成本', icon: <DollarSign className="w-3.5 h-3.5" /> },
  { id: 'memory', label: '记忆', icon: <Brain className="w-3.5 h-3.5" /> },
  { id: 'tools', label: '工具使用', icon: <Wrench className="w-3.5 h-3.5" /> },
]

export function DashboardPage({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('overview')

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
    const interval = setInterval(fetchData, 2000)
    return () => clearInterval(interval)
  }, [fetchData])

  return (
    <div className="h-screen flex flex-col bg-[#1a1a1a]">
      {/* 顶部栏 */}
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

      {/* Tab 导航 */}
      <div className="flex items-center gap-0 px-4 border-b border-[#2a2a2a] bg-[#1e1e1e]">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'text-[#5865f2] border-[#5865f2]'
                : 'text-[#888] border-transparent hover:text-white hover:border-[#555]'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
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
          <div className="max-w-[1100px] mx-auto">
            {activeTab === 'overview' && <OverviewTab data={data} />}
            {activeTab === 'tokens' && <TokenCostTab data={data} />}
            {activeTab === 'memory' && <MemoryTab data={data} />}
            {activeTab === 'tools' && <ToolUsageTab data={data} />}
          </div>
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="h-8 flex items-center justify-between px-4 text-[11px] border-t border-[#2a2a2a] bg-[#1e1e1e] shrink-0 text-[#888]">
        <span>赤兔监控 v0.2.0</span>
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
