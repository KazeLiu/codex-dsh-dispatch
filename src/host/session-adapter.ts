/**
 * 会话适配器：`SessionPort` 的宿主实现。
 *
 * 三处刻意保持「薄」：
 * 1. `wait` 直接映射原生 `sessionController.wait`，不自建轮询——原生内部已处理
 *    `whenIdle()` 与状态变化的竞速，自建轮询会与之冲突。
 * 2. `prompt` 直接透传 `requestId`，不额外加前缀、不自建去重表——原生
 *    `hasPromptRequest` 已按 requestId 做幂等重放。
 * 3. `cancel` 的返回值只表示「请求已受理」，绝不在这里翻译成 `cancelled`。
 */

import { bridgeError } from '../domain/errors.js'
import { projectOutput } from '../domain/projection/output.js'
import type {
  OutputRecord,
  PendingInputKind,
  SessionSnapshot,
  TurnEndInfo,
  TurnEndKind,
  TurnProgress,
  WaitOutcome,
} from '../domain/types.js'
import type {
  CancelInput,
  CancelResult,
  CreateSessionInput,
  CreateSessionResult,
  PromptInput,
  PromptResult,
  ReadProgressInput,
  ReadStateInput,
  SessionPort,
  WaitInput,
} from '../ports/session-port.js'
import { requireService } from './context.js'
import type { HostContext, HostSessionEventEntry, HostSessionState } from './host-types.js'

/** 宿主 `SessionPendingInput` 到桥接语义的映射。 */
function toPendingInputKind(raw: string): PendingInputKind {
  if (raw === 'approval') return 'approval'
  if (raw === 'question') return 'question'
  return 'other'
}

export function createSessionAdapter(ctx: HostContext): SessionPort {
  return {
    async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
      const controller = requireService(ctx, 'sessionController')
      try {
        // 只传 workspaceId：宿主 create 内部会 get(workspaceId) 取 path 并
        // attachSession，调用方不需要也不应该再 attach（cwd 与 workspaceId 互斥）。
        const created = await controller.create({ workspaceId: input.workspaceId })
        return { sessionId: created.sessionId }
      } catch (cause) {
        throw bridgeError('internal', '创建会话失败', { workspaceId: input.workspaceId }, cause)
      }
    },

    async prompt(input: PromptInput): Promise<PromptResult> {
      const controller = requireService(ctx, 'sessionController')
      try {
        const result = await controller.prompt({
          requestId: input.requestId,
          sessionId: input.sessionId,
          mode: input.mode,
          content: [{ type: 'text', text: input.text }],
        }, new AbortController().signal)
        return { accepted: result.accepted }
      } catch (cause) {
        throw bridgeError(
          'internal',
          '提交任务失败',
          { sessionId: input.sessionId, requestId: input.requestId },
          cause,
        )
      }
    },

    async wait(input: WaitInput): Promise<WaitOutcome> {
      const controller = requireService(ctx, 'sessionController')
      let result
      try {
        result = await controller.wait(
          {
            sessionId: input.sessionId,
            afterSeq: input.afterSeq,
            timeoutMs: input.timeoutMs,
            maxMessages: input.maxMessages,
          },
          input.signal ?? new AbortController().signal,
        )
      } catch (cause) {
        // 等待被中断（客户端断开）不是失败：让上层按「超时」处理，
        // 保持上一状态返回，绝不把中断升级成取消会话。
        if (input.signal?.aborted === true) {
          throw bridgeError('wait-timeout', '等待被中断，会话仍在执行', {
            sessionId: input.sessionId,
          })
        }
        // 原生在「超时且从未拿到 state」时抛 session/wait-timeout；桥接把它
        // 转成固定错误码，客户端可据此继续 wait，而不是当成任务失败。
        if (isWaitTimeout(cause)) {
          throw bridgeError('wait-timeout', '等待超时，会话状态暂不可读', {
            sessionId: input.sessionId,
          })
        }
        throw bridgeError('internal', '等待会话失败', { sessionId: input.sessionId }, cause)
      }

      const snapshot = toSnapshot(result.state, await readTurnBoundary(ctx, input.sessionId))
      const records = toRecords(result.output.records, input.maxMessages)

      return {
        reason: result.reason,
        state: snapshot,
        records: records.records,
        // 原生截断 或 桥接投影截断，任一发生都要如实上报。
        truncated: result.output.truncated || records.truncated,
      }
    },

    async cancel(input: CancelInput): Promise<CancelResult> {
      const controller = requireService(ctx, 'sessionController')
      try {
        const result = controller.cancel({ sessionId: input.sessionId })
        return { accepted: result.accepted }
      } catch (cause) {
        if (isSessionNotFound(cause)) {
          throw bridgeError('session-not-found', `会话不存在或未挂载：${input.sessionId}`, {
            sessionId: input.sessionId,
          })
        }
        throw bridgeError('internal', '取消请求失败', { sessionId: input.sessionId }, cause)
      }
    },

    async readState(input: ReadStateInput): Promise<SessionSnapshot> {
      const controller = requireService(ctx, 'sessionController')
      let state: HostSessionState
      try {
        state = await controller.state({ sessionId: input.sessionId }, new AbortController().signal)
      } catch (cause) {
        if (isSessionNotFound(cause)) {
          throw bridgeError('session-not-found', `会话不存在：${input.sessionId}`, {
            sessionId: input.sessionId,
          })
        }
        throw bridgeError('internal', '读取会话状态失败', { sessionId: input.sessionId }, cause)
      }
      return toSnapshot(state, await readTurnBoundary(ctx, input.sessionId))
    },

    async readProgress(input: ReadProgressInput): Promise<TurnProgress> {
      const controller = requireService(ctx, 'sessionController')
      let state: HostSessionState
      try {
        state = await controller.state({ sessionId: input.sessionId }, new AbortController().signal)
      } catch (cause) {
        if (isSessionNotFound(cause)) {
          throw bridgeError('session-not-found', `会话不存在：${input.sessionId}`, {
            sessionId: input.sessionId,
          })
        }
        throw bridgeError('internal', '读取会话状态失败', { sessionId: input.sessionId }, cause)
      }

      const window = await readEventsSince(ctx, input.sessionId, state.cursor, input.afterSeq)
      return toProgress(window.events, input.sinceTurn, window.truncated, input.requestId, input.callId)
    },
  }
}

/** 历史分页单页条数：只数消息，但返回切片里的全部事件。 */
const PROGRESS_PAGE_SIZE = 200

/**
 * 读 `afterSeq` 之后的事件。
 *
 * 宿主 `events()` 只能从尾部往前翻（`paginate` 从 `end-1` 倒序扫），因此这里
 * 循环翻页直到覆盖到 `afterSeq` 或触到页数上限。页数上限是**有意的保守**：
 * 回合归属只关心最近几个回合，翻到 1000 条消息还没覆盖到提交点，说明会话
 * 已经跑得远超本请求，此时按「只看到尾部」处理即可（尾部必然包含本请求
 * 之后的事件）。
 *
 * 但「没翻到」与「不存在」必须区分：页数耗尽仍未覆盖到 `afterSeq` 时返回
 * `truncated: true`，上层据此**不判** `turn-missing`，避免把还在跑的任务
 * 误报成失败。
 */
async function readEventsSince(
  ctx: HostContext,
  sessionId: string,
  cursor: number,
  afterSeq: number,
): Promise<{ events: readonly HostSessionEventEntry[]; truncated: boolean }> {
  const controller = requireService(ctx, 'sessionController')
  const collected: HostSessionEventEntry[] = []
  let beforeSeq: number | undefined
  const truncated = false

  for (;;) {
    let result
    try {
      result = await controller.events({
        address: { kind: 'session', sessionId },
        throughSeq: cursor,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        maxMessages: PROGRESS_PAGE_SIZE,
      }, new AbortController().signal)
    } catch (cause) {
      if (isSessionNotFound(cause)) {
        throw bridgeError('session-not-found', `会话不存在：${sessionId}`, { sessionId })
      }
      throw bridgeError('internal', '读取会话历史失败', { sessionId }, cause)
    }

    collected.unshift(...result.records.filter(entry => ['turn/start', 'turn/end', 'user/message', 'agent/inbox/spliced'].includes(entry.event.type)))
    const first = result.records[0]
    if (!result.hasMore || first === undefined) break
    // 已经覆盖到提交点，再往前翻与本请求无关。
    if (first.event.seq <= afterSeq) break
    beforeSeq = first.event.seq
  }

  return { events: collected.filter((entry) => entry.event.seq > afterSeq), truncated }
}

/** 从事件里提取回合进展。 */
function toProgress(
  events: readonly HostSessionEventEntry[],
  sinceTurn: number,
  truncated: boolean,
  requestId?: string,
  callId?: string,
): TurnProgress {
  let startedTurn: number | null = null
  const ends: TurnEndInfo[] = []
  let currentTurn = sinceTurn
  let targetTurn: number | null = null
  let admitted = false

  const matches = (data: unknown): boolean => {
    if (data === null || typeof data !== 'object') return false
    const source = (data as { source?: { rpcId?: string; callId?: string } }).source
    return callId === undefined ? source?.rpcId === requestId : source?.callId === callId
  }

  for (const entry of events) {
    if (entry.event.type === 'user/message' && matches(entry.event.data)) {
      targetTurn = currentTurn
      admitted = true
    }
    if (entry.event.type === 'agent/inbox/spliced') {
      const inserted = (entry.event.data as { inserted?: unknown[] }).inserted
      if (inserted?.some(matches)) admitted = true
    }
    const turn = readTurnNumber(entry.event.data)
    if (turn === null) continue

    if (entry.event.type === 'turn/start') {
      currentTurn = turn
      if (startedTurn === null || turn > startedTurn) startedTurn = turn
      continue
    }

    if (entry.event.type === 'turn/end' && turn > sinceTurn) {
      const kind = readTurnEndKind(entry.event.data)
      if (kind !== null) ends.push({ turn, kind })
    }
  }

  return { startedTurn, ends, truncated, ...(requestId === undefined ? {} : { targetTurn, admitted }) }
}

/** 读事件 data 里的 `turn` 字段。 */
function readTurnNumber(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null
  const turn = (data as { turn?: unknown }).turn
  return typeof turn === 'number' && Number.isSafeInteger(turn) ? turn : null
}

/** 读 `turn/end` 的 `reason.kind`，只接受已知取值。 */
function readTurnEndKind(data: unknown): TurnEndKind | null {
  if (typeof data !== 'object' || data === null) return null
  const reason = (data as { reason?: unknown }).reason
  if (typeof reason !== 'object' || reason === null) return null
  const kind = (reason as { kind?: unknown }).kind
  switch (kind) {
    case 'completed':
    case 'aborted':
    case 'blocked':
    case 'error':
    case 'max-tokens':
    case 'interrupted':
    case 'forked':
      return kind
    default:
      // 宿主新增了未知结束原因：不猜成 completed，交给上层按「未结束」继续等。
      return null
  }
}

/** 把宿主状态转成桥接快照。 */
function toSnapshot(
  state: HostSessionState,
  boundary: { openTurnStartSeq: number | null; lastTurn: number },
): SessionSnapshot {
  return {
    cursor: state.cursor,
    active: state.active,
    running: state.running,
    queued: (state.queue?.length ?? 0) > 0,
    pendingInput: state.pendingInput.map(toPendingInputKind),
    openTurnStartSeq: boundary.openTurnStartSeq,
    lastTurn: boundary.lastTurn,
  }
}

/**
 * 读回合边界投影。
 *
 * `agents` 或会话实体缺失时返回「无回合」的保守值：宁可让上层走 `turn-missing`
 * 的失败路径，也不要编造一个回合号把任务误判成完成。
 */
async function readTurnBoundary(
  ctx: HostContext,
  sessionId: string,
): Promise<{ openTurnStartSeq: number | null; lastTurn: number }> {
  const agents = ctx.get('agents')
  const sessions = ctx.get('sessions')
  if (agents === null || typeof agents !== 'object') return { openTurnStartSeq: null, lastTurn: 0 }
  if (sessions === null || typeof sessions !== 'object') return { openTurnStartSeq: null, lastTurn: 0 }

  const store = sessions as { get(id: string): { id: string; seq: number } | undefined }
  const session = store.get(sessionId)
  if (session === undefined) return { openTurnStartSeq: null, lastTurn: 0 }

  const boundaryOf = agents as {
    turnBoundaryOf(session: { id: string; seq: number }): {
      openTurnStartSeq: number | null
      lastTurn: number
    }
  }
  try {
    const boundary = boundaryOf.turnBoundaryOf(session)
    return { openTurnStartSeq: boundary.openTurnStartSeq, lastTurn: boundary.lastTurn }
  } catch {
    return { openTurnStartSeq: null, lastTurn: 0 }
  }
}

/**
 * 把宿主记录转成投影输入并裁剪。
 *
 * 宿主返回的 `records` 是**新→旧**；投影层要求时间正序，所以先翻转。
 * 翻转后再交给 `projectOutput` 做「从最新往回累加」的裁剪。
 */
function toRecords(
  records: readonly HostSessionEventEntry[],
  maxMessages: number,
): { records: readonly OutputRecord[]; truncated: boolean } {
  const chronological = [...records].reverse().map((entry) => ({
    type: entry.event.type,
    seq: entry.event.seq,
    data: entry.event.data,
  }))
  return projectOutput(chronological, { maxRecords: maxMessages })
}

/** 识别宿主的等待超时错误。 */
function isWaitTimeout(cause: unknown): boolean {
  return errorCodeOf(cause) === 'session/wait-timeout'
}

/** 识别宿主的会话不存在错误。 */
function isSessionNotFound(cause: unknown): boolean {
  return errorCodeOf(cause) === 'session/not-found'
}

/** 从宿主错误里取 `code` 字段（`RemoteError` 用 `code` 属性）。 */
function errorCodeOf(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null) return null
  const code = (cause as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}
