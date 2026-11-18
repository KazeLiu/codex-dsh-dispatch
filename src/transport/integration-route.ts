/**
 * 设置页的 HTTP 面：`/codex-dsh-dispatch/api/*`。
 *
 * 与 `/mcp/settings` 的分工：那条走 Bearer（给进程外 CLI 用），这条走同源可信
 * 判定（给 DSH 界面里的设置页用）。两者调的是同一组用例，不各写一份逻辑。
 *
 * 为什么页面不能复用 Bearer：access.json 里的 token 是给 Codex 用的凭据，把它
 * 塞进浏览器页面等于让任何能读页面脚本的东西都拿到它。页面只需要「我是 DSH
 * 自己的界面」这一个事实，而那由同源判定给出。
 *
 * 路由表（全部挂在 prefix `/codex-dsh-dispatch/api` 下）：
 * - `GET  settings`     读默认模型/强度/权限快照
 * - `PUT  settings`     保存默认值
 * - `GET  integration`  读 Codex 接入现场（配置路径、Node、bin、同名状态、规则文件）
 * - `PUT  config`       写「用户指定的 Node 路径」
 * - `POST register`     登记进 Codex
 * - `POST unregister`   从 Codex 移除
 * - `POST agents`       写/删协作规则托管区块
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import type { AgentsWriteRequest, IntegrationHandlers } from '../domain/codex-integration.js'
import type { SettingsSnapshot } from '../domain/settings.js'
import { BridgeError } from '../domain/errors.js'
import { readBody, sendJson } from './http.js'
import type { RouteHandler } from './route.js'
import { isTrustedApiRequest } from './trusted.js'

/** 路由前缀。客户端用相对路径请求，不需要知道宿主端口。 */
export const INTEGRATION_ROUTE_PATH = '/codex-dsh-dispatch/api'

/** 请求体上限。设置只有几个字段；规则写入的入参也只有几个字符串。 */
const MAX_API_BODY_BYTES = 64 * 1024


export function createIntegrationHandler(handlers: IntegrationHandlers): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // 先判定来源再解析任何东西：不可信请求不该触发一次磁盘读或一次 codex 调用。
    if (!isTrustedApiRequest(req)) {
      sendJson(res, 403, { error: { code: 'forbidden', message: '请求来源不被信任，请从 DSH 设置中打开此页面。' } })
      return
    }

    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const action = url.pathname.slice(INTEGRATION_ROUTE_PATH.length).replace(/^\/+/, '')

    try {
      await dispatch(handlers, req, res, action)
    } catch (cause) {
      sendFailure(res, cause)
    }
  }
}

async function dispatch(
  handlers: IntegrationHandlers,
  req: IncomingMessage,
  res: ServerResponse,
  action: string,
): Promise<void> {
  const method = req.method ?? 'GET'

  if (action === 'settings') {
    if (method === 'GET') {
      sendJson(res, 200, withOrigin(await handlers.readSettings(), req))
      return
    }
    if (method === 'PUT') {
      const body = await readJson(req)
      sendJson(res, 200, withOrigin(await handlers.writeSettings(body), req))
      return
    }
    methodNotAllowed(res, 'GET, PUT', method)
    return
  }

  if (action === 'integration' && method === 'GET') {
    sendJson(res, 200, await handlers.readIntegration())
    return
  }

  if (action === 'config' && method === 'PUT') {
    sendJson(res, 200, await handlers.writeConfig(await readJson(req)))
    return
  }

  if (action === 'register' && method === 'POST') {
    sendJson(res, 200, await handlers.register())
    return
  }

  if (action === 'unregister' && method === 'POST') {
    sendJson(res, 200, await handlers.unregister())
    return
  }

  if (action === 'agents' && method === 'POST') {
    sendJson(res, 200, await handlers.writeAgents(readAgentsInput(await readJson(req))))
    return
  }

  sendJson(res, 404, { error: { code: 'not-found', message: 'unknown method' } })
}

/**
 * 解析写规则的入参。
 *
 * 字段校验放在这里而不是用例层，是因为「缺字段」属于请求形状问题。页面只写
 * 全局 AGENTS.md；项目级仍由 CLI 的明确操作负责，所以这里不接受项目目录。
 */
function readAgentsInput(body: unknown): AgentsWriteRequest {
  if (body === null || typeof body !== 'object') {
    throw new BridgeError('invalid-argument', '请求体必须是对象')
  }
  const record = body as Record<string, unknown>
  const action = record['action']
  if (action !== 'write' && action !== 'remove') {
    throw new BridgeError('invalid-argument', 'action 必须是 write 或 remove', { field: 'action' })
  }
  // digest 必须显式出现：`null` 表示「读的时候文件不存在」，是有效快照；
  // 字段缺失则说明调用方没做快照保护，不能悄悄降级成 null 放行。
  if (!('digest' in record)) {
    throw new BridgeError('invalid-argument', '缺少 digest：写协作规则前必须先读取当前内容', { field: 'digest' })
  }
  const digest = record['digest']
  if (digest !== null && typeof digest !== 'string') {
    throw new BridgeError('invalid-argument', 'digest 必须是字符串或 null', { field: 'digest' })
  }
  return { action, digest }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req, MAX_API_BODY_BYTES)
  if (raw.trim() === '') return {}
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new BridgeError('invalid-argument', '请求体不是合法 JSON')
  }
}

function methodNotAllowed(res: ServerResponse, allow: string, method: string): void {
  res.setHeader('allow', allow)
  sendJson(res, 405, { error: `method not allowed: ${method}` })
}

/**
 * 补上桥接端点 origin。
 *
 * 用例层拿不到 `webServer`，`connection.origin` 恒为 `null`；只有传输层能看见
 * 真实请求，用 `host` 头补——那就是客户端实际连的地址，不是猜测。
 */
function withOrigin(snapshot: SettingsSnapshot, req: IncomingMessage): SettingsSnapshot {
  const host = req.headers.host
  if (host === undefined || host === '') return snapshot
  const encrypted = (req.socket as { encrypted?: boolean }).encrypted === true
  return {
    ...snapshot,
    connection: {
      ...snapshot.connection,
      origin: `${encrypted ? 'https' : 'http'}://${host}`,
    },
  }
}

function sendFailure(res: ServerResponse, cause: unknown): void {
  if (cause instanceof BridgeError) {
    sendJson(res, cause.code === 'invalid-argument' ? 400 : 500, {
      error: {
        code: cause.code,
        message: cause.message,
        ...(cause.detail === undefined ? {} : { detail: cause.detail }),
      },
    })
    return
  }
  const message = cause instanceof Error ? cause.message : '未知错误'
  sendJson(res, 500, { error: { code: 'internal', message } })
}
