import { useState } from 'react'
import { useChituSocket } from '../hooks/useChituSocket'
import { useAppStore } from '../lib/store'
import { LogOut, User, ChevronDown, ChevronUp } from 'lucide-react'

export function UserPanel() {
  const { user, isAuthenticated, logout } = useAppStore()
  const { login, register } = useChituSocket()
  const setUser = useAppStore((s) => s.setUser)

  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        if (password.length < 6) {
          setError('密码至少 6 位')
          setLoading(false)
          return
        }
        await register(email, password, displayName || undefined)
      }
      setExpanded(false)
    } catch (err: any) {
      setError(err.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSkip = () => {
    setUser({ id: 'guest', email: '', displayName: '访客', createdAt: Date.now(), updatedAt: Date.now() })
    setExpanded(false)
  }

  const handleLogout = () => {
    logout()
    setExpanded(false)
  }

  // Authenticated: show user info
  if (isAuthenticated && user) {
    return (
      <div className="border-t border-[#2a2a2a]">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[#2a2a2a] transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-[#5865f2] flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-white">
              {user.displayName?.[0]?.toUpperCase() || 'U'}
            </span>
          </div>
          <span className="flex-1 text-sm text-[#ccc] truncate text-left">
            {user.displayName || user.email || '用户'}
          </span>
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#888]" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 text-[#888]" />
          )}
        </button>

        {expanded && (
          <div className="px-3 pb-2 space-y-1">
            <div className="text-xs text-[#888] px-1 truncate">{user.email || '未设置邮箱'}</div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[#888] hover:text-red-400 hover:bg-[#2a2a2a] transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              退出登录
            </button>
          </div>
        )}
      </div>
    )
  }

  // Not authenticated: compact login area
  return (
    <div className="border-t border-[#2a2a2a]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[#2a2a2a] transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-[#4a4a4a] flex items-center justify-center shrink-0">
          <User className="w-3.5 h-3.5 text-[#888]" />
        </div>
        <span className="flex-1 text-sm text-[#888] text-left">未登录</span>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-[#888]" />
        ) : (
          <ChevronUp className="w-3.5 h-3.5 text-[#888]" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          {/* Login/Register tabs */}
          <div className="flex mb-3 border-b border-[#3a3a3a]">
            <button
              className={`flex-1 pb-1.5 text-xs font-medium transition-colors ${
                mode === 'login'
                  ? 'text-[#5865f2] border-b border-[#5865f2]'
                  : 'text-[#888] hover:text-white'
              }`}
              onClick={() => { setMode('login'); setError('') }}
            >
              登录
            </button>
            <button
              className={`flex-1 pb-1.5 text-xs font-medium transition-colors ${
                mode === 'register'
                  ? 'text-[#5865f2] border-b border-[#5865f2]'
                  : 'text-[#888] hover:text-white'
              }`}
              onClick={() => { setMode('register'); setError('') }}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-2">
            {mode === 'register' && (
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-[#3a3a3a] rounded px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-[#5865f2] transition-colors"
                placeholder="显示名称（可选）"
              />
            )}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#3a3a3a] rounded px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-[#5865f2] transition-colors"
              placeholder="邮箱"
              required
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#3a3a3a] rounded px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-[#5865f2] transition-colors"
              placeholder="密码"
              required
              minLength={6}
            />

            {error && (
              <div className="text-red-400 text-[10px] bg-red-400/10 rounded px-2 py-1">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full bg-[#5865f2] hover:bg-[#4752c4] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-1.5 rounded text-xs transition-colors"
            >
              {loading ? '处理中...' : mode === 'login' ? '登录' : '注册'}
            </button>
          </form>

          <button
            onClick={handleSkip}
            className="w-full mt-2 text-[#666] hover:text-[#999] text-[10px] transition-colors text-center"
          >
            跳过登录，直接使用
          </button>
        </div>
      )}
    </div>
  )
}
