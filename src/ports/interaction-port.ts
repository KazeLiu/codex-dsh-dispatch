/**
 * 交互端口：读取会话当前挂起的审批与提问，并回答提问。
 *
 * `pendingInput` 是只读观察（`dsh_wait` 用它如实告诉客户端「卡在等输入」以及
 * 「卡在什么上」）；`answer` 是第 4 阶段接上的写路径，供 `dsh_send` 的 `reply`
 * 使用。
 *
 * 注意：本层只允许类型声明（依赖规则 D3）。
 */

/** 一个待回答的问题选项。 */
export interface QuestionOption {
  readonly label: string
  readonly description: string | null
}

/** 一个待回答的问题。 */
export interface PendingQuestion {
  readonly id: string
  readonly question: string
  readonly options: readonly QuestionOption[]
}

/** 待处理输入快照。 */
export interface PendingInputSnapshot {
  /** 待回答的问题；没有则为空数组。 */
  readonly questions: readonly PendingQuestion[]
  /**
   * 原生交互标识（`ask_user_question` 的 `callId`）。
   *
   * 客户端要用它回填 `dsh_send` 的 `reply.callId`，所以能读到就必须给。
   * 读不到时为 `null`——此时仍要报 `needs_input`（`kind` 本身已是有用信息），
   * 只是客户端无法走 reply 路径。
   */
  readonly callId: string | null
  /**
   * 是否存在挂起的审批。
   *
   * 刻意用布尔而不是数量：宿主的 `pendingInput` 是 `Set` 去重后的**种类**列表
   * （`dsh-api-session-controller/src/state/controller.ts:165-172` 先 `kinds.add(...)`
   * 再 `[...kinds]`），同时挂 3 个审批也只会出现一个 `'approval'`，
   * 数出来恒为 1。叫 `approvalCount` 会谎报数量。
   */
  readonly hasApproval: boolean
}

export interface PendingInputOfInput {
  readonly sessionId: string
}

/** 对一个问题的回答。 */
export interface QuestionAnswer {
  /** 问题 ID，对应 `PendingQuestion.id`。 */
  readonly id: string
  /** 选中的选项标签；多选时多个。 */
  readonly selected: readonly string[]
  /** 自定义回答；没有则为 `null`。 */
  readonly custom: string | null
}

export interface AnswerInput {
  readonly sessionId: string
  /** 原生交互标识，来自 `PendingInputSnapshot.callId`。 */
  readonly callId: string
  readonly answers: readonly QuestionAnswer[]
}

/**
 * 回答结果。
 *
 * 失败一律抛错而不是返回 `false`：调用方（`dsh_send`）必须能区分「已受理」
 * 与「没受理」，返回布尔会让「假成功」成为默认路径。
 */
export interface AnswerResult {
  readonly accepted: true
}

export interface InteractionPort {
  /** 读会话当前挂起的输入。 */
  pendingInput(input: PendingInputOfInput): Promise<PendingInputSnapshot>

  /**
   * 回答一个挂起的提问。
   *
   * 宿主侧要求「活的 Agent 句柄」且 callId 仍处于 `continued` 态；已被 TUI
   * 回答、已超时、或答案批次不完整都会被拒，此时抛错并由调用方转成
   * `invalid-argument`（附 `detail.reason`）。
   */
  answer(input: AnswerInput): Promise<AnswerResult>
}
