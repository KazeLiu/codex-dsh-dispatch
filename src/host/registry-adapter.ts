/**
 * 会话归属登记表的宿主实现：读写 `$DSH_HOME/codex-dsh-dispatch/state.json`。
 *
 * 为什么直接用 `node:fs` 而不是宿主的 `storageDomain`：`storageDomain` 需要
 * 额外配置 backend 与域声明（`defineDomain` + zod schema + version），而本插件
 * 只存一份几十行的扁平 JSON；引入域声明会让第 1 阶段的装配成本翻倍，收益只有
 * 「格式校验」。文件损坏时按「空表」处理并告警，不阻断插件加载。
 *
 * 为什么放在 `host/`：依赖规则 D2 禁止 `domain/` 与 `ports/` 触碰 `node:fs`。
 *
 * 路径解析等价于宿主 `dsh-home-paths` 的优先级（显式配置 > `$DSH_HOME` >
 * `~/.dsh`），但**不 import 该包**（依赖规则 D1 要求全仓 0 处宿主 import）。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { bridgeError } from '../domain/errors.js'
import type { PermissionLevel } from '../domain/types.js'
import type { RequestRecord, SessionRecord, SessionRegistryPort } from '../ports/registry-port.js'
import type { HostContext } from './host-types.js'

/** 登记表文件格式版本；结构变化时递增，读取时按版本迁移。 */
const STATE_VERSION = 1

/** 本插件在 DSH 主目录下的数据子目录名。 */
const DATA_DIR_NAME = 'codex-dsh-dispatch'

/** 登记表文件名。 */
const STATE_FILE_NAME = 'state.json'

/** 磁盘上的形态。 */
interface PersistedState {
  readonly version: number
  readonly sessions: Readonly<Record<string, PersistedSession>>
}

interface PersistedSession {
  readonly requests?: Readonly<Record<string, RequestRecord>>
  readonly workspaceId: string
  readonly canonicalCwd: string
  readonly lastRequestId: string
  readonly lastSourcePermission: PermissionLevel | null
  readonly baselineTurn: number
  readonly baselineCursor: number
}

/**
 * 解析 DSH 主目录。
 *
 * 优先级照抄宿主：显式传入 > `$DSH_HOME`（空白视为未设）> `~/.dsh`。
 */
function resolveDshHome(configured?: string): string {
  if (configured !== undefined && configured.trim() !== '') return configured
  const fromEnv = process.env['DSH_HOME']
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv
  return join(homedir(), '.dsh')
}

/** 读一个非负安全整数，非法时回退。 */
function readCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

/** 读权限值，非法时回退 `null`。 */
function readPermissionLevel(value: unknown): PermissionLevel | null {
  return value === 'ask' || value === 'auto' || value === 'full' ? value : null
}

/** 读字符串，非法时回退空串（空串记录会被后续校验挡掉）。 */
function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 创建登记表。
 *
 * 全部读写都串行化在一个 Promise 链上：`dsh_start` 与 `dsh_send` 可能并发，
 * 而「读-改-写」整文件不是原子的，串行化比加文件锁简单且够用（单进程内）。
 */
export function createSessionRegistry(ctx: HostContext, configuredHome?: string): SessionRegistryPort {
  const filePath = join(resolveDshHome(configuredHome), DATA_DIR_NAME, STATE_FILE_NAME)
  let cache: PersistedState | null = null
  let queue: Promise<unknown> = Promise.resolve()

  /** 串行执行，保证「读-改-写」不交错。 */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task)
    // 吞掉拒绝，避免一次失败让后续任务全部短路（调用方各自拿到自己的错误）。
    queue = next.catch(() => undefined)
    return next
  }

  async function load(): Promise<PersistedState> {
    if (cache !== null) return cache
    let raw: string
    try {
      raw = await readFile(filePath, 'utf8')
    } catch (cause) {
      if (isNotFound(cause)) {
        cache = { version: STATE_VERSION, sessions: {} }
        return cache
      }
      // 读不动（权限、磁盘错误）：按空表继续，但要留下可排查的痕迹。
      ctx.logger.warn(`读取会话登记表失败，按空表继续：${filePath}`)
      cache = { version: STATE_VERSION, sessions: {} }
      return cache
    }

    try {
      cache = parseState(JSON.parse(raw) as unknown)
    } catch {
      // 内容损坏：不覆盖原文件（保留现场），本次按空表工作。
      ctx.logger.warn(`会话登记表内容损坏，本次按空表继续：${filePath}`)
      cache = { version: STATE_VERSION, sessions: {} }
    }
    return cache
  }

  async function persist(state: PersistedState): Promise<void> {
    const directory = dirname(filePath)
    await mkdir(directory, { recursive: true })
    // 先写临时文件再 rename：进程在写一半时被杀不会留下半截 JSON。
    const temporary = `${filePath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temporary, filePath)
  }

  return {
    list(): Promise<readonly SessionRecord[]> {
      return serial(async () => {
        const state = await load()
        return Object.entries(state.sessions).map(([sessionId, session]) =>
          toRecord(sessionId, session),
        )
      })
    },

    get(sessionId: string): Promise<SessionRecord | null> {
      return serial(async () => {
        const state = await load()
        const session = state.sessions[sessionId]
        return session === undefined ? null : toRecord(sessionId, session)
      })
    },

    upsert(record: SessionRecord): Promise<void> {
      return serial(async () => {
        const state = await load()
        const next: PersistedState = {
          version: STATE_VERSION,
          sessions: { ...state.sessions, [record.sessionId]: toPersisted(record) },
        }
        try {
          await persist(next)
        } catch (cause) {
          throw bridgeError(
            'internal',
            `写入会话登记表失败：${filePath}`,
            { sessionId: record.sessionId },
            cause,
          )
        }
        cache = next
      })
    },
  }
}

function toRecord(sessionId: string, session: PersistedSession): SessionRecord {
  return {
    sessionId,
    workspaceId: session.workspaceId,
    canonicalCwd: session.canonicalCwd,
    lastRequestId: session.lastRequestId,
    lastSourcePermission: session.lastSourcePermission,
    baselineTurn: session.baselineTurn,
    baselineCursor: session.baselineCursor,
    ...(session.requests === undefined ? {} : { requests: session.requests }),
  }
}

function toPersisted(record: SessionRecord): PersistedSession {
  return {
    workspaceId: record.workspaceId,
    canonicalCwd: record.canonicalCwd,
    lastRequestId: record.lastRequestId,
    lastSourcePermission: record.lastSourcePermission,
    baselineTurn: record.baselineTurn,
    baselineCursor: record.baselineCursor,
    ...(record.requests === undefined ? {} : { requests: record.requests }),
  }
}

/**
 * 解析磁盘内容。
 *
 * 逐字段校验而不是整体信任：手工编辑过的文件、或旧版本写入的缺字段记录，
 * 都应降级成「可用记录」而不是让整个插件起不来。缺 `sessionId` 之外的
 * 关键定位字段（`workspaceId` / `canonicalCwd`）的记录直接丢弃——它们无法
 * 参与占用判定，留着只会制造假冲突。
 */
function parseState(value: unknown): PersistedState {
  if (typeof value !== 'object' || value === null) return { version: STATE_VERSION, sessions: {} }
  const sessions = (value as { sessions?: unknown }).sessions
  if (typeof sessions !== 'object' || sessions === null) {
    return { version: STATE_VERSION, sessions: {} }
  }

  const parsed: Record<string, PersistedSession> = {}
  for (const [sessionId, raw] of Object.entries(sessions as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>
    const workspaceId = readString(entry['workspaceId'])
    const canonicalCwd = readString(entry['canonicalCwd'])
    if (workspaceId === '' || canonicalCwd === '') continue
    parsed[sessionId] = {
      workspaceId,
      canonicalCwd,
      lastRequestId: readString(entry['lastRequestId']),
      lastSourcePermission: readPermissionLevel(entry['lastSourcePermission']),
      baselineTurn: readCount(entry['baselineTurn'], 0),
      baselineCursor: typeof entry['baselineCursor'] === 'number' && entry['baselineCursor'] === -1 ? -1 : readCount(entry['baselineCursor'], 0),
      requests: parseRequests(entry['requests']),
    }
  }
  return { version: STATE_VERSION, sessions: parsed }
}

function parseRequests(value: unknown): Record<string, RequestRecord> {
  if (value === null || typeof value !== 'object') return {}
  const result: Record<string, RequestRecord> = {}
  for (const [id, item] of Object.entries(value)) {
    if (item === null || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    if (raw.kind !== 'start' && raw.kind !== 'text' && raw.kind !== 'reply') continue
    if (raw.phase !== 'prepared' && raw.phase !== 'accepted') continue
    if (typeof raw.fingerprint !== 'string') continue
    result[id] = {
      kind: raw.kind, phase: raw.phase, fingerprint: raw.fingerprint,
      baselineTurn: readCount(raw.baselineTurn, 0),
      baselineCursor: typeof raw.baselineCursor === 'number' && Number.isSafeInteger(raw.baselineCursor) && raw.baselineCursor >= -1 ? raw.baselineCursor : -1,
      // 早期记录没有 `mode`（当时固定 queue），缺省按 `queue` 兜底而不是丢弃整条。
      ...(raw.kind === 'text' ? { mode: raw.mode === 'steer' ? 'steer' as const : 'queue' as const } : {}),
      ...(typeof raw.callId === 'string' ? { callId: raw.callId } : {}),
    }
  }
  return result
}

function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: unknown }).code === 'ENOENT'
  )
}
