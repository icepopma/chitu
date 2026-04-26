import { useState, useRef, useCallback } from 'react'
import { useChituSocket } from '../hooks/useChituSocket'
import { useAppStore } from '../lib/store'
import { Send, Square, Zap, ZapOff, Eye, ImageIcon, X } from 'lucide-react'

/** 上传图片到服务器，返回服务器相对路径 */
async function uploadImage(file: File): Promise<string> {
  const res = await fetch('http://localhost:8080/upload/image', {
    method: 'POST',
    headers: {
      'X-Filename': file.name,
      'X-Content-Type': file.type,
    },
    body: file,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '上传失败' }))
    throw new Error(err.error || '上传失败')
  }
  const data = await res.json()
  return data.path as string
}

interface PendingImage {
  /** 本地预览 URL（用于预览显示） */
  preview: string
  /** 服务器路径（上传完成后设置） */
  serverPath?: string
  /** 原始 File 对象 */
  file: File
  /** 上传状态 */
  uploading: boolean
}

export function ChatInput() {
  const [input, setInput] = useState('')
  const [autoMode, setAutoMode] = useState(false)
  const [reviewMode, setReviewMode] = useState(false)
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { sendMessage, interruptTurn } = useChituSocket()
  const { currentThreadId, turnStatus } = useAppStore()

  const isRunning = turnStatus === 'in_progress'
  const canSend = (input.trim() || pendingImages.length > 0) && currentThreadId && !isRunning

  /** 处理图片选择 */
  const handleImageSelect = useCallback(async (files: FileList | null) => {
    if (!files) return

    const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'])
    const maxSize = 10 * 1024 * 1024 // 10MB

    const newImages: PendingImage[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!allowedTypes.has(file.type)) continue
      if (file.size > maxSize) continue
      if (pendingImages.length + newImages.length >= 5) break // 最多 5 张

      const preview = URL.createObjectURL(file)
      const pending: PendingImage = { preview, file, uploading: true }
      newImages.push(pending)
    }

    if (newImages.length === 0) return
    setPendingImages(prev => [...prev, ...newImages])

    // 异步上传每张图片
    for (const img of newImages) {
      try {
        const serverPath = await uploadImage(img.file)
        setPendingImages(prev =>
          prev.map(p => p.preview === img.preview ? { ...p, serverPath, uploading: false } : p)
        )
      } catch {
        // 上传失败，移除该图片
        setPendingImages(prev => prev.filter(p => p.preview !== img.preview))
        URL.revokeObjectURL(img.preview)
      }
    }
  }, [pendingImages.length])

  /** 移除待发送的图片 */
  const removeImage = useCallback((preview: string) => {
    setPendingImages(prev => {
      const img = prev.find(p => p.preview === preview)
      if (img) URL.revokeObjectURL(img.preview)
      return prev.filter(p => p.preview !== preview)
    })
  }, [])

  const handleSend = useCallback(async () => {
    if (!currentThreadId) return
    if (!input.trim() && pendingImages.length === 0) return

    const msg = input
    const images = pendingImages
      .filter(img => img.serverPath)
      .map(img => img.serverPath!)

    setInput('')
    // 清理预览 URL
    for (const img of pendingImages) {
      URL.revokeObjectURL(img.preview)
    }
    setPendingImages([])
    // 重置 textarea 高度
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    try {
      await sendMessage(msg, autoMode || undefined, reviewMode ? 'review' : undefined, images.length > 0 ? images : undefined)
    } catch (err: any) {
      console.error('发送失败:', err.message)
    }
  }, [input, currentThreadId, sendMessage, autoMode, reviewMode, pendingImages])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) handleSend()
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 200) + 'px'
    }
  }

  /** 粘贴图片 */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData.files
    if (files.length > 0 && Array.from(files).some(f => f.type.startsWith('image/'))) {
      e.preventDefault()
      handleImageSelect(files)
    }
  }, [handleImageSelect])

  return (
    <div className="px-4 pb-4">
      {/* 图片预览条 */}
      {pendingImages.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {pendingImages.map(img => (
            <div key={img.preview} className="relative group">
              <img
                src={img.preview}
                alt="待发送"
                className="w-16 h-16 object-cover rounded-lg border border-[#3a3a3a]"
              />
              {img.uploading && (
                <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                </div>
              )}
              <button
                onClick={() => removeImage(img.preview)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#da373c] text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-[#2a2a2a] rounded-lg flex items-end gap-2 p-2">
        {/* 隐藏的 file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          multiple
          className="hidden"
          onChange={(e) => {
            handleImageSelect(e.target.files)
            e.target.value = '' // 重置以便重复选择同一文件
          }}
        />

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          placeholder={currentThreadId ? '输入消息... (可粘贴或上传图片)' : '请先新建一个对话'}
          disabled={!currentThreadId}
          rows={1}
          className="flex-1 bg-transparent text-white text-sm resize-none outline-none placeholder-[#888] disabled:opacity-50 max-h-[200px] py-1 px-2"
        />
        {/* 图片上传按钮 */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!currentThreadId || isRunning}
          className="p-2 rounded text-[#888] hover:text-white hover:bg-[#3a3a3a] transition-colors disabled:opacity-30"
          title="上传图片（最多 5 张，单张最大 10MB）"
        >
          <ImageIcon className="w-4 h-4" />
        </button>
        {/* Review 模式开关 */}
        <button
          onClick={() => setReviewMode(!reviewMode)}
          className={`p-2 rounded transition-colors ${reviewMode ? 'bg-[#3ba55c] text-white' : 'text-[#888] hover:text-white hover:bg-[#3a3a3a]'}`}
          title={reviewMode ? 'Review 模式已开启（只审查不修改）' : '开启 Review 模式'}
        >
          <Eye className="w-4 h-4" />
        </button>
        {/* 长任务模式开关 */}
        <button
          onClick={() => setAutoMode(!autoMode)}
          className={`p-2 rounded transition-colors ${autoMode ? 'bg-[#faa61a] text-[#1a1a1a]' : 'text-[#888] hover:text-white hover:bg-[#3a3a3a]'}`}
          title={autoMode ? '长任务模式已开启（自动批准 + 里程碑追踪）' : '开启长任务模式'}
        >
          {autoMode ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
        </button>
        {isRunning ? (
          <button
            onClick={interruptTurn}
            className="p-2 rounded bg-[#da373c] hover:bg-[#a12828] text-white transition-colors"
            title="停止"
          >
            <Square className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="p-2 rounded bg-[#5865f2] hover:bg-[#4752c4] text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="发送"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>
      {autoMode && (
        <div className="text-[11px] text-[#faa61a] mt-1 px-1">
          长任务模式：自动批准 + 里程碑追踪
        </div>
      )}
      {reviewMode && (
        <div className="text-[11px] text-[#3ba55c] mt-1 px-1">
          Review 模式：Agent 只审查代码，不会修改任何文件
        </div>
      )}
    </div>
  )
}
