/**
 * 图片上传模块
 *
 * M21: 多模态支持
 * - 接收前端上传的图片（HTTP POST multipart/form-data）
 * - 保存到 chitu-data/uploads/ 目录
 * - 返回可访问的 URL 路径
 *
 * 学习重点：
 * - Node.js 原生 HTTP 处理 multipart 数据（无需 busboy 等外部库）
 * - base64 内联 vs 文件存储的 trade-off
 */

import { createWriteStream, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join, extname } from 'path'
import { randomUUID } from 'crypto'
import { type IncomingMessage, type ServerResponse } from 'http'

/** 上传结果 */
export interface UploadResult {
  /** 文件名 */
  filename: string
  /** 相对路径（用于存储到 Item.images） */
  path: string
  /** 文件大小（字节） */
  size: number
  /** MIME 类型 */
  mimeType: string
}

/** 上传目录（相对于项目根目录） */
const UPLOAD_DIR = 'chitu-data/uploads'

/** 允许的图片 MIME 类型 */
const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

/** 最大文件大小：10MB */
const MAX_SIZE = 10 * 1024 * 1024

/** 确保上传目录存在 */
export function ensureUploadDir(baseDir?: string): string {
  const dir = baseDir ? join(baseDir, UPLOAD_DIR) : UPLOAD_DIR
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 从 HTTP request 解析 multipart/form-data
 *
 * 简化实现：手动解析 boundary，提取文件数据
 * 不引入 busboy/formidable 等外部依赖
 */
export function parseMultipartUpload(
  req: IncomingMessage,
  uploadDir: string,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || ''

    // 支持两种上传方式：
    // 1. multipart/form-data（标准文件上传）
    // 2. application/octet-stream（直接二进制，X-Filename header 指定文件名）

    if (contentType.startsWith('application/octet-stream')) {
      return handleOctetStream(req, uploadDir).then(resolve, reject)
    }

    if (!contentType.startsWith('multipart/form-data')) {
      return reject(new Error('Content-Type must be multipart/form-data or application/octet-stream'))
    }

    // 提取 boundary
    const boundaryMatch = contentType.match(/boundary=(.+?)(?:;|$)/)
    if (!boundaryMatch) {
      return reject(new Error('Missing boundary in Content-Type'))
    }
    const boundary = boundaryMatch[1].trim()

    const chunks: Buffer[] = []
    let totalSize = 0

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length
      if (totalSize > MAX_SIZE) {
        req.destroy()
        reject(new Error(`文件大小超过限制（最大 ${MAX_SIZE / 1024 / 1024}MB）`))
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks)
        const result = extractFileFromMultipart(buffer, boundary, uploadDir)
        resolve(result)
      } catch (err: any) {
        reject(err)
      }
    })

    req.on('error', reject)
  })
}

/** 处理 application/octet-stream 上传 */
async function handleOctetStream(
  req: IncomingMessage,
  uploadDir: string,
): Promise<UploadResult> {
  const filename = req.headers['x-filename'] as string || `upload-${Date.now()}`
  const mimeType = req.headers['x-content-type'] as string || 'image/png'

  if (!ALLOWED_TYPES.has(mimeType)) {
    throw new Error(`不支持的文件类型: ${mimeType}，仅支持 PNG/JPEG/GIF/WebP/SVG`)
  }

  const ext = extname(filename) || mimeToExt(mimeType)
  const safeName = `${randomUUID()}${ext}`
  const filePath = join(uploadDir, safeName)

  return new Promise((resolve, reject) => {
    const ws = createWriteStream(filePath)
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_SIZE) {
        ws.destroy()
        req.destroy()
        reject(new Error(`文件大小超过限制（最大 ${MAX_SIZE / 1024 / 1024}MB）`))
        return
      }
      ws.write(chunk)
    })

    req.on('end', () => {
      ws.end()
      resolve({
        filename: safeName,
        path: `/${UPLOAD_DIR}/${safeName}`,
        size,
        mimeType,
      })
    })

    req.on('error', reject)
    ws.on('error', reject)
  })
}

/** 从 multipart buffer 中提取文件 */
function extractFileFromMultipart(
  buffer: Buffer,
  boundary: string,
  uploadDir: string,
): UploadResult {
  const delimiter = Buffer.from(`--${boundary}`)
  const parts: Buffer[] = []

  // 按 boundary 分割
  let start = 0
  let idx: number
  while ((idx = buffer.indexOf(delimiter, start)) !== -1) {
    if (start > 0) {
      parts.push(buffer.slice(start, idx))
    }
    start = idx + delimiter.length
  }

  // 遍历每个 part，找到文件数据
  for (const part of parts) {
    const partStr = part.toString('binary')
    const headerEnd = partStr.indexOf('\r\n\r\n')
    if (headerEnd === -1) continue

    const header = partStr.slice(0, headerEnd)
    const bodyStart = Buffer.from('\r\n\r\n').length + headerEnd
    const body = part.slice(headerEnd + 4, part.length - 2) // 去掉末尾 \r\n

    // 检查是否是文件 part
    const nameMatch = header.match(/name="(.+?)"/)
    const filenameMatch = header.match(/filename="(.+?)"/)

    if (!filenameMatch || !nameMatch) continue

    // 提取 Content-Type
    const ctMatch = header.match(/Content-Type:\s*(.+)/i)
    const mimeType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream'

    if (!ALLOWED_TYPES.has(mimeType)) {
      throw new Error(`不支持的文件类型: ${mimeType}，仅支持 PNG/JPEG/GIF/WebP/SVG`)
    }

    if (body.length > MAX_SIZE) {
      throw new Error(`文件大小超过限制（最大 ${MAX_SIZE / 1024 / 1024}MB）`)
    }

    const originalName = filenameMatch[1]
    const ext = extname(originalName) || mimeToExt(mimeType)
    const safeName = `${randomUUID()}${ext}`
    const filePath = join(uploadDir, safeName)

    // 写入文件
    writeFileSync(filePath, body)

    return {
      filename: safeName,
      path: `/${UPLOAD_DIR}/${safeName}`,
      size: body.length,
      mimeType,
    }
  }

  throw new Error('未找到上传的文件')
}

/** MIME 类型到文件扩展名 */
function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
  }
  return map[mimeType] || '.bin'
}

/**
 * 注册图片上传 HTTP 端点到现有 HTTP server
 *
 * POST /upload/image — 上传图片，返回 { path, filename, size, mimeType }
 * GET /chitu-data/uploads/* — 静态文件服务，返回上传的图片
 */
export function registerUploadHandler(
  req: IncomingMessage,
  res: ServerResponse,
  baseDir?: string,
): boolean {
  const url = req.url || ''

  // POST /upload/image — 图片上传
  if (req.method === 'POST' && url === '/upload/image') {
    handleImageUpload(req, res, baseDir)
    return true
  }

  // GET /chitu-data/uploads/* — 静态文件服务
  if (req.method === 'GET' && url.startsWith(`/${UPLOAD_DIR}/`)) {
    serveStaticFile(url, res, baseDir)
    return true
  }

  return false
}

/** 处理图片上传请求 */
async function handleImageUpload(
  req: IncomingMessage,
  res: ServerResponse,
  baseDir?: string,
): Promise<void> {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename, X-Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    const uploadDir = ensureUploadDir(baseDir)
    const result = await parseMultipartUpload(req, uploadDir)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (err: any) {
    const status = err.message.includes('超过限制') ? 413
      : err.message.includes('不支持') ? 415
      : 400
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err.message }))
  }
}

/** 静态文件服务 — 返回上传的图片 */
function serveStaticFile(
  url: string,
  res: ServerResponse,
  baseDir?: string,
): void {
  // 安全检查：防止路径遍历
  const filename = url.replace(`/${UPLOAD_DIR}/`, '').split('/').pop()
  if (!filename || filename.includes('..')) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Forbidden' }))
    return
  }

  const filePath = join(baseDir || process.cwd(), UPLOAD_DIR, filename)

  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'File not found' }))
    return
  }

  const ext = extname(filename).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  }

  const contentType = mimeMap[ext] || 'application/octet-stream'
  const data = readFileSync(filePath)

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.writeHead(200, { 'Content-Type': contentType })
  res.end(data)
}
