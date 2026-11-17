/**
 * 宿主服务读取：把 `ctx.get(name)` 的 `unknown` 收敛成具体窄化类型。
 *
 * 为什么统一走 `get()` 而不是 `ctx.xxx` 属性：宿主服务可能晚于 `apply` 就绪
 * （典型是 `webServer` 要等监听端口绑定），直接属性访问会静默拿到 `undefined`。
 * 用 `get()` 在**调用时**读取，缺失就返回 `undefined`，由调用方决定是报错还是降级。
 */

import { bridgeError } from '../domain/errors.js'
import type {
  HostAgents,
  HostContext,
  HostPermissionPresets,
  HostSessionController,
  HostSessionProjections,
  HostSessionStore,
  HostUserQuestions,
  HostWebServer,
  HostWorkspaceRegistry,
} from './host-types.js'

/** 宿主服务名 → 窄化类型。 */
interface ServiceMap {
  webServer: HostWebServer
  workspaceRegistry: HostWorkspaceRegistry
  sessionController: HostSessionController
  permissionPresets: HostPermissionPresets
  sessions: HostSessionStore
  sessionProjections: HostSessionProjections
  agents: HostAgents
  userQuestions: HostUserQuestions
}

/**
 * 读取一个可选服务。
 *
 * 返回 `undefined` 表示服务当前不可用；不抛错，因为「不可用」是可预期的
 * 启动期状态，不是异常。
 */
export function readService<K extends keyof ServiceMap>(
  ctx: HostContext,
  name: K,
): ServiceMap[K] | undefined {
  const candidate = ctx.get(name)
  if (candidate === null || typeof candidate !== 'object') return undefined
  return candidate as ServiceMap[K]
}

/**
 * 读取一个必需服务。
 *
 * 缺失时抛 `host-capability-missing`——这是配置问题，必须让用户看见，
 * 不能静默降级成「功能不可用」。
 */
export function requireService<K extends keyof ServiceMap>(
  ctx: HostContext,
  name: K,
): ServiceMap[K] {
  const service = readService(ctx, name)
  if (service === undefined) {
    throw bridgeError('host-capability-missing', `宿主缺少必需服务 "${name}"，本插件无法工作`, {
      service: name,
    })
  }
  return service
}
