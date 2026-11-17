/**
 * 用例层共享装配：端口集合、状态记忆、观测助手。
 *
 * 为什么单独一个文件而不是塞进四个用例：四个用例都要「读状态 + 读回合进展 +
 * 翻译六态」，重复三遍会把判定顺序散落成四份，任何一处漏改都会让不同工具
 * 对同一会话给出不同状态。
 */

import { bridgeError } from '../domain/errors.js'
import { resolveStatus, type ResolveResult } from '../domain/status-resolver.js'
import type { ModelView, PermissionView, SessionSnapshot, TaskStatus } from '../domain/types.js'
import type { Ports, SessionRecord } from '../ports/index.js'

/** `dsh_start` 成功时回给客户端的定位与配置信息（不含状态）。 */
export interface StartRecord {
  readonly workspaceId: string
  readonly sessionId: string
  readonly cwd: string
  readonly requestId: string
  readonly permission: PermissionView
  readonly model: ModelView
}

/** 用例层依赖。 */
export interface AppDeps {
  readonly ports: Ports
  /**
   * 同一请求的「上次观察状态」。
   *
   * 只用于 `dsh_wait` 的终态保持（ARCHITECTURE §6.5）：同一 `requestId` 重复
   * 等待时，`completed` 不能被后续观察改回 `running`。刻意只放内存——
   * 它是**观察缓存**不是事实源，插件重载后丢失只会让第一次 wait 重新观察，
   * 不会产生错误结论；落盘反而会引入「缓存与真实会话脱节」的新失败模式。
   */
  readonly observed: Map<string, TaskStatus>
  /**
   * `dsh_start` 的请求回执：`requestId` → 首次成功时的定位与配置。
   *
   * 用于「同一 `requestId` 重试不重复建会话」。宿主的 `prompt` 去重只在**同一
   * 会话内**按 `rpcId` 生效，而 `dsh_start` 每次都会新建会话，所以原生去重
   * 覆盖不到这一层——这里补的不是去重表，而是「已经建过哪个会话」的回执。
   * 只放内存：重载后回执丢失，退化为按登记表的 `lastRequestId` 找回会话
   * （见 `start-task.ts`），此时配置来源标 `unknown` 而不是猜。
   */
  readonly started: Map<string, StartRecord>
}

export function createAppDeps(ports: Ports): AppDeps {
  return { ports, observed: new Map<string, TaskStatus>(), started: new Map<string, StartRecord>() }
}

/** 观察缓存的键：会话 + 请求。 */
export function observedKey(sessionId: string, requestId: string): string {
  return `${sessionId}\u0000${requestId}`
}

/** 校验非空字符串。 */
export function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw bridgeError('invalid-argument', `${field} 必须是非空字符串`, { field })
  }
  return value
}

/**
 * 判断是否为绝对路径。
 *
 * 接受 POSIX 绝对路径、Windows 盘符路径与 UNC 路径。相对路径必须在用例层
 * 就报 `invalid-argument`（对应 JSON-RPC `-32602`），而不是让它走到工作区
 * 注册再被拒——两者对客户端的意义不同：前者是「请求写错了」，后者是
 * 「这个目录不可用」。
 */
export function isAbsolutePath(value: string): boolean {
  if (value.startsWith('/')) return true
  if (/^[A-Za-z]:[\\/]/.test(value)) return true
  if (value.startsWith('\\\\')) return true
  return false
}

/** 一次观测的完整结果。 */
export interface Observation {
  readonly snapshot: SessionSnapshot
  readonly resolved: ResolveResult
}

/**
 * 观测一次会话：读状态 + 读回合进展 + 翻译六态。
 *
 * `previous` 由调用方决定是否继承（ARCHITECTURE §6.5：`dsh_wait` 继承、
 * `dsh_send` 与 `dsh_cancel` 不继承）。
 */
export async function observeTask(
  deps: AppDeps,
  record: SessionRecord,
  previous: TaskStatus | null,
): Promise<Observation> {
  const snapshot = await deps.ports.session.readState({ sessionId: record.sessionId })
  const progress = await deps.ports.session.readProgress({
    sessionId: record.sessionId,
    afterSeq: record.baselineCursor,
    sinceTurn: record.baselineTurn,
  })
  const resolved = resolveStatus({
    previous,
    baselineTurn: record.baselineTurn,
    progress,
    snapshot,
  })
  return { snapshot, resolved }
}

/**
 * 串行占用检查。
 *
 * 判定完全由投影推导（ARCHITECTURE §7）：某目录被占用 ⟺ 该目录下存在本插件
 * 创建、且当前 `running === true` 的会话。`excludeSessionId` 用于 `dsh_send`
 * ——它要往自己那个会话里补话，不能被自己挡住。
 */
export async function assertNotBusy(
  deps: AppDeps,
  canonicalCwd: string,
  excludeSessionId: string | null,
): Promise<void> {
  const records = await deps.ports.registry.list()
  for (const record of records) {
    if (record.canonicalCwd !== canonicalCwd) continue
    if (excludeSessionId !== null && record.sessionId === excludeSessionId) continue
    const snapshot = await deps.ports.session.readState({ sessionId: record.sessionId })
    if (!snapshot.running) continue
    throw bridgeError(
      'workspace-busy',
      `工作目录已被本插件的另一个任务占用：${canonicalCwd}`,
      {
        busy: {
          sessionId: record.sessionId,
          requestId: record.lastRequestId,
          cwd: canonicalCwd,
        },
      },
    )
  }
}
