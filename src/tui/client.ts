import type { SettingsSnapshot, SettingsUpdate } from '../domain/settings.js'
import { readConnection } from '../connection.js'

export interface ClientConfig { readonly baseUrl: string; readonly token: string | null }

/** 空值表示自动发现；显式环境覆盖继续保留。 */
export function readClientConfig(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const token = env['DSH_MCP_BRIDGE_TOKEN']
  return {
    baseUrl: env['DSH_MCP_BRIDGE_URL']?.trim().replace(/\/+$/, '') ?? '',
    token: token === undefined || token.trim() === '' ? null : token,
  }
}

export class SettingsClientError extends Error {
  constructor(message: string) { super(message); this.name = 'SettingsClientError' }
}

export function fetchSettings(config: ClientConfig): Promise<SettingsSnapshot> {
  return request(config, 'GET')
}

export function saveSettings(config: ClientConfig, update: SettingsUpdate): Promise<SettingsSnapshot> {
  return request(config, 'PUT', update)
}

async function request(config: ClientConfig, method: 'GET' | 'PUT', body?: SettingsUpdate): Promise<SettingsSnapshot> {
  if (config.token === null || config.baseUrl === '') {
    try {
      const connection = await readConnection()
      config = { baseUrl: config.baseUrl || connection.url, token: config.token ?? connection.token }
    } catch { throw new SettingsClientError('找不到桥接连接信息。请先在 DSH 中加载 dsh-mcp-bridge 插件。') }
  }
  let response: Response
  let text: string
  try {
    response = await fetch(`${config.baseUrl}/mcp/settings`, {
      method,
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5_000),
    })
    text = await response.text()
  } catch (cause) {
    const timedOut = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
    throw new SettingsClientError(timedOut ? '连接桥接服务超时（5 秒）' : `无法连接桥接服务：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  let parsed: unknown
  try { parsed = JSON.parse(text) as unknown } catch { parsed = undefined }
  if (!response.ok) throw new SettingsClientError(describeFailure(response.status, parsed, text))
  if (!isSnapshot(parsed)) throw new SettingsClientError('服务返回的设置格式无法识别')
  return parsed
}

function describeFailure(status: number, parsed: unknown, text: string): string {
  if (status === 403 && text.includes('Browser access is disabled')) {
    return '连接到了旧的 DSH 网页端口，请清除 DSH_MCP_BRIDGE_URL/TOKEN 环境覆盖后重试，无需打开浏览器访问。'
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const error = (parsed as { error?: unknown }).error
    if (typeof error === 'string') return `${status}：${error}`
    if (typeof error === 'object' && error !== null) {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string') return `${status}：${message}`
    }
  }
  return `请求失败：HTTP ${status}`
}

function isSnapshot(value: unknown): value is SettingsSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.connection === 'object' && record.connection !== null &&
    Array.isArray(record.providers) && Array.isArray(record.permissions) &&
    typeof record.saved === 'object' && record.saved !== null
}
