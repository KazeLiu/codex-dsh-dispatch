/**
 * 交互适配器：读取会话当前挂起的审批与提问，并回答提问。
 *
 * 数据来自两处：
 * - 提问内容与 `callId`：`userQuestions` 投影（`PendingUserQuestion { callId; questions; state }`）；
 * - 审批数量：会话状态的 `pendingInput`（宿主已把 `approval/request` 归成 `approval`）。
 *
 * 读为什么不用 `userQuestions` 服务方法：`UserQuestionService` 只暴露
 * `answer(agent, ...)` 与 `attachWait(agent, ...)`，两者都要求**活的 Agent 对象**
 * 且会拒绝子代理调用，没有「列出挂起提问」的读接口（ADR-010）。
 *
 * 写（`answer`）必须走服务方法：宿主自己维护「已排队回复」与「答案批次完整性」
 * 的判定，绕过它直接塞消息会破坏 `agent/inbox` 的语义。
 */

import { bridgeError } from '../domain/errors.js'
import type {
  AnswerInput,
  AnswerResult,
  InteractionPort,
  PendingInputOfInput,
  PendingInputSnapshot,
  PendingQuestion,
  QuestionOption,
} from '../ports/interaction-port.js'
import { readService, requireService } from './context.js'
import type { HostContext } from './host-types.js'

/** 投影 key；与 `userQuestionProjectionDefinition.key` 一致。 */
const USER_QUESTIONS_KEY = 'userQuestions'

export function createInteractionAdapter(ctx: HostContext): InteractionPort {
  return {
    async pendingInput(input: PendingInputOfInput): Promise<PendingInputSnapshot> {
      const questions = readPendingQuestions(ctx, input.sessionId)
      return {
        questions: questions.items,
        callId: questions.callId,
        hasApproval: await readHasApproval(ctx, input.sessionId),
      }
    },

    async answer(input: AnswerInput): Promise<AnswerResult> {
      const userQuestions = requireService(ctx, 'userQuestions')
      const agents = requireService(ctx, 'agents')

      // 必须拿「活实例」：宿主用 `agents.get(agent.id) !== agent` 校验，
      // 自己拼一个 `{ id }` 会被当成伪造调用方拒绝。
      const agent = agents.get(input.sessionId)
      if (agent === undefined) {
        throw bridgeError(
          'session-not-found',
          `会话不存在或未挂载，无法回答提问：${input.sessionId}`,
          { sessionId: input.sessionId },
        )
      }

      let accepted: boolean
      try {
        accepted = userQuestions.answer(agent, input.callId, {
          answers: input.answers.map((item) =>
            item.custom === null
              ? { id: item.id, selected: [...item.selected] }
              : { id: item.id, selected: [...item.selected], custom: item.custom },
          ),
        })
      } catch (cause) {
        throw toAnswerError(cause, input)
      }

      // 宿主对「callId 已不在 continued 态」返回 false 而不是抛错。
      // 这里必须报错：客户端以为回答已送达，实际上模型永远等不到。
      if (!accepted) {
        throw bridgeError(
          'invalid-argument',
          `提问已不在待回答状态（可能已被界面回答或已超时）：${input.callId}`,
          { sessionId: input.sessionId, callId: input.callId, reason: 'not-pending' },
        )
      }
      return { accepted: true }
    },
  }
}

/**
 * 把宿主 `UserQuestionError` 的 code 转成桥接的固定错误码。
 *
 * 三类都归 `invalid-argument`（对应 JSON-RPC `-32602`）：它们是「这次回答现在
 * 不能送」而不是「桥接坏了」，客户端换一种做法（等下一轮、改答案）才可能成功。
 * `detail.reason` 保留宿主原始分类，便于客户端区分。
 */
function toAnswerError(cause: unknown, input: AnswerInput): unknown {
  const code = errorCodeOf(cause)
  if (code === 'REPLY_QUEUED') {
    return bridgeError('invalid-argument', `该提问已有排队中的回复：${input.callId}`, {
      sessionId: input.sessionId,
      callId: input.callId,
      reason: 'already-queued',
    })
  }
  if (code === 'BAD_ANSWER') {
    return bridgeError('invalid-argument', `答案批次与提问不匹配：${input.callId}`, {
      sessionId: input.sessionId,
      callId: input.callId,
      reason: 'bad-answer',
    })
  }
  if (code === 'CALLER_NOT_LIVE' || code === 'DELEGATED_CALLER') {
    return bridgeError(
      'invalid-argument',
      `宿主拒绝回答：会话不是可交互的活实例（${code}）`,
      { sessionId: input.sessionId, callId: input.callId, reason: 'caller-not-live' },
    )
  }
  return bridgeError('internal', `回答提问失败：${input.callId}`, { sessionId: input.sessionId }, cause)
}

/** 读错误的 `code` 字段（宿主 `UserQuestionError` 把它放在这里）。 */
function errorCodeOf(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null) return null
  const code = (cause as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

/**
 * 读待回答的问题与所属 `callId`。
 *
 * 任何一环不可用（服务缺失、投影未注册、结构不符）都返回空结果——这是**只读**
 * 能力，读不到细节时宁可少报，也不要因为读不到提问就让整个 `dsh_wait` 失败。
 * 上层仍会通过 `pendingInput` 的粗粒度标记报 `needs_input`。
 */
function readPendingQuestions(
  ctx: HostContext,
  sessionId: string,
): { items: readonly PendingQuestion[]; callId: string | null } {
  const empty = { items: [] as readonly PendingQuestion[], callId: null }
  const projections = readService(ctx, 'sessionProjections')
  const sessions = readService(ctx, 'sessions')
  if (projections === undefined || sessions === undefined) return empty

  const session = sessions.get(sessionId)
  if (session === undefined) return empty

  let raw: unknown
  try {
    raw = projections.stateOf(session, USER_QUESTIONS_KEY)
  } catch {
    return empty
  }
  return toPendingQuestions(raw)
}

/**
 * 从投影状态里取 `questions.active` 的一项。
 *
 * `active` 是「仍可回答的调用」列表，每项带一个 `callId` 与若干问题。
 * 同时挂起多个调用时只报**一个**：`dsh_send` 的 `reply` 一次只能回答一个
 * `callId`，报多个会让客户端无从选择；其余的在下一轮 `dsh_wait` 里自然出现。
 *
 * 选哪一项：优先取第一个 `callId` 非空的项，而不是死取 `active[0]`。
 * 若 `active[0]` 恰好缺 `callId`，死取会返回「有 questions 但 callId 为 null」，
 * 客户端拿到问题却无法 reply——这是最坏的一种降级。只有全都没有 `callId` 时
 * 才退回 `active[0]`（此时仍然报 `needs_input`，只是不能走 reply 路径）。
 */
function toPendingQuestions(raw: unknown): {
  items: readonly PendingQuestion[]
  callId: string | null
} {
  const empty = { items: [] as readonly PendingQuestion[], callId: null }
  if (typeof raw !== 'object' || raw === null) return empty
  const questions = (raw as { questions?: unknown }).questions
  if (typeof questions !== 'object' || questions === null) return empty
  const active = (questions as { active?: unknown }).active
  if (!Array.isArray(active) || active.length === 0) return empty

  const entries = active.filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
  )
  if (entries.length === 0) return empty

  const withCallId = entries.find((entry) => typeof entry.callId === 'string')
  const chosen = withCallId ?? entries[0]
  if (chosen === undefined) return empty

  const callId = typeof chosen.callId === 'string' ? chosen.callId : null

  const rawItems = chosen.questions
  if (!Array.isArray(rawItems)) return { items: [], callId }

  const items: PendingQuestion[] = []
  for (const item of rawItems) {
    if (typeof item !== 'object' || item === null) continue
    const id = (item as { id?: unknown }).id
    const question = (item as { question?: unknown }).question
    if (typeof id !== 'string' || typeof question !== 'string') continue
    items.push({ id, question, options: toOptions((item as { options?: unknown }).options) })
  }
  return { items, callId }
}

/** 选项只保留标签与说明，丢掉宿主侧的展示意图等字段。 */
function toOptions(raw: unknown): readonly QuestionOption[] {
  if (!Array.isArray(raw)) return []
  const result: QuestionOption[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const label = (entry as { label?: unknown }).label
    if (typeof label !== 'string') continue
    const description = (entry as { description?: unknown }).description
    result.push({ label, description: typeof description === 'string' ? description : null })
  }
  return result
}

/**
 * 判断当前是否有挂起的审批。
 *
 * 用会话状态的 `pendingInput` 而不是审批服务：`approval` 服务暴露的是
 * `request()`（发起审批）与 `setPolicy()`（改策略），没有「列出挂起审批」的读接口；
 * 而 `pendingInput` 恰好是宿主自己从 `typertGateway.getPendingRemoteEvents()`
 * 推导出来的（dsh-api-session-controller/src/state/controller.ts:165-172）。
 *
 * 只回答「有没有」，不回答「有几个」：`pendingInput` 是 `Set` 去重后的种类列表，
 * 数量信息在宿主侧已经被丢弃，数出来恒为 1。
 *
 * 读失败返回 `false`：审批标记只用于补充说明，不该让整个等待失败。
 */
async function readHasApproval(ctx: HostContext, sessionId: string): Promise<boolean> {
  const controller = readService(ctx, 'sessionController')
  if (controller === undefined) return false
  try {
    const state = await controller.state({ sessionId })
    return state.pendingInput.includes('approval')
  } catch {
    return false
  }
}
