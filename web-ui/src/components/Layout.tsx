import { ChatArea } from './ChatArea'
import { ChatInput } from './ChatInput'
import { Sidebar } from './Sidebar'

export function Layout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 bg-[#1a1a1a]">
        <ChatArea />
        <ChatInput />
      </div>
    </div>
  )
}
