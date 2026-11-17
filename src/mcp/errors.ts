/**
 * MCP 协议面的错误映射。
 *
 * 这里有一条必须守住的界线（docs/ARCHITECTURE.md 第 5.7 节）：
 *
 * - **工具根本没跑起来**（缺 `cwd`、`cwd` 不是绝对路径、`requestId` 为空、
 *   `model.provider` 与 `model.model` 只给了一半）→ JSON-RPC 错误 `-32602`。
 *   客户端应当认为「我的请求写错了」，重试同样的参数没有意义。
 * - **工具跑起来了但业务失败**（`workspace-busy`、`session-not-found`、
 *   `turn-missing`、`wait-timeout`）→ HTTP 200 + `result.isError = true`，
 *   结构化错误放在 `content` 里。这类失败可能该重试、也可能该换参数。
 *
 * 混用会让客户端无法区分这两种情况，所以映射表是固定枚举，不按消息文本猜。
 */

import { BridgeError, type BridgeErrorCode } from '../domain/errors.js'

/** JSON-RPC 标准错误码；只使用标准值，不自造区间。 */
export const JSON_RPC_PARSE_ERROR = -32700
export const JSON_RPC_INVALID_REQUEST = -32600
export const JSON_RPC_METHOD_NOT_FOUND = -32601
export const JSON_RPC_INVALID_PARAMS = -32602
export const JSON_RPC_INTERNAL_ERROR = -32603

/** JSON-RPC 错误对象。 */
export interface JsonRpcErrorObject {
  readonly code: number
  readonly message: string
  readonly data?: unknown
}

/**
 * 判定某个桥接错误码是否属于「请求写错了」。
 *
 * 只有这两类：参数不合法、以及请求里指定的模型/强度/权限在当前环境不存在。
 * 后者虽然发生在工具执行期，但对客户端而言仍是「你的参数与当前环境不匹配」，
 * 换参数才能继续，因此归到 `-32602` 而不是 `isError`。
 */
const INVALID_PARAMS_CODES: ReadonlySet<BridgeErrorCode> = new Set<BridgeErrorCode>([
  'invalid-argument',
  'model-unavailable',
  'reasoning-effort-unavailable',
  'saved-model-invalid',
  // `permission-unavailable` 与 `model-unavailable` 同类：请求的档位在当前
  // 环境不存在（典型是 `sourcePermission: 'auto'` 但没启用自动审查插件）。
  // 归 `isError` 会让客户端分不清「档位写错了」与「任务执行失败了」。
  'permission-unavailable',
])

/** 把任意抛出物归一成 `BridgeError`。 */
export function toBridgeError(cause: unknown): BridgeError {
  if (cause instanceof BridgeError) return cause
  const message = cause instanceof Error ? cause.message : String(cause)
  return new BridgeError('internal', message === '' ? '桥接内部错误' : message, undefined, cause)
}

/**
 * 映射为 JSON-RPC 错误。
 *
 * 返回 `null` 表示「不该走 JSON-RPC 错误通道」，调用方应改用 `isError` 结果。
 */
export function toJsonRpcError(cause: unknown): JsonRpcErrorObject | null {
  const error = toBridgeError(cause)
  if (!INVALID_PARAMS_CODES.has(error.code)) return null
  return {
    code: JSON_RPC_INVALID_PARAMS,
    message: error.message,
    data: { code: error.code, ...(error.detail === undefined ? {} : { detail: error.detail }) },
  }
}

/**
 * 构造 `isError` 结果。
 *
 * `detail` 原样进入返回体；它只包含定位信息（会话、请求、目录），
 * 不得含密钥或任务正文——这一点由各用例构造 `detail` 时保证。
 */
export function toErrorResult(cause: unknown): {
  readonly isError: true
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
} {
  const error = toBridgeError(cause)
  const payload = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    },
  }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  }
}

/** 构造成功结果：正文为可解析的 JSON 字符串。 */
export function toTextResult(value: unknown): {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
} {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}
