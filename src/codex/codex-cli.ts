import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { resolveNodeRuntime } from './node-runtime.js'
import { findOnPath, isFile } from './path-scan.js'

/**
 * Codex 官方 CLI 的调用适配层。
 *
 * 只做两件事：解析出一个**可以安全 execFile** 的调用方式，以及把
 * `codex mcp ...` 的结果结构化。刻意不直接读写 `~/.codex/config.toml`：
 * 配置格式属于 Codex，改由官方 CLI 落地，才不会碰到别的 MCP 服务器。
 *
 * 这一层同时被 TUI 与插件后端使用，所以放在 `src/codex/` 而不是 `src/tui/`：
 * 后端要复用同一套「怎么调 codex」的判断，不能复制一份同义实现。
 */

/** 一次 codex 调用的结果。非零退出码也走正常返回，由调用方判断语义。 */
export interface CodexResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** 可执行的调用方式：命令 + 固定前导参数（用 Node 启动 codex.js 时需要）。 */
export interface CodexInvocation {
  readonly command: string
  readonly prefixArgs: readonly string[]
  readonly description: string
}

export class CodexCliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexCliError'
  }
}

/** 从 `codex mcp get --json` 里取出的最小信息。 */
export interface McpServerTransport {
  readonly type: string
  readonly command: string | null
  readonly args: readonly string[]
  readonly url: string | null
}

export interface McpServerInfo {
  readonly name: string
  readonly enabled: boolean
  readonly transport: McpServerTransport
}

const WINDOWS_CANDIDATES = ['codex.exe', 'codex.cmd', 'codex.bat', 'codex'] as const
const POSIX_CANDIDATES = ['codex'] as const

export interface ResolveCodexOptions {
  /**
   * 用来启动 `codex.js` 的 node 绝对路径。
   *
   * 不传时按 PATH 解析真正的 Node（见 `node-runtime.ts`）。**不能**回退到
   * `process.execPath`：桌面端宿主下那是 `DSH.exe`。
   */
  readonly node?: string | null
}

/**
 * 解析 codex 命令。
 *
 * Windows 上 npm 安装的 `codex` 是 `.cmd` 包装脚本，不能直接 execFile，
 * 而 `shell: true` 会把参数拼成命令行（用户输入会变成注入面）。这里改为
 * 定位同目录 `node_modules/@openai/codex/bin/codex.js`，用 Node 启动，
 * 参数仍然以数组形式传递。
 */
export async function resolveCodexCli(options?: ResolveCodexOptions): Promise<CodexInvocation> {
  const candidates = process.platform === 'win32' ? WINDOWS_CANDIDATES : POSIX_CANDIDATES
  const found = await findOnPath(candidates)
  if (found === null) {
    throw new CodexCliError(
      '在 PATH 中找不到 codex 命令。请先安装 Codex 官方 CLI，并确认终端里能直接运行 codex --version。',
    )
  }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(found)) {
    const script = join(dirname(found), 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    if (!(await isFile(script))) {
      throw new CodexCliError(
        `找到 ${found}，但它是批处理包装脚本，无法安全地直接执行；同目录也没有 ${script}。\n` +
          '请改装 Codex 官方原生可执行文件，或把 codex.exe 放到 PATH 中。',
      )
    }
    const node = await resolveNodeForScript(options?.node)
    return {
      command: node,
      prefixArgs: [script],
      description: `${found}（用 Node 启动 ${script}）`,
    }
  }
  return { command: found, prefixArgs: [], description: found }
}

/** 批处理包装脚本必须借 Node 启动；拿不到可用 Node 就报错，不猜。 */
async function resolveNodeForScript(configured?: string | null): Promise<string> {
  const resolved = await resolveNodeRuntime(configured)
  if (!resolved.ok) throw new CodexCliError(resolved.message)
  return resolved.runtime.path
}

function exec(command: string, args: readonly string[]): Promise<CodexResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr })
          return
        }
        const raw = (error as { code?: unknown }).code
        if (typeof raw === 'number') {
          resolve({ code: raw, stdout, stderr })
          return
        }
        reject(new CodexCliError(`无法执行 ${command}：${error.message}`))
      },
    )
  })
}

export function runCodex(invocation: CodexInvocation, args: readonly string[]): Promise<CodexResult> {
  return exec(invocation.command, [...invocation.prefixArgs, ...args])
}

function parseServer(raw: unknown): McpServerInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (typeof record.name !== 'string') return null
  const transportRaw = record.transport
  const transport: Record<string, unknown> =
    typeof transportRaw === 'object' && transportRaw !== null ? (transportRaw as Record<string, unknown>) : {}
  return {
    name: record.name,
    enabled: record.enabled !== false,
    transport: {
      type: typeof transport.type === 'string' ? transport.type : 'unknown',
      command: typeof transport.command === 'string' ? transport.command : null,
      args: Array.isArray(transport.args)
        ? transport.args.filter((item): item is string => typeof item === 'string')
        : [],
      url: typeof transport.url === 'string' ? transport.url : null,
    },
  }
}

/**
 * 读取一条 MCP 服务器配置；不存在时返回 null。
 *
 * 「不存在」按退出码 + 官方提示文案判定（`No MCP server named '...' found.`），
 * 不猜其它失败原因——其它非零退出码一律当错误抛出，避免把 CLI 故障误判成未登记。
 */
export async function getMcpServer(invocation: CodexInvocation, name: string): Promise<McpServerInfo | null> {
  const result = await runCodex(invocation, ['mcp', 'get', name, '--json'])
  if (result.code === 0) {
    let parsed: unknown
    try {
      parsed = JSON.parse(result.stdout) as unknown
    } catch {
      // 不打印原始 stdout：里面的 env 可能带认证值，报错信息只说明解析失败。
      throw new CodexCliError(`codex mcp get ${name} 的输出无法解析（不是预期的 JSON）。`)
    }
    const server = parseServer(parsed)
    if (server === null) throw new CodexCliError(`codex mcp get ${name} 的输出里没有服务器信息`)
    return server
  }
  if (/No MCP server named/i.test(result.stderr)) return null
  throw new CodexCliError(`codex mcp get ${name} 失败（退出码 ${result.code}）：${result.stderr.trim()}`)
}

export async function addMcpServer(
  invocation: CodexInvocation,
  name: string,
  command: string,
  args: readonly string[],
): Promise<void> {
  const result = await runCodex(invocation, ['mcp', 'add', name, '--', command, ...args])
  if (result.code !== 0) {
    throw new CodexCliError(`codex mcp add 失败（退出码 ${result.code}）：${result.stderr.trim()}`)
  }
}

export async function removeMcpServer(invocation: CodexInvocation, name: string): Promise<void> {
  const result = await runCodex(invocation, ['mcp', 'remove', name])
  if (result.code !== 0) {
    throw new CodexCliError(`codex mcp remove 失败（退出码 ${result.code}）：${result.stderr.trim()}`)
  }
}

/** 把 URL 里的 userinfo、query、fragment 去掉，避免把令牌一起打印出来。 */
function redactUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return '（地址无法解析）'
  }
}

/**
 * 描述一条已登记的配置，用于「这是谁」的判断。
 *
 * 只给定位所需的信息：stdio 给命令和参数个数（不逐条打印参数，可能含令牌），
 * HTTP 给脱敏后的地址。同名配置可能属于别的项目，不能把它的内容整段倒出来。
 */
export function describeTransport(server: McpServerInfo): string {
  const transport = server.transport
  if (transport.command !== null) {
    const count = transport.args.length
    return count === 0 ? `stdio：${transport.command}` : `stdio：${transport.command}（${count} 个参数）`
  }
  if (transport.url !== null) return `${transport.type}：${redactUrl(transport.url)}`
  return `${transport.type}：（未记录命令或地址）`
}
