/**
 * 设置读写路由：TUI 与其它本机配置客户端读写桥接默认值的唯一入口。
 *
 * 为什么是独立路由而不是 MCP 工具：设置是**用户配置操作**，不是任务派发。
 * 混进 `/mcp/codex-dsh-dispatch` 会让只认 JSON-RPC 的客户端把 `GET`/`PUT` 当成
 * 非法帧，也让「保存默认权限」这种改变后续所有任务行为的高权操作藏在工具面
 * 后面（第 9 节要求 TUI 读写接口与任务接口采用**相同**的本机认证要求）。
 *
 * 分层（依赖规则 D5）：本文件只 import `../domain/**` 与同层模块，**不 import
 * `src/app/**`**。用例层怎么装配由组装根 `src/index.ts` 用回调绑进来。
 *
 * 认证围栏与 MCP 路由完全一致：回环地址 + Bearer 凭据，缺一即拒（fail closed）。
 * 写操作额外要求方法为 `PUT`——`GET` 永远不产生副作用。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import { BridgeError } from '../domain/errors.js'
import { readSettingsUpdate, type SettingsSnapshot, type SettingsUpdate } from '../domain/settings.js'
import { checkRequest, readConfiguredToken } from './auth.js'
import { readBody, sendJson, type TransportOptions } from './http.js'
import type { RouteHandler } from './route.js'

/**
 * 设置页需要的两个用例入口。
 *
 * 刻意用回调而不是直接调 `readSettings(deps)`：传输层不该知道 `AppDeps` 的
 * 形状（D5），而且这样测试时可以塞假实现，不必构造整个端口集合。
 */
export interface SettingsHandlers {
  /** 读快照：模型目录 + 可用预设 + 已保存值 + 失效标记。 */
  readonly read: () => Promise<SettingsSnapshot>
  /** 写默认值，返回写入后的快照（让客户端一次拿到最新状态，不必再 GET）。 */
  readonly write: (update: SettingsUpdate) => Promise<SettingsSnapshot>
}

/** 设置路由的请求体上限：一份设置只有几个字段，64 KiB 已远超需要。 */
const MAX_SETTINGS_BODY_BYTES = 64 * 1024

/** 允许的方法。`PUT` 是幂等的整体覆盖，符合「保存默认值」语义。 */
const ALLOWED_METHODS = 'GET, PUT'

/**
 * 构造设置路由处理器。
 *
 * 凭据在构造时读一次，与 MCP 路由保持一致：插件运行期不重读环境变量，避免
 * 「改了环境变量但已建立的连接仍用旧凭据」这种半生效状态。
 */
export function createSettingsHandler(
  handlers: SettingsHandlers,
  options?: Partial<TransportOptions>,
): RouteHandler {
  const token = options?.token ?? readConfiguredToken()

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rejection = checkRequest(req, token)
    if (rejection !== null) {
      // 与 MCP 路由同一套拒绝文案：不回显期望凭据的任何片段。
      sendJson(res, rejection.status, { error: rejection.message })
      return
    }

    const method = req.method ?? 'GET'
    if (method === 'GET') {
      await handleRead(handlers, req, res)
      return
    }
    if (method === 'PUT') {
      await handleWrite(handlers, req, res)
      return
    }

    res.setHeader('allow', ALLOWED_METHODS)
    sendJson(res, 405, { error: `method not allowed: ${method}` })
  }
}

/** 读快照。 */
async function handleRead(
  handlers: SettingsHandlers,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const snapshot = await handlers.read()
    sendJson(res, 200, withOrigin(snapshot, req))
  } catch (cause) {
    sendFailure(res, cause)
  }
}

/** 写默认值。 */
async function handleWrite(
  handlers: SettingsHandlers,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let raw: string
  try {
    raw = await readBody(req, MAX_SETTINGS_BODY_BYTES)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '无法读取请求体'
    sendJson(res, 413, { error: message })
    return
  }

  let body: unknown
  try {
    body = JSON.parse(raw) as unknown
  } catch {
    // 这里是 REST 而不是 JSON-RPC，解析失败用 HTTP 400，不回 `-32700`：
    // 客户端拿到的应当是「你的请求体不是 JSON」，不是协议帧错误。
    sendJson(res, 400, { error: '请求体不是合法 JSON' })
    return
  }

  try {
    // 字段校验交给领域层：传输层不重复实现一遍规则，否则两处必然漂移。
    const update = readSettingsUpdate(body)
    const snapshot = await handlers.write(update)
    sendJson(res, 200, withOrigin(snapshot, req))
  } catch (cause) {
    sendFailure(res, cause)
  }
}

/**
 * 补上桥接端点 origin。
 *
 * 用例层拿不到 `webServer`（D7 不让 `app/` 依赖宿主），所以快照里的
 * `connection.origin` 恒为 `null`；只有传输层能看见真实请求，用它补。
 * 这不是猜测：`host` 头就是客户端实际连的地址。
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

/**
 * 把失败映射成 HTTP 状态。
 *
 * 只有 `invalid-argument` 是客户端能自己修的（400）；其余都是服务端状态
 * 问题（500），让客户端知道「重试同样的请求不会变好」。
 */
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
