import { useState } from 'react'
import { ChatArea } from './ChatArea'
import { ChatInput } from './ChatInput'
import { Sidebar } from './Sidebar'
import { DashboardPage } from './DashboardPage'

export function Layout() {
  const [showDashboard, setShowDashboard] = useState(false)

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
