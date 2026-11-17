/**
 * TUI 的 HTTP 客户端：通过本机认证通道读写插件服务。
 *
 * 这是 TUI 与插件之间**唯一**的耦合面。TUI 不读 `$DSH_HOME` 下的设置文件、
 * 不碰 DSH profile、不碰会话文件——否则就会出现「TUI 与插件各存一份配置」，
 * 两边不一致时用户无从判断哪份生效（docs/DEVELOPMENT.md 第 5 节）。
 *
 * 依赖规则：本文件不 import `../transport/**`（那是插件进程内的代码），只用
 * `fetch` 说 HTTP。协议形状由 `../domain/settings.js` 的类型约束。
 */

import type { SettingsSnapshot, SettingsUpdate } from '../domain/settings.js'

/** 端点默认地址：与 DSH web 服务同端口。 */
const DEFAULT_BASE_URL = 'http://127.0.0.1:7275'

/** 设置路由路径（与 `src/transport/route.ts` 的 `SETTINGS_ROUTE_PATH` 一致）。 */
const SETTINGS_PATH = '/mcp/settings'

/** 读请求超时：本机调用，5 秒足够；超时视为服务不可用而不是无限等待。 */
const REQUEST_TIMEOUT_MS = 5_000

/** 客户端配置。 */
export interface ClientConfig {
  /** 桥接端点基址，如 `http://127.0.0.1:7275`。 */
  readonly baseUrl: string
  /** Bearer 凭据；`null` 表示未配置，此时所有请求都会被拒绝。 */
  readonly token: string | null
}

/**
 * 从环境变量读客户端配置。
 *
 * `DSH_MCP_BRIDGE_URL` 覆盖端点（DSH 换端口时用），`DSH_MCP_BRIDGE_TOKEN`
 * 是凭据。凭据**只从环境读**，不接受命令行参数——命令行会进 shell 历史。
 */
export function readClientConfig(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const baseUrl = env['DSH_MCP_BRIDGE_URL']?.trim()
  const token = env['DSH_MCP_BRIDGE_TOKEN']?.trim()
  return {
    baseUrl: baseUrl !== undefined && baseUrl !== '' ? baseUrl.replace(/\/+$/, '') : DEFAULT_BASE_URL,
    token: token !== undefined && token !== '' ? token : null,
  }
}

/** 客户端失败：带一句可直接展示的中文原因。 */
export class SettingsClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsClientError'
  }
}

/** 读设置快照。 */
export async function fetchSettings(config: ClientConfig): Promise<SettingsSnapshot> {
  return request(config, 'GET')
}

/** 保存默认值并返回新快照。 */
export async function saveSettings(
  config: ClientConfig,
  update: SettingsUpdate,
): Promise<SettingsSnapshot> {
  return request(config, 'PUT', update)
}

/** 发一次请求并把响应解析成快照。 */
async function request(
  config: ClientConfig,
  method: 'GET' | 'PUT',
  body?: SettingsUpdate,
): Promise<SettingsSnapshot> {
  if (config.token === null) {
    // 提前拦下来：让用户看到「没配凭据」而不是一个 401。
    throw new SettingsClientError('未设置环境变量 DSH_MCP_BRIDGE_TOKEN，无法访问桥接服务')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${SETTINGS_PATH}`, {
      method,
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    })
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new SettingsClientError(`请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）：${config.baseUrl}`)
    }
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new SettingsClientError(`无法连接 ${config.baseUrl}：${detail}`)
  } finally {
    clearTimeout(timer)
  }

  const text = await response.text()
  const parsed = parseJson(text)

  if (!response.ok) {
    throw new SettingsClientError(describeFailure(response.status, parsed, text))
  }
  if (!isSnapshot(parsed)) {
    throw new SettingsClientError('服务返回的设置格式无法识别（缺少 connection / providers 字段）')
  }
  return parsed
}

/** 解析 JSON；失败返回 `undefined`。 */
function parseJson(text: string): unknown {
  if (text === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * 把错误响应翻成中文。
 *
 * 服务端的错误体有三种来源，都要认：
 * 1. 本插件的设置路由：`{ error: { code, message } }`；
 * 2. 本插件的认证围栏：`{ error: '...' }`；
 * 3. **DSH Desktop 宿主的 Browser access 围栏**：纯文本 `Browser access is disabled`。
 *
 * 第 3 种必须单独认出来。它同样是 403，但原因与「不是本机回环」完全不同——
 * DSH Desktop 默认 `browserAccess: false`，会在插件路由之前先拦掉所有非
 * Electron 渲染进程的请求。把它显示成「只接受本机回环连接」会让用户去查
 * 回环配置，而真正要改的是 DSH 设置里的「允许浏览器访问」开关。
 */
function describeFailure(status: number, parsed: unknown, rawText: string): string {
  if (typeof parsed === 'object' && parsed !== null) {
    const error = (parsed as { error?: unknown }).error
    if (typeof error === 'string') return `${status}：${error}`
    if (typeof error === 'object' && error !== null) {
      const message = (error as { message?: unknown }).message
      const code = (error as { code?: unknown }).code
      if (typeof message === 'string') {
        return typeof code === 'string' ? `${status}（${code}）：${message}` : `${status}：${message}`
      }
    }
  }
  if (status === 403 && rawText.includes('Browser access is disabled')) {
    return (
      '403：DSH 桌面端未允许浏览器访问，请求在到达插件之前就被拦下了。' +
      '请在 DSH 设置里打开「允许浏览器访问」后重试（该开关默认关闭）'
    )
  }
  if (status === 401) return '401：凭据无效（检查 DSH_MCP_BRIDGE_TOKEN）'
  if (status === 403) return '403：只接受本机回环连接'
  if (status === 503) return '503：桥接服务尚未配置凭据'
  return `请求失败：HTTP ${status}`
}

/**
 * 结构校验：只检查渲染必需的两个字段。
 *
 * 不做完整 schema 校验——服务端与 TUI 同仓同版本，字段级漂移应该在类型检查
 * 阶段暴露，而不是在运行时靠一遍遍校验掩盖。
 */
function isSnapshot(value: unknown): value is SettingsSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record['connection'] === 'object' &&
    record['connection'] !== null &&
    Array.isArray(record['providers']) &&
    Array.isArray(record['permissions']) &&
    typeof record['saved'] === 'object' &&
    record['saved'] !== null
  )
}
