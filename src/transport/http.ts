/**
 * MCP 传输层：把 `ctx.webServer` 的一条路由变成 Streamable HTTP 端点。
 *
 * 方法映射（docs/ARCHITECTURE.md 第 5.7 节）：
 * - `POST` 主通道：一次请求一帧响应；`dsh_wait` 会在这条通道上长挂到超时或状态变化。
 * - `GET`  → `405`：第 1 阶段不发服务端主动通知，没有可推送的流。
 * - `DELETE` → `204`：本阶段不维护跨请求会话状态，没有可关闭的东西。
 *
 * **退场条件（第 2 阶段必须一起改）**：一旦要加进度通知（`notifications/progress`）
 * 或任何服务端主动推送，就必须同时补 `Mcp-Session-Id` 的分配、校验与过期，
 * 并把 `GET` 改成真正的 SSE 流。只加 GET 流而不做会话标识，会让多客户端共用
 * 一条流、通知投错对象。
 *
 * 失败隔离（第 8 节）：客户端断开只中断**本次等待**，绝不取消会话执行——
 * 取消只能由 `dsh_cancel` 显式发起。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import { parseErrorResponse, type DispatchResult } from '../mcp/dispatcher.js'
import { checkRequest, readConfiguredToken } from './auth.js'
import type { RouteHandler } from './route.js'

/**
 * 分派函数：传输层唯一需要知道的上游能力。
 *
 * 刻意**不接收 `AppDeps`**（依赖规则 D5：`src/transport/**` 不得 import
 * `src/app/**`）。传输层只负责 HTTP 帧与认证围栏，不该知道用例层怎么装配；
 * 由组装根 `src/index.ts` 把 `dispatch(deps, …)` 绑好再传进来。
 */
export type DispatchFn = (message: unknown, signal?: AbortSignal) => Promise<DispatchResult>

/** 请求体上限：MCP 请求都很小，1 MiB 足够容纳长任务描述，超出即拒。 */
export const MAX_BODY_BYTES = 1024 * 1024

/** 传输层选项。 */
export interface TransportOptions {
  /** 客户端凭据；`null` 表示未配置，此时一律拒绝（fail closed）。 */
  readonly token: string | null
}

/**
 * 构造 MCP 路由处理器。
 *
 * 凭据在构造时读一次：插件运行期间不重读环境变量，避免「改了环境变量但
 * 已建立的连接用旧凭据」这种半生效状态。
 */
export function createMcpHandler(dispatch: DispatchFn, options?: Partial<TransportOptions>): RouteHandler {
  const token = options?.token ?? readConfiguredToken()

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rejection = checkRequest(req, token)
    if (rejection !== null) {
      // 拒绝信息不含内部路径、不含期望凭据片段：错误信息本身也是泄漏面。
      sendJson(res, rejection.status, { error: rejection.message })
      return
    }

    const method = req.method ?? 'GET'
    if (method === 'GET') {
      res.setHeader('allow', 'POST, DELETE')
      sendJson(res, 405, { error: 'method not allowed: GET is not used in this phase' })
      return
    }
    if (method === 'DELETE') {
      // 无跨请求会话状态，直接确认关闭。
      res.statusCode = 204
      res.end()
      return
    }
    if (method !== 'POST') {
      res.setHeader('allow', 'POST, DELETE')
      sendJson(res, 405, { error: `method not allowed: ${method}` })
      return
    }

    await handlePost(dispatch, req, res)
  }
}

/** 处理 POST：读体 → 解析 → 分派 → 回帧。 */
async function handlePost(dispatch: DispatchFn, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let raw: string
  try {
    raw = await readBody(req)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '无法读取请求体'
    sendJson(res, 413, { error: message })
    return
  }

  let message: unknown
  try {
    message = JSON.parse(raw) as unknown
  } catch {
    // 解析失败是协议层错误，按 JSON-RPC 规范回 -32700。
    sendJson(res, 200, parseErrorResponse())
    return
  }

  // 客户端断开只中断本次等待，不影响会话执行（第 8 节硬要求）。
  const controller = new AbortController()
  const onClose = (): void => {
    controller.abort()
  }
  res.on('close', onClose)

  try {
    const result = await dispatch(message, controller.signal)
    if (res.writableEnded || res.destroyed) return

    if (result.kind === 'none') {
      // 通知（`notifications/*`）不得回任何 JSON-RPC 帧；用 202 表示「已收到」。
      res.statusCode = 202
      res.end()
      return
    }

    if (prefersEventStream(req)) {
      sendEventStream(res, result.body)
      return
    }
    sendJson(res, 200, result.body)
  } finally {
    res.off('close', onClose)
  }
}

/**
 * 读请求体，超过上限即中止。
 *
 * 上限是防御性的：这个端点只接受本机客户端，但没有上限时一个错误的请求
 * 就能把进程内存吃满。`limit` 可覆盖：设置路由的请求体小得多，没必要也
 * 给到 1 MiB。
 */
export async function readBody(req: IncomingMessage, limit: number = MAX_BODY_BYTES): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0

  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer)
    total += buffer.byteLength
    if (total > limit) {
      throw new Error(`请求体超过上限（${limit} 字节）`)
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

/**
 * 客户端是否只接受 SSE。
 *
 * MCP 客户端通常同时声明 `application/json` 与 `text/event-stream`，此时回
 * JSON 最省事；只有明确不要 JSON 时才走 SSE 单帧。
 */
function prefersEventStream(req: IncomingMessage): boolean {
  const accept = req.headers.accept
  if (accept === undefined) return false
  const normalized = accept.toLowerCase()
  if (normalized.includes('application/json')) return false
  return normalized.includes('text/event-stream')
}

/** 回一帧 JSON。 */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(payload, 'utf8'))
  // 本端点只服务本机客户端，禁用缓存避免中间层重放旧响应。
  res.setHeader('cache-control', 'no-store')
  res.end(payload)
}

/** 回一帧 SSE（单条 `message` 事件后立即结束）。 */
function sendEventStream(res: ServerResponse, body: unknown): void {
  const payload = JSON.stringify(body)
  res.statusCode = 200
  res.setHeader('content-type', 'text/event-stream; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('connection', 'keep-alive')
  res.end(`event: message\ndata: ${payload}\n\n`)
}
