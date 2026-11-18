/**
 * Codex 接入用例：读现场事实、写 MCP 登记、写协作规则。
 *
 * 这一层是「设置页背后的全部动作」，也是**唯一允许碰 Codex 配置的地方**：
 * 浏览器端只发意图，真正的 `codex mcp add/remove` 与 AGENTS.md 写盘都在这里
 * （在插件进程内），因此不需要把本机文件系统能力暴露给页面。
 *
 * 三条不变量：
 * - 读一律不抛错：设置页必须能打开，读不到就显示原因（见 `domain/codex-integration.ts`）；
 * - 写一律先确认：登记/移除/写规则都是用户点过确认按钮后的动作，本层只做
 *   「写前重新核对现场」，绝不静默覆盖同名服务器或别人的文件内容；
 * - 不伪造可用：Node 解析不出来就如实报错，不用宿主自己的可执行文件顶替。
 */

import { createHash } from 'node:crypto'

import {
  AgentsFileError,
  blockPresent,
  detectEol,
  overrideExists,
  readAgentsFile,
  removeBlock,
  renderBlock,
  resolveAgentsTarget,
  upsertBlock,
  writeAgentsFile,
} from '../codex/agents-file.js'
import { codexConfigPath } from '../codex/codex-home.js'
import { COLLABORATION_PROMPT } from '../codex/collaboration-prompt.js'
import {
  describeCurrent,
  inspectRegistration,
  isDisabled,
  register,
  resolveBinPath,
  unregister,
} from '../codex/mcp-registration.js'
import { resolveNodeRuntime } from '../codex/node-runtime.js'
import { readCodexConfigUpdate } from '../domain/codex-config.js'
import type {
  AgentsAction,
  AgentsFileView,
  CodexIntegrationSnapshot,
  CodexRegistrationView,
  CodexServerView,
} from '../domain/codex-integration.js'
import { bridgeError } from '../domain/errors.js'
import type { AppDeps } from './deps.js'

/** 写协作规则的入参。设置页只写全局；项目级走 CLI 的明确操作。 */
export interface WriteAgentsInput {
  readonly action: AgentsAction
  /**
   * 客户端看到的原文摘要；用于确认期间快照保护。
   *
   * 必填且允许 `null`：`null` 是「当时那个文件不存在」这一明确快照，不是
   * 「不检查」。把它当缺省跳过，会让「读的时候没有、确认前被人创建」这种
   * 冲突直接写穿。
   */
  readonly digest: string | null
}

/** 写协作规则的结果。 */
export interface WriteAgentsResult {
  readonly path: string
  /** 内容未变化（已经是最新）时为 `false`。 */
  readonly changed: boolean
  /** 同目录存在非空的 override 文件——它会挡住本次写入的内容。 */
  readonly overrideExists: boolean
}

/**
 * 读一份完整快照。
 *
 * 顺序是「配置 → Node → Codex → 规则」：Node 解析失败时不去问 Codex，因为此时
 * 连登记计划都拼不出来，问了也只会得到一串连带错误。
 */
export async function readCodexIntegration(deps: AppDeps): Promise<CodexIntegrationSnapshot> {
  const config = await deps.ports.codex.read()
  const registration = await describeRegistration(config.node)
  return { registration, agents: [await describeAgents('global')] }
}

/** 写「用户指定的 Node 路径」，返回新快照。 */
export async function writeCodexConfig(
  deps: AppDeps,
  input: unknown,
): Promise<CodexIntegrationSnapshot> {
  const config = readCodexConfigUpdate(input)
  if (config.node !== null) {
    const node = await resolveNodeRuntime(config.node)
    if (!node.ok) throw bridgeError('invalid-argument', node.message, { field: 'node' })
  }
  await deps.ports.codex.write(config)
  return readCodexIntegration(deps)
}

/**
 * 登记进 Codex。
 *
 * 确认由界面负责（用户点过「连接」），本层只做写前重查：`register()` 内部会
 * 再查一次同名条目，存在就报冲突而不是覆盖——那是 Codex 里别的服务器的配置。
 */
export async function registerCodex(deps: AppDeps): Promise<CodexIntegrationSnapshot> {
  const config = await deps.ports.codex.read()
  const state = await inspectRegistration({ node: config.node })
  await register(state)
  return readCodexIntegration(deps)
}

/** 从 Codex 移除本插件的登记；未登记时是空操作。 */
export async function unregisterCodex(deps: AppDeps): Promise<CodexIntegrationSnapshot> {
  const config = await deps.ports.codex.read()
  const state = await inspectRegistration({ node: config.node })
  await unregister(state)
  return readCodexIntegration(deps)
}

/**
 * 写或删协作规则。
 *
 * 两处保护缺一不可：
 * - `digest` 比对拦住「用户确认期间文件被别人改过」；
 * - `writeAgentsFile(..., expected)` 再拦一次「我们读到写之间的窗口」。
 * 两者都失败即放弃写入，宁可让用户重来一次，也不覆盖别人的内容。
 */
export async function writeAgents(input: WriteAgentsInput): Promise<WriteAgentsResult> {
  const target = resolveAgentsTarget('global')

  let existing: string | null
  try {
    existing = await readAgentsFile(target.path)
  } catch (cause) {
    throw asWritable(cause)
  }

  if (input.digest !== digestOf(existing)) {
    throw bridgeError(
      'invalid-argument',
      `${target.path} 已变化，本次未写入。请重新读取后再操作。`,
      { field: 'digest', path: target.path },
    )
  }

  const eol = detectEol(existing)
  const next =
    input.action === 'write'
      ? upsertBlock(existing, target.path, renderBlock(COLLABORATION_PROMPT, eol), eol)
      : existing === null
        ? null
        : removeBlock(existing, target.path, eol)

  if (next === null) {
    // 文件本来就不存在、又要删：无事可做，也不该顺手创建一个空文件。
    return { path: target.path, changed: false, overrideExists: await safeOverride(target) }
  }

  let changed: boolean
  try {
    changed = await writeAgentsFile(target.path, next, existing)
  } catch (cause) {
    throw asWritable(cause)
  }
  return { path: target.path, changed, overrideExists: await safeOverride(target) }
}

/* ------------------------------------------------------------------ *
 * 内部：把现场事实翻成展示形状
 * ------------------------------------------------------------------ */

async function describeRegistration(configuredNode: string | null): Promise<CodexRegistrationView> {
  const base = {
    configPath: codexConfigPath(),
    bin: resolveBinPath(),
    configuredNode,
  }
  const nodeResult = await resolveNodeRuntime(configuredNode)
  const node = nodeResult.ok
    ? { path: nodeResult.runtime.path, version: nodeResult.runtime.version, source: nodeResult.runtime.source }
    : null
  const nodeError = nodeResult.ok ? null : nodeResult.message

  // Node 都解析不出来时不去问 Codex：登记命令拼不出来，问了也只会得到连带错误。
  if (!nodeResult.ok) {
    return {
      ...base,
      node,
      nodeError,
      cli: { found: false, description: null, error: null },
      server: EMPTY_SERVER,
      error: null,
    }
  }

  try {
    const state = await inspectRegistration({ node: configuredNode })
    const server = state.server
    const view: CodexServerView = {
      registered: server !== null,
      enabled: server !== null && !isDisabled(server),
      matchesCurrent: state.matchesCurrent,
      description: server === null ? null : describeCurrent(server),
    }
    return {
      configPath: base.configPath,
      bin: state.plan.bin,
      configuredNode,
      node,
      nodeError,
      cli: { found: true, description: state.invocation.description, error: null },
      server: view,
      error: null,
    }
  } catch (cause) {
    const message = messageOf(cause)
    return {
      ...base,
      node,
      nodeError,
      cli: { found: false, description: null, error: message },
      server: EMPTY_SERVER,
      error: message,
    }
  }
}

const EMPTY_SERVER: CodexServerView = {
  registered: false,
  enabled: false,
  matchesCurrent: false,
  description: null,
}

async function describeAgents(scope: 'global'): Promise<AgentsFileView> {
  const target = resolveAgentsTarget(scope)
  const shell = {
    scope,
    path: target.path,
    overridePath: target.overridePath,
  }
  try {
    const existing = await readAgentsFile(target.path)
    return {
      ...shell,
      overrideExists: await overrideExists(target),
      present: blockPresent(existing, target.path),
      digest: digestOf(existing),
      error: null,
    }
  } catch (cause) {
    return {
      ...shell,
      overrideExists: false,
      present: false,
      digest: null,
      error: messageOf(cause),
    }
  }
}

/* ------------------------------------------------------------------ *
 * 内部：小工具
 * ------------------------------------------------------------------ */

/**
 * 原文摘要。
 *
 * 只用于「还是不是同一份内容」的判断，因此取 sha256 十六进制即可；
 * 文件不存在用 `null` 与「空文件」区分开——两者对写入的含义不同。
 */
function digestOf(text: string | null): string | null {
  if (text === null) return null
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function safeOverride(target: ReturnType<typeof resolveAgentsTarget>): Promise<boolean> {
  try {
    return await overrideExists(target)
  } catch {
    return false
  }
}

/**
 * 把文件层错误翻成可展示的 400。
 *
 * 这些错误（标记不配对、确认期间被改过）都是「当前状态不允许这次写入」，
 * 属于用户可自行修复的情形，不该报 500 让人以为插件坏了。
 */
function asWritable(cause: unknown): Error {
  if (cause instanceof AgentsFileError) {
    return bridgeError('invalid-argument', cause.message, { field: 'agents' })
  }
  return cause instanceof Error ? cause : new Error(String(cause))
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
