import { createServer } from 'node:http'
import type { AppDeps } from './app/deps.js'
import { createAppDeps } from './app/deps.js'
import {
  readCodexIntegration,
  registerCodex,
  unregisterCodex,
  writeAgents,
  writeCodexConfig,
} from './app/codex-integration.js'
import { readSettings, writeSettings } from './app/settings.js'
import { accessToken, publishConnection } from './connection.js'
import type { IntegrationHandlers } from './domain/codex-integration.js'
import type { HostContext } from './host/host-types.js'
import { createCodexConfigAdapter } from './host/codex-config-adapter.js'
import { createInteractionAdapter } from './host/interaction-adapter.js'
import { createModelAdapter } from './host/model-adapter.js'
import { createPermissionAdapter } from './host/permission-adapter.js'
import { createSessionRegistry } from './host/registry-adapter.js'
import { createSessionAdapter } from './host/session-adapter.js'
import { createSettingsAdapter } from './host/settings-adapter.js'
import { installWebRoute } from './host/web-route.js'
import { createWorkspaceAdapter } from './host/workspace-adapter.js'
import { createMcpServer } from './mcp/dispatcher.js'
import { createMcpHandler, sendJson } from './transport/http.js'
import { createIntegrationHandler, INTEGRATION_ROUTE_PATH } from './transport/integration-route.js'
import { ROUTE_PATH, SETTINGS_ROUTE_PATH } from './transport/route.js'
import { createSettingsHandler } from './transport/settings-route.js'

export const name = 'codex-dsh-dispatch'
export interface Config { readonly enabled?: boolean; readonly stateHome?: string }

/**
 * 把真实用例接到设置页的 HTTP 面上。
 *
 * 放在组装根而不是 `src/transport/`：传输层只认 `IntegrationHandlers` 接口，
 * 一旦它自己 import `src/app/**` 就成了「传输层知道业务用例」——那正是 D5
 * 要挡住的方向。装配是组装根的职责。
 */
function createIntegrationHandlers(deps: AppDeps): IntegrationHandlers {
  return {
    readSettings: () => readSettings(deps),
    writeSettings: (update) => writeSettings(deps, update),
    readIntegration: () => readCodexIntegration(deps),
    writeConfig: (input) => writeCodexConfig(deps, input),
    register: () => registerCodex(deps),
    unregister: () => unregisterCodex(deps),
    writeAgents: (input) => writeAgents(input),
  }
}

/**
 * 两条通道，各自服务不同的调用方：
 *
 * - 独立回环端口（Bearer 凭据）：给 Codex 与进程外 CLI 用。Codex 是别的进程，
 *   它只能拿到 access.json 里的 token，所以这条必须自己鉴权。
 * - 宿主 webServer 上的 `/codex-dsh-dispatch/api`（同源可信判定）：给 DSH 界面
 *   里的设置页用。页面拿不到也不该拿 token，它靠「请求来自本机 DSH 界面」这一
 *   事实获得授权。
 *
 * 回环端口只提供派单与桥接默认值接口；Codex 配置与 AGENTS.md 的管理动作仅供
 * 原生设置页显式操作时调用，不作为 MCP 工具暴露。
 */
export async function apply(ctx: HostContext, config?: Config): Promise<void> {
  if (config?.enabled === false) return
  const deps = createAppDeps({
    workspace: createWorkspaceAdapter(ctx), session: createSessionAdapter(ctx),
    interaction: createInteractionAdapter(ctx), permission: createPermissionAdapter(ctx),
    model: createModelAdapter(ctx), registry: createSessionRegistry(ctx, config?.stateHome),
    settings: createSettingsAdapter(ctx, config?.stateHome),
    codex: createCodexConfigAdapter(ctx, config?.stateHome),
  })
  const token = await accessToken(config?.stateHome)
  const mcp = createMcpHandler(() => createMcpServer(deps), { token })
  const settings = createSettingsHandler({ read: () => readSettings(deps), write: update => writeSettings(deps, update) }, { token })
  const server = createServer((req, res) => {
    const path = req.url?.split('?')[0]
    const handler = path === ROUTE_PATH ? mcp : path === SETTINGS_ROUTE_PATH ? settings : null
    if (handler === null) { sendJson(res, 404, { error: 'not found' }); return }
    Promise.resolve(handler(req, res)).catch(cause => {
      ctx.logger.error('桥接请求失败：%s', cause instanceof Error ? cause.message : String(cause))
      if (!res.headersSent) sendJson(res, 500, { error: 'bridge request failed' })
      else res.end()
    })
  })
  ctx.effect(() => () => { server.close() }, 'codex-dsh-dispatch: listener')

  // 设置页用的同源通道。挂不上（宿主没有 webServer）不影响回环端口工作：
  // Codex 派单本身不依赖它，只有图形设置页会因此不可用。
  installWebRoute(
    ctx,
    INTEGRATION_ROUTE_PATH,
    createIntegrationHandler(createIntegrationHandlers(deps)),
    'codex-dsh-dispatch: settings api',
  )

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('桥接监听地址不可用')
  try {
    await publishConnection({ url: `http://127.0.0.1:${address.port}`, token }, config?.stateHome)
  } catch (cause) { server.close(); throw cause }
  ctx.logger.info('codex-dsh-dispatch 已就绪（仅本机回环端口 %d）', address.port)
}
