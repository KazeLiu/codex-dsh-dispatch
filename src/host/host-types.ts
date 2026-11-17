/**
 * 宿主类型窄化声明。
 *
 * 为什么手写而不是 `import type { Context } from '@deepseek-ai/cordis'`：
 * 本机 `app.asar/node_modules/@deepseek-ai/*` 的 `.d.ts` 文件总数为 **0**
 * （各包 `package.json` 的 `types` 都指向 `./lib/types/index.d.ts`，但该文件
 * 不存在，`lib/types/` 里只有 `.js`），且该 scope 在公共 registry 上不存在。
 * 因此任何 `@deepseek-ai/*` 的 import 都会在 tsc 下解析失败。
 *
 * 做法：只声明本插件**实际用到**的成员，签名照 asar 内 `src/*.ts` 抄写，
 * 并在注释里标来源行号。`apply(ctx: HostContext, ...)` 的 `ctx` 用本文件的
 * 结构类型——cordis 是结构化调用（`ctx.get` / `ctx.effect` / `ctx.logger`），
 * 不依赖类型身份，所以名义不一致是可接受的代价。
 *
 * 维护约定：宿主升级后若这些成员签名变化，只需改这一个文件。
 */

/** 最小日志接口（`ctx.logger`）。 */
export interface HostLogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/**
 * 工作区实体。
 * 来源：dsh-workspace/src/types.ts:70 `interface Workspace`。
 */
export interface HostWorkspace {
  readonly id: string
  /** realpath 规范化后的绝对路径。 */
  readonly path: string
  readonly title: string
}

/**
 * 工作区注册表。
 * 来源：dsh-workspace/src/index.ts:255 `async create(path, title?)`。
 */
export interface HostWorkspaceRegistry {
  create(path: string, title?: string): Promise<HostWorkspace>
  get(id: string): HostWorkspace | undefined
  list(): HostWorkspace[]
}

/** 会话状态。来源：dsh-api-session-controller/src/types.ts:612。 */
export interface HostSessionState {
  readonly cursor: number
  readonly active: boolean
  readonly running: boolean
  readonly queue: readonly unknown[] | null
  readonly pendingInput: readonly string[]
}

/** 历史记录条目。来源：dsh-api-session-controller/src/types.ts:429。 */
export interface HostSessionEventEntry {
  readonly type: 'event'
  readonly event: {
    readonly type: string
    readonly seq: number
    readonly time: number
    readonly data: unknown
  }
}

/** 等待结果。来源：dsh-api-session-controller/src/types.ts:646。 */
export interface HostSessionWaitValue {
  readonly reason: 'idle' | 'input-required' | 'timeout'
  readonly state: HostSessionState
  readonly output: {
    readonly records: readonly HostSessionEventEntry[]
    readonly truncated: boolean
  }
}

/** 模型选择。来源：dsh-api-session-controller/src/types.ts:92。 */
export interface HostModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** 模型目录里的一项。来源：dsh-api-session-controller/src/types.ts:344 起。 */
export interface HostModelCatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: {
    readonly efforts: readonly { readonly id: string; readonly name: string }[]
    readonly defaultEffort?: string
  }
}

export interface HostModelCatalog {
  readonly default: HostModelSelection
  readonly routableProviders: readonly string[]
  readonly groups: readonly {
    readonly id: string
    readonly name: string
    readonly models: readonly HostModelCatalogModel[]
  }[]
  readonly failures: readonly unknown[]
}

/**
 * 会话控制器。
 * 来源：dsh-api-session-controller/src/index.ts:307/317/468/520/576/598。
 */
export interface HostSessionController {
  create(request: {
    workspaceId?: string
    cwd?: string
    agentPreset?: string
  }): Promise<{ sessionId: string; agentPreset?: string }>
  selectModel(request: {
    sessionId: string
    provider: string
    model: string
    reasoningEffort?: string
  }): Promise<{ selected: HostModelSelection }>
  modelCatalog(): Promise<HostModelCatalog>
  resolveAgent(sessionId: string): Promise<{ agent: HostAgent } | { error: unknown }>
  prompt(
    request: {
      requestId: string
      sessionId: string
      mode: 'queue' | 'steer'
      content: readonly { readonly type: 'text'; readonly text: string }[]
    },
    signal: AbortSignal,
  ): Promise<{ accepted: true }>
  cancel(request: { sessionId: string }): { accepted: true }
  state(request: { sessionId: string }, signal: AbortSignal): Promise<HostSessionState>
  /**
   * 历史分页。
   * 来源：dsh-api-session-controller/src/index.ts:544
   * `events(request: SessionPageRequest, signal): Promise<SessionEventsPage>`。
   * 返回的 `records` 是**时间正序**（`history.ts` 的 `paginate` 用 `slice(cut, end)`）。
   */
  events(
    request: {
      address: { kind: 'session'; sessionId: string }
      throughSeq?: number
      beforeSeq?: number
      maxMessages?: number
    },
    signal: AbortSignal,
  ): Promise<{
    cursor: number
    records: readonly HostSessionEventEntry[]
    hasMore: boolean
  }>
  wait(
    request: {
      sessionId: string
      timeoutMs?: number
      afterSeq?: number
      maxMessages?: number
    },
    signal: AbortSignal,
  ): Promise<HostSessionWaitValue>
}

/** 权限预设选项。来源：dsh-permission-presets/src/index.ts:385 `optionOf`。 */
export interface HostPresetOption {
  readonly value: string
  readonly name: string
  readonly description?: string
}

/**
 * 权限预设服务。
 * 来源：dsh-permission-presets/src/index.ts:284/292/324/344/370/399。
 */
export interface HostPermissionPresets {
  readonly names: readonly string[]
  readonly defaultPreset: string
  catalog(): {
    readonly options: readonly HostPresetOption[]
    readonly defaultOptions: readonly HostPresetOption[]
    readonly defaultPreset: string
  }
  current(session: unknown): string
  set(session: unknown, name: string): void
}

/** 会话实体（`permissionPresets.set` 需要活对象）。来源：dsh-session/src/index.ts:556。 */
export interface HostSession {
  readonly id: string
  readonly seq: number
  snapshotEvents(offset?: number): readonly HostSessionEventEntry['event'][]
}

/** 会话存储。来源：dsh-session/src/index.ts:1456/1464。 */
export interface HostSessionStore {
  get(id: string): HostSession | undefined
  list(): HostSession[]
}

/**
 * 会话投影注册表。
 * 来源：dsh-session-projection/src/index.ts:456 `stateOf(session, key)`。
 *
 * 注意 `stateOf(session, key)` 已标 `@deprecated`，官方建议用等待注册后的
 * `handle.stateOf(session)` 或领域服务。这里仍用它，因为本插件是**只读消费方**：
 * 不注册自己的投影，也拿不到别的插件的 `handle`；而 `userQuestions` 投影的
 * 领域服务（`UserQuestionService`）没有「列出挂起提问」的读接口。
 * 宿主升级若移除该方法，只需改本文件与 `interaction-adapter.ts`。
 */
export interface HostSessionProjections {
  stateOf(session: HostSession, key: string): unknown
}

/**
 * 活 agent 实体。
 * 来源：dsh-agent/src/index.ts `class Agent`（`get(id)` 返回的实例）。
 *
 * 只声明本插件用到的成员：`UserQuestionService.answer` 会用
 * `agents.get(agent.id) !== agent` 校验「这是不是当前那个活实例」，
 * 所以必须原样传回从 `agents.get()` 拿到的对象，不能自己造一个。
 */
export interface HostAgent {
  readonly id: string
  readonly session: HostSession
  readonly model: {
    select(selection: HostModelSelection): void
    current(): HostModelSelection | undefined
  }
}

/** agent 服务。来源：dsh-agent/src/index.ts:301 `turnBoundaryOf`、:581 `get`。 */
export interface HostAgents {
  turnBoundaryOf(session: HostSession): {
    readonly openTurnStartSeq: number | null
    readonly lastTurn: number
  }
  /** 取活 agent；会话未挂载时返回 `undefined`。 */
  get(id: string): HostAgent | undefined
}

/**
 * 提问服务。
 * 来源：dsh-user-questions/src/index.ts:170 `answer(agent, callId, answer)`。
 *
 * 语义要点（照抄宿主实现）：
 * - `assertLiveRoot` 要求 `agents.get(agent.id) === agent`，且
 *   `agent.session.header.origin !== 'subagent'`；
 * - callId 必须仍在 `continued` 态，否则**返回 `false`**（不抛错）；
 * - 已有排队回复抛 `REPLY_QUEUED`，答案批次不完整抛 `BAD_ANSWER`。
 */
export interface HostUserQuestions {
  answer(
    agent: HostAgent,
    callId: string,
    answer: {
      readonly answers: readonly {
        readonly id: string
        readonly selected: readonly string[]
        readonly custom?: string
      }[]
    },
  ): boolean
}

/** 路由处理器。来源：dsh-host-webserver/src/index.ts。 */
export type HostRouteHandler = (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
) => void | Promise<void>

export interface HostWebRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: HostRouteHandler
}

/**
 * HTTP 服务。
 * 来源：dsh-host-webserver/src/index.ts `class WebServer`。
 * `Config.host` 在加载期拒绝 `0.0.0.0` / `::`，因此监听地址天然是具体本地接口。
 */
export interface HostWebServer {
  readonly port: number
  readonly host: string
  readonly protocol: 'http:' | 'https:'
  getOrigin(): string
  register(route: HostWebRoute): () => void
}

/**
 * 插件上下文（窄化）。
 *
 * 只声明本插件用到的成员。所有可选服务都通过 `get()` 惰性读取——服务可能
 * 晚于 `apply` 就绪，直接当属性访问会拿到 `undefined` 而不报错。
 */
export interface HostContext {
  readonly logger: HostLogger
  get(serviceName: string): unknown
  /**
   * 注册清理函数。
   *
   * **`execute` 会被立即同步执行，它的返回值才是清理函数**——不是「在
   * `execute` 体内做清理」。来源：`@deepseek-ai/cordis/src/fiber.ts` 的
   * `effect()` 体内直接 `this._execute(runner)`，`_execute` 把返回的函数
   * 收集为 disposer（`undefined`/`null` 放行，其它非函数类型抛 TypeError）。
   *
   * 因此正确写法是 `ctx.effect(() => () => cleanup())`；写成
   * `ctx.effect(() => { cleanup() })` 会在注册当场执行一次清理。
   */
  effect(execute: () => (() => void) | void, label?: string): void
}
