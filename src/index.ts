import { createServer } from 'node:http'
import { createAppDeps } from './app/deps.js'
import { readSettings, writeSettings } from './app/settings.js'
import { accessToken, publishConnection } from './connection.js'
import type { HostContext } from './host/host-types.js'
import { createInteractionAdapter } from './host/interaction-adapter.js'
import { createModelAdapter } from './host/model-adapter.js'
import { createPermissionAdapter } from './host/permission-adapter.js'
import { createSessionRegistry } from './host/registry-adapter.js'
import { createSessionAdapter } from './host/session-adapter.js'
import { createSettingsAdapter } from './host/settings-adapter.js'
import { createWorkspaceAdapter } from './host/workspace-adapter.js'
import { createMcpServer } from './mcp/dispatcher.js'
import { createMcpHandler, sendJson } from './transport/http.js'
import { ROUTE_PATH, SETTINGS_ROUTE_PATH } from './transport/route.js'
import { createSettingsHandler } from './transport/settings-route.js'

export const name = 'codex-dsh-dispatch'
export interface Config { readonly enabled?: boolean; readonly stateHome?: string }

/** 插件拥有自己的回环端口，不挂载 DSH 浏览器路由，也不改变其访问策略。 */
export async function apply(ctx: HostContext, config?: Config): Promise<void> {
  if (config?.enabled === false) return
  const deps = createAppDeps({
    workspace: createWorkspaceAdapter(ctx), session: createSessionAdapter(ctx),
    interaction: createInteractionAdapter(ctx), permission: createPermissionAdapter(ctx),
    model: createModelAdapter(ctx), registry: createSessionRegistry(ctx, config?.stateHome),
    settings: createSettingsAdapter(ctx, config?.stateHome),
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
