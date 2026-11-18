import { fileURLToPath } from 'node:url'
import {
  CodexCliError,
  addMcpServer,
  describeTransport,
  getMcpServer,
  removeMcpServer,
  resolveCodexCli,
  type CodexInvocation,
  type McpServerInfo,
} from './codex-cli.js'
import { resolveNodeRuntime } from './node-runtime.js'

/**
 * 把本包登记成 Codex 的 stdio MCP 服务器。
 *
 * 登记内容固定是「node + 当前包里的 bin + mcp 子命令」：
 * 用绝对路径，Codex 从任意工作目录启动都能找到；不写任何认证信息，
 * 端口与令牌由插件运行时写进 DSH 数据目录，由代理自己读。
 */

export const SERVER_NAME = 'codex-dsh-dispatch'

/** 发布产物里 bin 与 lib 同级，所以从 lib/codex/ 往上两级就是包根。 */
export function resolveBinPath(): string {
  return fileURLToPath(new URL('../../bin/codex-dsh-dispatch.mjs', import.meta.url))
}

export interface RegistrationPlan {
  readonly node: string
  readonly bin: string
  readonly args: readonly string[]
}

/**
 * 生成登记计划。
 *
 * `node` 必须由调用方给出**解析好的** Node 路径，不能用 `process.execPath`
 * 顶替：桌面端宿主下那是 `DSH.exe`，登记进 Codex 后根本跑不起来。
 */
export function planRegistration(node: string): RegistrationPlan {
  return { node, bin: resolveBinPath(), args: ['mcp'] }
}

export interface RegistrationState {
  readonly invocation: CodexInvocation
  readonly plan: RegistrationPlan
  /** 已登记的服务器；未登记为 null。 */
  readonly server: McpServerInfo | null
  /** 已登记且指向当前 node + 当前 bin。 */
  readonly matchesCurrent: boolean
}

export interface InspectOptions {
  /** 用户配置的 node 绝对路径；缺省按 PATH 解析。 */
  readonly node?: string | null
}

export async function inspectRegistration(options?: InspectOptions): Promise<RegistrationState> {
  const invocation = await resolveCodexCli({ node: options?.node ?? null })
  const node = await resolveNodeForPlan(options?.node ?? null)
  const plan = planRegistration(node)
  const server = await getMcpServer(invocation, SERVER_NAME)
  return { invocation, plan, server, matchesCurrent: server !== null && isCurrent(server, plan) }
}

async function resolveNodeForPlan(configured: string | null): Promise<string> {
  const resolved = await resolveNodeRuntime(configured)
  if (!resolved.ok) throw new CodexCliError(resolved.message)
  return resolved.runtime.path
}

/**
 * 比较路径用。只统一分隔符；大小写只在确实不区分大小写的平台上折叠，
 * 否则 POSIX 上 `/a/B` 与 `/a/b` 会被误判成同一个入口。
 */
function normalize(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed
}

function isCurrent(server: McpServerInfo, plan: RegistrationPlan): boolean {
  const transport = server.transport
  if (transport.command === null) return false
  if (normalize(transport.command) !== normalize(plan.node)) return false
  if (transport.args.length !== plan.args.length + 1) return false
  if (normalize(transport.args[0] ?? '') !== normalize(plan.bin)) return false
  return transport.args.slice(1).every((arg, index) => arg === plan.args[index])
}

export function describeCurrent(server: McpServerInfo): string {
  return describeTransport(server)
}

/** 已登记但被停用时，不能当成可用状态汇报。 */
export function isDisabled(server: McpServerInfo): boolean {
  return !server.enabled
}

/** 停用状态下的处置建议：Codex 侧启用，或移除后重新登记。 */
export const DISABLED_HINT = '它在 Codex 里处于停用状态，现在不会加载；请在 Codex 里启用它，或先移除再重新登记。'

/** 直接登记。调用方必须先确认（同名已存在时尤其不能静默覆盖）。 */
export async function register(state: RegistrationState): Promise<void> {
  // 确认菜单打开期间配置也可能变化，写入前重新检查同名条目。
  if (await getMcpServer(state.invocation, SERVER_NAME) !== null) {
    throw new CodexCliError(
      `Codex 里已经有名为 ${SERVER_NAME} 的 MCP 服务器，请先移除或改名后再登记，避免覆盖现有配置。`,
    )
  }
  await addMcpServer(state.invocation, SERVER_NAME, state.plan.node, [state.plan.bin, ...state.plan.args])
}

export async function unregister(state: RegistrationState): Promise<void> {
  if (state.server === null) return
  await removeMcpServer(state.invocation, SERVER_NAME)
}
