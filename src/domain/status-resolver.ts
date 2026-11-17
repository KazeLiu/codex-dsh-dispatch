/**
 * 六态解析：把「宿主观察到的事实」翻译成桥接对外的任务状态。
 *
 * 这一层是纯函数，不读时钟、不读文件、不依赖宿主类型，便于单独推演。
 * 翻译表见 docs/ARCHITECTURE.md 第 6.3 节。
 */

import { isTerminal, mergeStatus } from './status.js'
import { attributeTurn, isTurnMissing } from './turn-attribution.js'
import type { SessionSnapshot, TaskStatus, TurnEndInfo, TurnProgress } from './types.js'

/** 解析输入。 */
export interface ResolveInput {
  /** 上一次对外报出的状态；首次解析时为 `null`。 */
  readonly previous: TaskStatus | null
  /** 提交前读到的 `lastTurn`（T0）。 */
  readonly baselineTurn: number
  /**
   * 游标之后的回合进展。
   *
   * 不含 `baselineTurn`：它已由上面的字段给出，重复携带会出现两份事实源且
   * 可能不一致。解析时在本函数内合并成完整 `AttributionInput`。
   */
  readonly progress: TurnProgress
  /** 当前会话快照。 */
  readonly snapshot: SessionSnapshot
}

/** 解析结果。 */
export interface ResolveResult {
  readonly status: TaskStatus
  /** 归属回合号；尚未出现对应回合时为 `null`。 */
  readonly turn: number | null
  /** 对应回合的结束信息；未结束或未出现时为 `null`。 */
  readonly turnEnd: TurnEndInfo | null
}

/**
 * 把回合结束原因映射为任务状态。
 *
 * - `completed` → 完成
 * - `aborted` → 取消（这是唯一能产生 `cancelled` 的来源）
 * - `error` / `blocked` / `max-tokens` / `interrupted` → 失败
 *   （`blocked` 归失败而不是 `needs_input`：回合已经结束，不存在「等待输入」）
 * - `forked` → 不产生终态，调用方继续等待
 */
function statusOfTurnEnd(kind: TurnEndInfo['kind']): TaskStatus | null {
  switch (kind) {
    case 'completed':
      return 'completed'
    case 'aborted':
      return 'cancelled'
    case 'error':
    case 'blocked':
    case 'max-tokens':
    case 'interrupted':
      return 'failed'
    case 'forked':
      return null
  }
}

/**
 * 解析当前状态。
 *
 * 判定顺序刻意固定，因为多个条件可能同时成立，顺序决定结果：
 * 1. 上一状态已是终态 → 保持（避免「已取消」被后续观察改成「已完成」）。
 * 2. 有对应回合且已结束 → 按结束原因翻译。
 * 3. 有对应回合且未结束 → `running`。
 * 4. 无待处理输入、会话不执行、且从未出现对应回合 → `failed`（`turn-missing`）。
 * 5. 有待处理输入 → `needs_input`。
 * 6. 其余 → `accepted`（请求已受理，回合尚未开始）。
 */
export function resolveStatus(input: ResolveInput): ResolveResult {
  const { previous, baselineTurn, progress, snapshot } = input
  // 把 `baselineTurn` 与原生 `TurnProgress` 合成归属判定输入。
  // 单一事实源：调用方只传原生投影，T0 由 `baselineTurn` 字段唯一给出。
  const attributionInput = { ...progress, baselineTurn }
  const attribution = attributeTurn(attributionInput)

  if (previous !== null && isTerminal(previous)) {
    return { status: previous, turn: turnOf(attribution), turnEnd: endOf(attribution) }
  }

  if (attribution.kind === 'ended') {
    const translated = statusOfTurnEnd(attribution.endKind)
    const turnEnd: TurnEndInfo = { turn: attribution.turn, kind: attribution.endKind }
    if (translated !== null) {
      const status = previous === null ? translated : mergeStatus(previous, translated)
      return { status, turn: attribution.turn, turnEnd }
    }
    // `forked`：回合已结束但不产生终态，继续按「仍在执行」对待。
    return { status: nextNonTerminal(previous, 'running'), turn: attribution.turn, turnEnd }
  }

  if (attribution.kind === 'running') {
    return { status: nextNonTerminal(previous, 'running'), turn: attribution.turn, turnEnd: null }
  }

  const hasPendingInput = snapshot.pendingInput.length > 0
  if (isTurnMissing(attributionInput, snapshot.running, hasPendingInput)) {
    return { status: nextNonTerminal(previous, 'failed'), turn: null, turnEnd: null }
  }

  if (hasPendingInput) {
    return { status: nextNonTerminal(previous, 'needs_input'), turn: null, turnEnd: null }
  }

  return { status: nextNonTerminal(previous, 'accepted'), turn: null, turnEnd: null }
}

/** 非终态迁移：上一状态是终态时保持终态。 */
function nextNonTerminal(previous: TaskStatus | null, observed: TaskStatus): TaskStatus {
  if (previous === null) return observed
  return mergeStatus(previous, observed)
}

function turnOf(attribution: ReturnType<typeof attributeTurn>): number | null {
  return attribution.kind === 'pending' ? null : attribution.turn
}

function endOf(attribution: ReturnType<typeof attributeTurn>): TurnEndInfo | null {
  return attribution.kind === 'ended' ? { turn: attribution.turn, kind: attribution.endKind } : null
}
