/**
 * 路由契约的本地结构化声明。
 *
 * 为什么不 import 宿主包：依赖规则 D1 要求 `src/` 内 `@deepseek-ai/*` 的 import
 * 数为 0（宿主没有 `.d.ts`，见 ADR-009）。这里按结构等价声明最小契约，
 * 宿主 `webServer.register()` 是结构化调用，不依赖类型身份。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** 路由处理器：拥有完整响应生命周期，可以长挂（SSE 的落地方式）。 */
export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

/** 一条路由。`kind: 'prefix'` 表示按前缀匹配。 */
export interface Route {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: RouteHandler
}

/** 注册表：宿主 `WebServer` 满足这个形状。 */
export interface RouteRegistry {
  register(route: Route): () => void
}

/** 本插件占用的 MCP 路由前缀。 */
export const ROUTE_PATH = '/mcp/dsh-mcp-bridge'

/**
 * 设置读写路由（TUI 与其它本机配置客户端用）。
 *
 * 刻意与 MCP 路由分开：`/mcp/dsh-mcp-bridge` 说的是 MCP 协议，而设置是普通
 * REST 语义（`GET` 读快照、`PUT` 写默认值），混进 MCP 端点会让一个只认
 * JSON-RPC 的客户端把设置请求当成非法帧。
 */
export const SETTINGS_ROUTE_PATH = '/mcp/settings'
