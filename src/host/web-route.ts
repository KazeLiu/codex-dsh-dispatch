/**
 * 把插件的 HTTP 面挂到宿主自己的 webServer 上。
 *
 * 为什么不用第二个端口：设置页在 DSH 的界面里，它发出的请求天然是同源的。
 * 挂到宿主的 webServer 上，页面用相对路径 fetch 就能到，不需要开「允许浏览器
 * 访问」、不需要把 token 塞进页面、也不需要为 Codex 配置管理再开一个监听端口。
 *
 * 本文件只负责「挂载」；「这个请求该不该放行」属于 HTTP 语义，在
 * `transport/trusted.ts` 里判定，避免 host 层掺进协议规则。
 */

import type { HostContext, HostRouteHandler, HostWebServer } from './host-types.js'

/**
 * 注册一条 prefix 路由，并在 `webServer` 晚就绪时补挂一次。
 *
 * `webServer` 可能比本插件晚就绪（`cordis.patch.yml` 里刻意不声明依赖），所以
 * 先尝试挂载；拿不到服务就订阅一次 `'internal/service'`，等它出现后挂上并立刻
 * 退订。只重试一次：服务一旦就绪就不会再消失，反复监听没有意义。
 */
export function installWebRoute(
  ctx: HostContext,
  path: string,
  handler: HostRouteHandler,
  label: string,
): void {
  if (attach(ctx, path, handler, label)) return

  let stopRetry: (() => boolean) | undefined
  const retry = (name: string): void => {
    if (name !== 'webServer') return
    if (!attach(ctx, path, handler, label)) return
    const dispose = stopRetry
    stopRetry = undefined
    if (typeof dispose === 'function') dispose()
  }
  stopRetry = ctx.on('internal/service', retry)
}

function attach(
  ctx: HostContext,
  path: string,
  handler: HostRouteHandler,
  label: string,
): boolean {
  const webServer = ctx.get('webServer')
  if (!isWebServer(webServer)) return false
  const disposer = webServer.register({ kind: 'prefix', path, handler })
  ctx.effect(() => disposer, label)
  return true
}

function isWebServer(value: unknown): value is HostWebServer {
  if (value === null || typeof value !== 'object') return false
  return typeof (value as { register?: unknown }).register === 'function'
}
