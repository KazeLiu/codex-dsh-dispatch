/**
 * 组装根：把宿主能力装配成端口，再把端口接到 MCP 传输层。
 *
 * 这一层是**唯一**允许接触宿主形状的地方之一（依赖规则 D1）；`src/` 内不
 * import 任何 `@deepseek-ai/*` 包（宿主没有 `.d.ts`，见 ADR-009），宿主契约
 * 由 `src/host/host-types.ts` 结构等价声明。
 *
 * 装配顺序刻意固定：先建端口 → 再建用例依赖 → 最后建传输处理器。任何一步
 * 失败都只影响本插件，不抛到宿主启动流程里（第 8 节失败隔离）。
 */

import { createAppDeps } from './app/deps.js'
import { readSettings, writeSettings } from './app/settings.js'
import { readService } from './host/context.js'
import type { HostContext } from './host/host-types.js'
import { createInteractionAdapter } from './host/interaction-adapter.js'
import { createModelAdapter } from './host/model-adapter.js'
import { createPermissionAdapter } from './host/permission-adapter.js'
import { createSessionRegistry } from './host/registry-adapter.js'
import { createSessionAdapter } from './host/session-adapter.js'
import { createSettingsAdapter } from './host/settings-adapter.js'
import { createWorkspaceAdapter } from './host/workspace-adapter.js'
import { dispatch } from './mcp/dispatcher.js'
import type { Ports } from './ports/index.js'
import { createMcpHandler } from './transport/http.js'
import { ROUTE_PATH, SETTINGS_ROUTE_PATH } from './transport/route.js'
import { createSettingsHandler } from './transport/settings-route.js'

/**
 * 插件名。
 *
 * 必须与 `cordis.patch.yml` 里的 row id 一致，否则宿主加载时找不到插件。
 */
export const name = 'dsh-mcp-bridge'

/**
 * 插件配置。
 *
 * 刻意**不含凭据**：客户端凭据只从环境变量 `DSH_MCP_BRIDGE_TOKEN` 读取，
 * 不进源码、不进 Git、不进 profile 配置、不进任务正文与日志（第 9 节）。
 */
export interface Config {
  /** 关掉整个插件（路由不注册、工具不可用）。缺省启用。 */
  readonly enabled?: boolean
  /** 覆盖状态文件所在的 DSH 主目录；缺省按 `$DSH_HOME` → `~/.dsh` 解析。 */
  readonly stateHome?: string
}

/**
 * 插件入口。
 *
 * 不声明 `inject`：宿主服务可能晚于本插件就绪（典型是 `webServer` 要等端口
 * 绑定），声明 inject 会让插件在服务缺失时根本不加载。改为在**调用时**用
 * `ctx.get()` 惰性读取：缺失就返回固定错误码 `host-capability-missing`，
 * 插件本身照常加载（第 8 节「可选服务」一行）。
 */
export function apply(ctx: HostContext, config?: Config): void {
  if (config?.enabled === false) {
    ctx.logger.info('dsh-mcp-bridge 已被配置禁用，跳过路由注册')
    return
  }

  const webServer = readService(ctx, 'webServer')
  if (webServer === undefined) {
    // 只 warn 不抛：webServer 未就绪是可预期的启动期状态，抛错会让整个
    // profile 加载失败，代价远大于「本插件暂时不可用」。
    ctx.logger.warn('webServer 服务不可用：跳过 %s 路由注册（插件已加载但工具不可达）', ROUTE_PATH)
    return
  }

  const ports = createPorts(ctx, config)
  const deps = createAppDeps(ports)
  const handler = createMcpHandler((message, signal) => dispatch(deps, message, signal))

  // 设置路由与 MCP 路由共用同一套本机认证围栏（第 9 节），但走独立的
  // REST 语义端点：设置是用户配置操作，不是任务派发。
  const settingsHandler = createSettingsHandler({
    read: () => readSettings(deps),
    write: (update) => writeSettings(deps, update),
  })

  let unregister: (() => void) | undefined
  let unregisterSettings: (() => void) | undefined
  try {
    unregister = webServer.register({ kind: 'exact', path: ROUTE_PATH, handler })
    unregisterSettings = webServer.register({
      kind: 'exact',
      path: SETTINGS_ROUTE_PATH,
      handler: settingsHandler,
    })
  } catch (cause) {
    // 路由注册失败（端口冲突、路径被占用）不该拖垮宿主，只报告。
    // 已注册成功的那条要回滚，避免留下半套端点。
    unregister?.()
    unregister = undefined
    ctx.logger.error('注册路由失败：%s / %s', ROUTE_PATH, SETTINGS_ROUTE_PATH, cause)
    return
  }

  ctx.logger.info(
    'dsh-mcp-bridge 已就绪：%s%s 与 %s（状态目录：%s）',
    webServer.getOrigin(),
    ROUTE_PATH,
    SETTINGS_ROUTE_PATH,
    config?.stateHome ?? '$DSH_HOME',
  )

  // 卸载时只收回本插件自己注册的路由；已创建的 DSH 会话保留，用户仍能在
  // 界面里看到并继续（第 8 节「卸载」一行）。
  //
  // 注意 `ctx.effect` 的语义：传入的函数会**立即执行**，它的**返回值**才是
  // 清理函数。写成 `ctx.effect(() => { unregister?.() })` 会在注册成功后当场
  // 注销路由（见 `@deepseek-ai/cordis/src/fiber.ts` 的 `effect`/`_execute`）。
  ctx.effect(
    () => () => {
      unregister?.()
      unregister = undefined
      unregisterSettings?.()
      unregisterSettings = undefined
    },
    'dsh-mcp-bridge: routes',
  )
}

/** 装配全部端口。 */
function createPorts(ctx: HostContext, config?: Config): Ports {
  return {
    workspace: createWorkspaceAdapter(ctx),
    session: createSessionAdapter(ctx),
    interaction: createInteractionAdapter(ctx),
    permission: createPermissionAdapter(ctx),
    model: createModelAdapter(ctx),
    registry: createSessionRegistry(ctx, config?.stateHome),
    settings: createSettingsAdapter(ctx, config?.stateHome),
  }
}
