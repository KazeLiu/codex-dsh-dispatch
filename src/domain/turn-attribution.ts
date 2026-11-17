/**
 * 请求 ↔ 回合归属判定。
 *
 * 为什么需要这一层：`prompt()` 返回的 `{ accepted: true }` 只是「请求被接收」，
 * 不代表任何回合已经开始；而 `SessionState.running === false` 也不代表本请求
 * 对应的回合已经结束——它可能还没开始，或者会话里跑的是别的回合。
 *
 * 判定方式分两级，**原生事件优先**：
 * 1. 适配器从实际消费输入的 `user/message` 按 `rpcId` / `callId` 认出回合，
 *    通过 `targetTurn` 传进来。收件箱插入事件只证明接收，不作为回合归属。
 *    `steer` 与 `reply` 可能落入提交时已打开的回合，回合号可以等于 T0。
 * 2. `targetTurn` 缺省时保留旧调用方的 T0 + 1 语义；当前原生适配器总会
 *    显式返回回合号或 null，不会对尚未消费的排队消息使用这个推算。
 *
 * `targetTurn === null` 表示「事件里明确看到本请求还没进入任何回合」，
 * 与「缺省、不知道」不同，前者直接判 `pending`。
 *
 * 结束事件的匹配也不能用「最新一条 turn/end」：连跑两回合时最新那条属于
 * 下一回合。所以输入收的是**游标后全部** `turn/end`（含回合号等于 T0 的那条，
 * 因为 `steer` / `reply` 的落点就是它），按回合号精确匹配。
 */

import type { TurnEndInfo, TurnEndKind } from './types.js'

/** 归属判定的输入：全部是原生事实，不含桥接状态。 */
export interface AttributionInput {
  readonly targetTurn?: number | null
  /** 提交前读到的 `lastTurn`；对应回合号为 `baselineTurn + 1`。 */
  readonly baselineTurn: number
  /** 游标之后观察到的最大已开始回合号；未观察到任何回合时为 `null`。 */
  readonly startedTurn: number | null
  /** 游标之后观察到的全部回合结束信息（顺序不限）。 */
  readonly ends: readonly TurnEndInfo[]
  /**
   * 观察窗口是否被截断（历史分页翻到页数上限仍未覆盖到提交点）。
   *
   * 为 `true` 时「没看到对应回合」不等于「对应回合不存在」，因此不能据此
   * 判 `turn-missing`。缺省 `false`（调用方不传即按完整观察处理）。
   */
  readonly truncated?: boolean
}

/** 归属判定结果。 */
export type Attribution =
  /** 尚未观察到对应回合开始。 */
  | { readonly kind: 'pending' }
  /** 对应回合已开始且未结束。 */
  | { readonly kind: 'running'; readonly turn: number }
  /** 对应回合已结束。 */
  | { readonly kind: 'ended'; readonly turn: number; readonly endKind: TurnEndKind }

/** 本请求对应的回合号。 */
export function expectedTurn(baselineTurn: number): number {
  return baselineTurn + 1
}

/** 在结束事件里找指定回合的那条。 */
function findEnd(ends: readonly TurnEndInfo[], turn: number): TurnEndInfo | null {
  for (const end of ends) {
    if (end.turn === turn) return end
  }
  return null
}

/**
 * 判定请求对应的回合进展。
 *
 * 有 `targetTurn` 时以它为准（原生事件认出的落点）；否则按 T0 + 1 推算，
 * 此时「已开始」的判据是 `startedTurn >= 对应回合号`：既然 T0+2 都已经开始，
 * T0+1 必然已经开始过（回合号单调递增）。这样即使投影侧只保留最大值也够用。
 */
export function attributeTurn(input: AttributionInput): Attribution {
  const { baselineTurn, startedTurn, ends } = input
  if (input.targetTurn === null) return { kind: 'pending' }
  const turn = input.targetTurn ?? expectedTurn(baselineTurn)

  const end = findEnd(ends, turn)
  if (end !== null) return { kind: 'ended', turn, endKind: end.kind }
  if (input.targetTurn === undefined && (startedTurn === null || startedTurn < turn)) return { kind: 'pending' }
  return { kind: 'running', turn }
}

/**
 * 判断是否落入「回合缺失」异常路径。
 *
 * 条件：会话已不再执行、也没有待处理输入，但仍未观察到对应回合开始。
 * 此时**必须报 failed（`turn-missing`），不得报 completed**——否则客户端会把
 * 一次根本没跑起来的任务当成成功。
 *
 * `truncated === true` 时一律返回 `false`：观察窗口被截断意味着「我们没看到」
 * 而不是「不存在」。宁可继续报 `accepted` / `running` 让客户端多等一轮，也
 * 不能把还在跑的任务误报成失败（REVIEW.md R9）。
 */
export function isTurnMissing(
  input: AttributionInput,
  running: boolean,
  hasPendingInput: boolean,
): boolean {
  if (running || hasPendingInput) return false
  if (input.truncated === true) return false
  return attributeTurn(input).kind === 'pending'
}
