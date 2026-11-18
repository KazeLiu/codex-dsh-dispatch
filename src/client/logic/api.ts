/**
 * 设置页到插件后端的调用面。
 *
 * 全部走同源相对路径 `/codex-dsh-dispatch/api`：页面由宿主的 webServer 提供，
 * 相对路径自然落在同一个 origin 上，不需要也不应该拿 access.json 的凭据。
 * 服务端用 `isTrustedApiRequest` 判定「请求来自本机 DSH 界面」。
 *
 * 失败一律归一化成 `CdApiError`：调用方只需要展示 `message`，不需要区分
 * fetch 抛错、非 2xx、响应体不是 JSON 这几种情况。
 *
 * 注意命名：所有片段共享同一个工厂作用域，函数名重复会被后者覆盖。这里统一
 * 用 `cdApi*` 前缀，避免与 store 的 `cdRequest`（发起确认）撞名。
 */

const CD_API_BASE = '/codex-dsh-dispatch/api'

class CdApiError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CdApiError'
    this.code = code
  }
}

async function cdApiRequest(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(CD_API_BASE + path, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    })
  } catch (cause) {
    throw new CdApiError(
      'unreachable',
      cause instanceof Error ? `无法连接插件后端：${cause.message}` : '无法连接插件后端，请确认插件已启用。',
    )
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (response.ok) return payload

  const detail = cdApiErrorText(payload)
  if (response.status === 403) {
    throw new CdApiError('forbidden', detail ?? '请求来源不被信任，请从 DSH 界面里打开设置。')
  }
  if (response.status === 404) {
    throw new CdApiError('route-missing', detail ?? '插件后端还没挂上路由，请确认插件已启用并重启 DSH。')
  }
  throw new CdApiError(`http-${response.status}`, detail ?? `请求失败（HTTP ${response.status}）。`)
}

/** 后端失败体有两种形状：`{error: '...'}` 与 `{error: {code, message}}`。 */
function cdApiErrorText(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null
  const error = (payload as { error?: unknown }).error
  if (typeof error === 'string') return error === '' ? null : error
  if (error !== null && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return null
}

function cdErrorMessage(cause: unknown): string {
  if (cause instanceof CdApiError) return cause.message
  if (cause instanceof Error) return cause.message
  return String(cause)
}

async function cdApiReadSettings(): Promise<CdSettingsSnapshot> {
  const payload = await cdApiRequest('/settings')
  return payload as CdSettingsSnapshot
}

async function cdApiWriteSettings(update: CdSettingsUpdate): Promise<CdSettingsSnapshot> {
  const payload = await cdApiRequest('/settings', {
    method: 'PUT',
    body: JSON.stringify(update),
  })
  return payload as CdSettingsSnapshot
}

async function cdApiReadIntegration(): Promise<CdIntegrationSnapshot> {
  const payload = await cdApiRequest('/integration')
  return payload as CdIntegrationSnapshot
}

async function cdApiWriteNode(node: string | null): Promise<CdIntegrationSnapshot> {
  const payload = await cdApiRequest('/config', {
    method: 'PUT',
    body: JSON.stringify({ node }),
  })
  return payload as CdIntegrationSnapshot
}

async function cdApiRegister(): Promise<CdIntegrationSnapshot> {
  const payload = await cdApiRequest('/register', { method: 'POST' })
  return payload as CdIntegrationSnapshot
}

async function cdApiUnregister(): Promise<CdIntegrationSnapshot> {
  const payload = await cdApiRequest('/unregister', { method: 'POST' })
  return payload as CdIntegrationSnapshot
}

interface CdAgentsWriteResult {
  readonly path: string
  readonly changed: boolean
  readonly overrideExists: boolean
}

async function cdApiWriteAgents(input: {
  action: CdAgentsAction
  digest: string | null
}): Promise<CdAgentsWriteResult> {
  const payload = await cdApiRequest('/agents', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return payload as CdAgentsWriteResult
}
