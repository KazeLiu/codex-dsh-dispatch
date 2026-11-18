/**
 * Codex 接入的展示形状（设置页与 REST 路由共用）。
 *
 * 为什么放在 `domain/`：传输层不允许 import `app/`（依赖规则 D5），而它必须
 * 知道返回体的结构。这里只有纯类型与零运行时依赖，两端都能安全引用。
 *
 * 所有「读不到」都用 `null` + 一个 `error` 字段表达，**不用抛错**：设置页必须
 * 能打开，否则用户连「为什么连不上」都看不到。
 */

import type { SettingsSnapshot } from './settings.js'

/** Node 可执行文件的来源，用于界面区分「自动解析」与「用户指定」。 */
export type CodexNodeSource = 'process' | 'configured' | 'path'

export interface CodexNodeView {
  readonly path: string
  /** 执行 `--version` 得到的版本号；拿不到时为 `null`。 */
  readonly version: string | null
  readonly source: CodexNodeSource
}

/** Codex 命令本身的解析结果。 */
export interface CodexCliView {
  readonly found: boolean
  /** 例如 `C:\...\codex.cmd（用 Node 启动 ...\codex.js）`。 */
  readonly description: string | null
  readonly error: string | null
}

/** 同名 MCP 服务器在 Codex 里的现状。 */
export interface CodexServerView {
  readonly registered: boolean
  readonly enabled: boolean
  /** 已登记且正好指向「当前 Node + 当前 bin」。 */
  readonly matchesCurrent: boolean
  /** 脱敏后的传输描述；未登记为 `null`。 */
  readonly description: string | null
}

/** 登记相关的全部现场事实。 */
export interface CodexRegistrationView {
  /** Codex 的 MCP 配置文件路径，只用于展示。 */
  readonly configPath: string
  /** 本插件要登记进 Codex 的入口脚本绝对路径。 */
  readonly bin: string
  /**
   * 用户**保存的** Node 路径（`codex.json` 里的原值）；没填为 `null`。
   *
   * 必须与 `node` 分开：编辑框要回显「用户配置了什么」，事实行要显示「实际
   * 解析到了什么」。混成一个字段时，自动解析出的路径会被当成用户配置回填，
   * 于是「自动」看起来像「手动指定」，用户再清空也回不到自动。
   */
  readonly configuredNode: string | null
  /** 实际解析出来的 Node；解析失败为 `null`（原因见 `nodeError`）。 */
  readonly node: CodexNodeView | null
  readonly nodeError: string | null
  readonly cli: CodexCliView
  readonly server: CodexServerView
  /** 读取 Codex 现状时的失败原因；成功为 `null`。 */
  readonly error: string | null
}

/** 全局 AGENTS.md 的托管区块现状。设置页只管全局；项目级仍由 CLI 明确操作。 */
export interface AgentsFileView {
  readonly scope: 'global'
  readonly path: string
  readonly overridePath: string
  /** 同目录的覆盖文件存在且非空——它的优先级更高，会挡住本文件。 */
  readonly overrideExists: boolean
  /** 托管区块是否已存在。 */
  readonly present: boolean
  /**
   * 当前文件内容的摘要；文件不存在为 `null`。
   *
   * 客户端把它原样回传，服务端写前重算并比对——这就是「确认期间原文快照
   * 保护」：期间有人改过文件，本次写入直接放弃，而不是覆盖掉别人的改动。
   */
  readonly digest: string | null
  readonly error: string | null
}

export interface CodexIntegrationSnapshot {
  readonly registration: CodexRegistrationView
  /** 只有全局一份。项目级 AGENTS 由 CLI 明确操作，页面不碰。 */
  readonly agents: readonly AgentsFileView[]
}

/** 写协作规则的动作。 */
export type AgentsAction = 'write' | 'remove'

/**
 * 传输层解析出来的写规则请求。
 *
 * 字段校验（枚举、类型）在传输层做，因为那属于请求形状问题；这里只是把
 * 「已经校验过的形状」固定下来，让传输层与用例层不必互相 import。
 */
export interface AgentsWriteRequest {
  readonly action: AgentsAction
  readonly digest: string | null
}

/**
 * 设置页 HTTP 面需要的一组回调。
 *
 * 传输层只认这个接口，由组装根注入真实用例——这样 `src/transport/**` 不必
 * import `src/app/**`（依赖规则 D5），接口本身又有个稳定的家。
 */
export interface IntegrationHandlers {
  readonly readSettings: () => Promise<SettingsSnapshot>
  readonly writeSettings: (update: unknown) => Promise<SettingsSnapshot>
  readonly readIntegration: () => Promise<unknown>
  readonly writeConfig: (input: unknown) => Promise<unknown>
  readonly register: () => Promise<unknown>
  readonly unregister: () => Promise<unknown>
  readonly writeAgents: (input: AgentsWriteRequest) => Promise<unknown>
}
