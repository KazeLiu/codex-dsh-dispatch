/**
 * 会话端口：桥接对 DSH 会话能力的唯一依赖面。
 *
 * 设计原则：**只暴露原生已有的语义，不叠加桥接自己的状态机**。
 * 特别是 `wait` 直接映射宿主 `sessionController.wait`，桥接层不再自己轮询——
 * 自建轮询会与原生 `whenIdle` 竞速逻辑冲突，并且在会话重载后丢失观察。
 *
 * 注意：本层只允许类型声明（依赖规则 D3）。
 */

import type { SessionSnapshot, TurnProgress, WaitOutcome } from '../domain/types.js'

/** 创建会话。 */
export interface CreateSessionInput {
  /** 已注册的工作区标识；与 `cwd` 互斥，桥接只用这个。 */
  readonly workspaceId: string
}

export interface CreateSessionResult {
  readonly sessionId: string
}

/** 提交一条任务或补充文字。 */
export interface PromptInput {
  readonly sessionId: string
  /** 稳定请求 ID，直接透传给宿主做幂等去重。 */
  readonly requestId: string
  readonly text: string
  /** `queue` 排队（默认）；`steer` 插入当前回合。 */
  readonly mode: 'queue' | 'steer'
}

export interface PromptResult {
  /**
   * 字面量 `true`：宿主 `SessionPromptValue` 只有这一种取值，拒绝只通过抛错表达。
   * 写成 `boolean` 会让调用方误以为存在 `accepted: false` 分支。
   */
  readonly accepted: true
}

/** 等待会话进展。 */
export interface WaitInput {
  readonly sessionId: string
  /** 只要 `seq > afterSeq` 的输出；首次传 `-1`。 */
  readonly afterSeq: number
  readonly timeoutMs: number
  readonly maxMessages: number
  /**
   * 中断本次等待（客户端断开时触发）。
   *
   * 语义边界：**只结束这一次等待，不取消会话执行**。取消只能由 `dsh_cancel`
   * 显式发起（docs/ARCHITECTURE.md 第 8 节）。
   */
  readonly signal?: AbortSignal
}

/** 请求取消。返回值只表示「取消请求已受理」，不代表已取消。 */
export interface CancelInput {
  readonly sessionId: string
}

export interface CancelResult {
  /** 字面量 `true`：只表示「取消请求已受理」，不代表已取消。 */
  readonly accepted: true
}

/** 读当前状态。 */
export interface ReadStateInput {
  readonly sessionId: string
}

/**
 * 读回合进展。
 *
 * `afterSeq` 取「提交前观察到的游标」：只关心这次提交之后出现的
 * `turn/start` 与 `turn/end`，更早的回合与本请求无关。
 *
 * 落点回合不由本接口推算：适配器从原生事件里认出本请求落在哪个回合
 * （`user/message` 的 `source.rpcId`、`agent/inbox/spliced` 的 `inserted`），
 * 通过 `TurnProgress.targetTurn` 回传。`steer` 与 `reply` 会被宿主插进
 * **提交时已经打开的那个回合**，落点回合号可能正好等于 `sinceTurn`。
 */
export interface ReadProgressInput {
  readonly sessionId: string
  readonly requestId?: string
  readonly callId?: string
  /** 只读 `seq > afterSeq` 的事件；首次传 `-1`。 */
  readonly afterSeq: number
  /**
   * 回合号下界（调用方传提交前的 `lastTurn`，即 T0）。
   *
   * 适配器收集**回合号大于等于它**的 `turn/end`：下界取 `>=` 而不是 `>`，
   * 因为 `steer` / `reply` 落在提交时那个开放回合上，它的结束事件回合号
   * 就等于 T0；用严格大于会永远看不到这条结束事件。
   *
   * 传进来而不是让适配器自己判断：T0 属于领域语义（回合归属），
   * 适配器只负责「按回合号下界取原生事实」。
   */
  readonly sinceTurn: number
}

export interface SessionPort {
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>
  prompt(input: PromptInput): Promise<PromptResult>
  wait(input: WaitInput): Promise<WaitOutcome>
  cancel(input: CancelInput): Promise<CancelResult>
  readState(input: ReadStateInput): Promise<SessionSnapshot>
  /**
   * 读游标之后的回合进展。
   *
   * 为什么单独一个方法而不是塞进 `readState`：`readState` 只读投影（O(1)），
   * 而回合结束事件必须走历史分页（会读会话日志）。两者代价差一个量级，
   * 混在一起会让「只是想知道在不在跑」也付出读日志的代价。
   */
  readProgress(input: ReadProgressInput): Promise<TurnProgress>
}
