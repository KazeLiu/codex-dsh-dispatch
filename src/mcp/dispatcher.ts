/**
 * MCP JSON-RPC 分派器（手写，不依赖 MCP 服务端 SDK）。
 *
 * 为什么手写：本机 DSH 只内置了 `@modelcontextprotocol/core` 与 `client`，
 * 没有服务端实现（`core` 的 dist 只导出 zod schema 常量，不含 `McpServer` /
 * `StreamableHTTPServerTransport`）。第 1 阶段不新增依赖，因此按协议规范
 * 自行分派这四个方法与一个通知。
 *
 * 只做 legacy `initialize` 路径，不碰 `server/discover` 那套 modern era 机制：
 * 后者是另一套版本协商，第 1 阶段没有需要它的能力（不发服务端主动通知）。
 */

import type { AppDeps } from '../app/deps.js'
import {
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  toErrorResult,
  toJsonRpcError,
  toTextResult,
} from './errors.js'
import { TOOLS, findTool } from './tools/index.js'

/** JSON-RPC 版本，固定值。 */
const JSONRPC_VERSION = '2.0'

/**
 * 本插件支持的最新协议版本。
 *
 * 与 `@modelcontextprotocol/core@2.2.0` 的 `LATEST_PROTOCOL_VERSION` 保持一致；
 * 升级 DSH 时需要重新核对，不要凭印象改。
 */
const LATEST_PROTOCOL_VERSION = '2025-11-25'

/** 可协商的协议版本表（新→旧）。 */
const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
]

/** 服务端自报信息。 */
const SERVER_INFO = { name: 'dsh-mcp-bridge', version: '0.1.0' } as const

/**
 * 永不触发的信号。
 *
 * 分派器在没有传输层信号时用它兜底：工具实现只需处理「有信号」这一种情况，
 * 不必到处判 `undefined`；而「永不中断」正是无传输层调用时的正确语义。
 */
const NEVER_ABORTED = new AbortController()

/** 一条 JSON-RPC 请求/通知。 */
interface JsonRpcMessage {
  readonly jsonrpc?: unknown
  readonly id?: unknown
  readonly method?: unknown
  readonly params?: unknown
}

/** 分派结果。 */
export type DispatchResult =
  /** 需要回一帧响应。 */
  | { readonly kind: 'response'; readonly body: unknown }
  /** 通知：不回任何帧。 */
  | { readonly kind: 'none' }

/**
 * 分派一条消息。
 *
 * 第一层判断是「有没有 `id`」：`notifications/*` 没有 `id`，按 JSON-RPC 与
 * MCP 规范都**不得回任何帧**，回了会让客户端报协议错误。
 */
export async function dispatch(
  deps: AppDeps,
  message: unknown,
  signal?: AbortSignal,
): Promise<DispatchResult> {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return { kind: 'response', body: errorResponse(null, JSON_RPC_INVALID_REQUEST, '请求必须是 JSON 对象') }
  }

  const request = message as JsonRpcMessage
  const isNotification = request.id === undefined
  const id = isNotification ? null : request.id

  if (request.jsonrpc !== JSONRPC_VERSION) {
    return {
      kind: 'response',
      body: errorResponse(id, JSON_RPC_INVALID_REQUEST, 'jsonrpc 必须是 "2.0"'),
    }
  }
  if (typeof request.method !== 'string') {
    return {
      kind: 'response',
      body: errorResponse(id, JSON_RPC_INVALID_REQUEST, 'method 必须是字符串'),
    }
  }

  const method = request.method
  const params = request.params

  // 通知：只执行副作用，绝不回帧。
  if (isNotification) {
    // 目前唯一的通知是 notifications/initialized，无需任何副作用；
    // 其它通知按规范静默忽略。
    return { kind: 'none' }
  }

  switch (method) {
    case 'initialize':
      return { kind: 'response', body: resultResponse(id, initializeResult(params)) }
    case 'ping':
      return { kind: 'response', body: resultResponse(id, {}) }
    case 'tools/list':
      return { kind: 'response', body: resultResponse(id, listToolsResult()) }
    case 'tools/call':
      return { kind: 'response', body: await callTool(deps, id, params, signal) }
    default:
      return {
        kind: 'response',
        body: errorResponse(id, JSON_RPC_METHOD_NOT_FOUND, `不支持的方法：${method}`),
      }
  }
}

/**
 * 解析 `initialize` 的版本协商。
 *
 * 客户端请求的版本在支持表内就原样回；不在表内回最新版本，由客户端决定是否
 * 继续（规范行为）。不写死单一版本，也不自造版本号。
 */
function initializeResult(params: unknown): unknown {
  const requested = readStringField(params, 'protocolVersion')
  const negotiated =
    requested !== null && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : LATEST_PROTOCOL_VERSION

  return {
    protocolVersion: negotiated,
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
  }
}

/** `tools/list`：无分页，一次性返回全部工具。 */
function listToolsResult(): unknown {
  return {
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }
}

/**
 * `tools/call`。
 *
 * 两类失败走不同通道（见 `errors.ts` 的说明）：
 * - 参数层面的错误（找不到工具、缺 `arguments`）→ JSON-RPC 错误；
 * - 工具已执行但业务失败 → `result.isError = true`。
 */
async function callTool(
  deps: AppDeps,
  id: unknown,
  params: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const name = readStringField(params, 'name')
  if (name === null) {
    return errorResponse(id, JSON_RPC_INVALID_PARAMS, 'tools/call 缺少 name')
  }

  const tool = findTool(name)
  if (tool === undefined) {
    return errorResponse(id, JSON_RPC_INVALID_PARAMS, `未知工具：${name}`)
  }

  const rawArguments = readField(params, 'arguments')
  if (rawArguments !== undefined && (typeof rawArguments !== 'object' || rawArguments === null || Array.isArray(rawArguments))) {
    return errorResponse(id, JSON_RPC_INVALID_PARAMS, 'arguments 必须是对象')
  }
  const args = (rawArguments ?? {}) as Readonly<Record<string, unknown>>

  try {
    // 没有传输层信号时给一个永不触发的信号：工具实现不必处理 `undefined`，
    // 而「永不中断」正是无传输层（例如将来做进程内调用）时的正确语义。
    const value = await tool.run(deps, args, signal ?? NEVER_ABORTED.signal)
    return resultResponse(id, toTextResult(value))
  } catch (cause) {
    // 参数不合法 → JSON-RPC 错误，让客户端知道「重试同样的参数没意义」。
    const rpcError = toJsonRpcError(cause)
    if (rpcError !== null) {
      return { jsonrpc: JSONRPC_VERSION, id, error: rpcError }
    }
    // 业务失败 → isError 结果，SSE 连接与其它会话都不受影响。
    return resultResponse(id, toErrorResult(cause))
  }
}

/** 读对象的某个字段。 */
function readField(params: unknown, field: string): unknown {
  if (typeof params !== 'object' || params === null) return undefined
  return (params as Record<string, unknown>)[field]
}

/** 读字符串字段；非字符串返回 `null`。 */
function readStringField(params: unknown, field: string): string | null {
  const value = readField(params, field)
  return typeof value === 'string' ? value : null
}

function resultResponse(id: unknown, result: unknown): unknown {
  return { jsonrpc: JSONRPC_VERSION, id, result }
}

function errorResponse(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } }
}

/** 构造解析失败响应（供传输层在 JSON 解析失败时使用）。 */
export function parseErrorResponse(): unknown {
  return errorResponse(null, JSON_RPC_PARSE_ERROR, '无法解析 JSON')
}
