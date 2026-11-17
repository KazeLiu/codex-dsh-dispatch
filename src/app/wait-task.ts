/**
 * `dsh_wait` 用例：按游标返回增量输出与当前状态。
 *
 * 关键约束（docs/ARCHITECTURE.md 第 5.2 / 6.3 / 8 节）：
 * - 等待超时**不是**失败，也不是重派或取消：保持上一状态返回，客户端可继续 wait。
 * - 本次等待被中断（客户端断开）只结束这一次等待，绝不取消会话执行。
 * - 输出必须按条数与字节双裁剪，并如实置 `truncated`。
 */

import { BridgeError, bridgeError } from '../domain/errors.js'
import { resolveStatus } from '../domain/status-resolver.js'
import type { OutputRecord, PendingInputKind, TaskStatus, TurnEndInfo } from '../domain/types.js'
import type { PendingQuestion } from '../ports/index.js'
import { observedKey, requireNonEmpty, type AppDeps } from './deps.js'

/** 默认等待时长：与宿主原生缺省一致（30 秒）。 */
const DEFAULT_TIMEOUT_MS = 30_000

/** 单次返回的输出条数上限。 */
const MAX_OUTPUT_RECORDS = 50

/** `dsh_wait` 入参。 */
export interface WaitTaskInput {
  readonly sessionId: unknown
  readonly requestId: unknown
  readonly cursor: unknown
  readonly timeoutMs: unknown
  /**
   * 中断本次等待（客户端断开时触发）。
   *
   * **只结束这一次等待，不取消会话执行**：中断后按「超时」语义返回当前状态，
   * 客户端若还想要结果可以带同一 cursor 重新 wait（第 8 节硬要求）。
   */
  readonly signal?: AbortSignal
}

/** `needs_input` 的对外载荷。 */
export interface NeedsInputView {
  readonly kind: PendingInputKind
  readonly callId: string | null
  readonly questions: readonly PendingQuestion[]
}

/** `dsh_wait` 出参。 */
export interface WaitTaskOutput {
  readonly status: TaskStatus
  readonly cursor: number
  readonly output: readonly OutputRecord[]
  readonly truncated: boolean
  readonly needsInput?: NeedsInputView
  readonly turn?: TurnEndInfo
}

/**
 * 执行 `dsh_wait`。
 *
 * `cursor` 的语义是「上一次返回的 `cursor`」，直接作为宿主的 `afterSeq`：
 * 它是会话游标（`SessionState.cursor`），不是最后一条输出的 seq——只有工具
 * 调用、没有文本的回合里游标照样前进，用后者会让客户端反复拉取已裁剪的记录。
 */
export async function waitTask(deps: AppDeps, input: WaitTaskInput): Promise<WaitTaskOutput> {
  const sessionId = requireNonEmpty(input.sessionId, 'sessionId')
  const requestId = requireNonEmpty(input.requestId, 'requestId')
  const cursor = readCursor(input.cursor)
  const timeoutMs = readTimeout(input.timeoutMs)

  const record = await deps.ports.registry.get(sessionId)
  if (record === null) {
    throw bridgeError('session-not-found', `会话不存在或不属于本插件：${sessionId}`, { sessionId })
  }

  const key = observedKey(sessionId, requestId)
  const previous = deps.observed.get(key) ?? null

  let outcome
  try {
    outcome = await deps.ports.session.wait({
      sessionId,
      afterSeq: cursor,
      timeoutMs,
      maxMessages: MAX_OUTPUT_RECORDS,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  } catch (cause) {
    // 宿主在「等待期内一次状态都没拿到」时抛超时。这不是失败：
    // 退回一次普通观测，把当前状态如实报出去，客户端可继续 wait。
    if (cause instanceof BridgeError && cause.code === 'wait-timeout') {
      const snapshot = await deps.ports.session.readState({ sessionId })
      const progress = await deps.ports.session.readProgress({
        sessionId,
        afterSeq: record.baselineCursor,
        sinceTurn: record.baselineTurn,
      })
      const resolved = resolveStatus({
        previous,
        baselineTurn: record.baselineTurn,
        progress,
        snapshot,
      })
      deps.observed.set(key, resolved.status)
      return buildOutput(deps, sessionId, snapshot.cursor, [], false, resolved.status, resolved.turnEnd)
    }
    throw cause
  }

  const progress = await deps.ports.session.readProgress({
    sessionId,
    afterSeq: record.baselineCursor,
    sinceTurn: record.baselineTurn,
  })
  const resolved = resolveStatus({
    previous,
    baselineTurn: record.baselineTurn,
    progress,
    snapshot: outcome.state,
  })
  deps.observed.set(key, resolved.status)

  return buildOutput(
    deps,
    sessionId,
    outcome.state.cursor,
    outcome.records,
    outcome.truncated,
    resolved.status,
    resolved.turnEnd,
  )
}

/** 组装返回体；`needs_input` 时补上「卡在等什么」。 */
async function buildOutput(
  deps: AppDeps,
  sessionId: string,
  cursor: number,
  output: readonly OutputRecord[],
  truncated: boolean,
  status: TaskStatus,
  turnEnd: TurnEndInfo | null,
): Promise<WaitTaskOutput> {
  const base = {
    status,
    cursor,
    output,
    truncated,
    ...(turnEnd === null ? {} : { turn: turnEnd }),
  }

  if (status !== 'needs_input') return base

  // 详细载荷读不到时仍报 needs_input，只降级载荷，不退回 running
  // （docs/ARCHITECTURE.md 第 5.5 节）。
  const pending = await deps.ports.interaction.pendingInput({ sessionId })
  return {
    ...base,
    needsInput: {
      kind: pendingKind(pending.hasApproval, pending.questions.length > 0),
      callId: pending.callId,
      questions: pending.questions,
    },
  }
}

/**
 * 判定待处理输入的种类。
 *
 * 不取宿主 `pendingInput` 数组的第一项：它是 `Set` 去重后的种类集合，
 * 顺序不保证。按固定优先级 `approval > question > other` 判定，客户端才能
 * 依赖这个字段做分支。
 */
function pendingKind(hasApproval: boolean, hasQuestions: boolean): PendingInputKind {
  if (hasApproval) return 'approval'
  if (hasQuestions) return 'question'
  return 'other'
}

/** 读游标：缺省 `-1`（从头开始），必须是 ≥ -1 的安全整数。 */
function readCursor(value: unknown): number {
  if (value === undefined || value === null) return -1
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < -1) {
    throw bridgeError('invalid-argument', 'cursor 必须是大于等于 -1 的整数', { field: 'cursor' })
  }
  return value
}

/** 读等待时长：缺省 30 秒，必须为正安全整数。 */
function readTimeout(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_TIMEOUT_MS
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw bridgeError('invalid-argument', 'timeoutMs 必须是正整数', { field: 'timeoutMs' })
  }
  return value
}
