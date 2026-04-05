/**
 * JSON-RPC 2.0 — 类型定义和编解码
 *
 * JSON-RPC 2.0 规范：https://www.jsonrpc.org/specification
 * Codex App Server 用 JSON-RPC 做双向通信
 *
 * 三种消息：
 * - Request: 客户端发，有 id，等服务端回复 Response
 * - Response: 服务端回，对应 Request 的 id
 * - Notification: 单向推送，没有 id，不需要回复
 */

// ===== 类型 =====

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number | string
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

// ===== 标准错误码 =====

export const PARSE_ERROR = -32700
export const INVALID_REQUEST = -32600
export const METHOD_NOT_FOUND = -32601
export const INVALID_PARAMS = -32602
export const INTERNAL_ERROR = -32603
/** 自定义：未初始化 */
export const NOT_INITIALIZED = -32002

// ===== 构造函数 =====

export function createResponse(id: number | string, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

export function createError(id: number | string | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  const err: JsonRpcError = { code, message }
  if (data !== undefined) err.data = data
  return { jsonrpc: '2.0', id: id ?? 0, error: err }
}

export function createNotification(method: string, params?: Record<string, unknown>): JsonRpcNotification {
  const n: JsonRpcNotification = { jsonrpc: '2.0', method }
  if (params) n.params = params
  return n
}

// ===== 解析 =====

/** 把原始字符串解析为 JsonRpcRequest，失败返回 null */
export function parseMessage(raw: string): JsonRpcRequest | null {
  try {
    const msg = JSON.parse(raw)
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return null
    return msg as JsonRpcRequest
  } catch {
    return null
  }
}
