import { useState, useEffect } from 'react'
import { ChatArea } from './ChatArea'
import { ChatInput } from './ChatInput'
import { Sidebar } from './Sidebar'
import { DashboardPage } from './DashboardPage'
import { useAppStore } from '../lib/store'

export function Layout() {
  const [showDashboard, setShowDashboard] = useState(false)
  const setToken = useAppStore((s) => s.setToken)
  const [authResolved, setAuthResolved] = useState(false)

  // Restore session from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('chitu_token')
    if (stored) {
      setToken(stored)
    } else {
      // Check for guest session
      const guestUser = localStorage.getItem('chitu_guest')
      if (guestUser) {
        try {
          useAppStore.getState().setUser(JSON.parse(guestUser))
        } catch {}
      }
    }
    setAuthResolved(true)
  }, [])

  if (!authResolved) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-[#1a1a1a]">
        <div className="text-[#a0a0a0] text-sm">加载中...</div>
      </div>
    )
  }

  if (showDashboard) {
    return <DashboardPage onBack={() => setShowDashboard(false)} />
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar onShowDashboard={() => setShowDashboard(true)} />
      <div className="flex-1 flex flex-col min-w-0 bg-[#1a1a1a]">
        <ChatArea />
        <ChatInput />
      </div>
    </div>
  )
}
