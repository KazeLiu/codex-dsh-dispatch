/**
 * `dsh_send` 用例：往已有会话补一段文字，或回答一个提问。
 *
 * 与 `dsh_start` 的两处关键差异（docs/ARCHITECTURE.md 第 6.5 / 6 节）：
 * - **不继承终态**：`dsh_send` 是「提交新任务」，若继承上一次的 `completed`，
 *   客户端会看到「刚提交新任务，状态却是已完成」。所以 `previous` 传 `null`。
 * - **不重复应用默认权限**：只在源权限值真正变化（或首次取得）时同步一次，
 *   否则每个补充请求都改一次权限，会覆盖用户在 DSH 界面里的手动调整。
 */

import { bridgeError } from '../domain/errors.js'
import { isPermissionLevel, presetOfLevel } from '../domain/permission-map.js'
import type { ModelView, PermissionLevel, PermissionView, PromptMode, TaskStatus } from '../domain/types.js'
import type { QuestionAnswer, RequestRecord, SessionRecord } from '../ports/index.js'
import { assertNotBusy, currentViews, forRequest, observedKey, observeTask, requestFingerprint, requireNonEmpty, submitSerial, type AppDeps } from './deps.js'

/** `dsh_send` 入参。 */
export interface SendTaskInput {
  readonly sessionId: unknown
  readonly requestId: unknown
  readonly text: unknown
  readonly reply: unknown
  /** 仅对 `text` 有效：`queue` 排队（缺省），`steer` 插进当前回合。 */
  readonly mode?: unknown
  readonly sourcePermission: unknown
}

/**
 * `dsh_send` 出参。
 *
 * `cursor` 必须返回：客户端拿到 `dsh_send` 结果后要能直接接着 `dsh_wait`，
 * 自己猜游标会重复拉取已裁剪的记录。
 *
 * `model` 是**提交后回读**的会话实际生效值（`currentViews`），不是本次请求
 * 传入的期望值——`dsh_send` 不接受模型参数（ARCHITECTURE 第 5.3 节）。
 *
 * `mode` 只在 `text` 提交时出现，回显本次实际使用的提交方式；`reply` 走宿主
 * 的提问回答通道，没有提交方式可言，因此不返回该字段。
 */
export interface SendTaskOutput {
  readonly model: ModelView
  readonly sessionId: string
  readonly requestId: string
  readonly status: TaskStatus
  readonly cursor: number
  readonly permission: PermissionView
  readonly mode?: PromptMode
}

/**
 * 执行 `dsh_send`。
 *
 * 幂等：同一 `requestId` 重复提交由宿主原生按 `rpcId` 去重（`prompt` 首行即
 * 检查 `hasPromptRequest`），桥接不再自建去重表——两份事实源在重载后必然
 * 不一致。这里额外做的是「同一 requestId 不重复推进基线」，否则第二次提交
 * 会把基线推到新回合上，导致该请求永远看不到自己的结束事件。
 */
export async function sendTask(deps: AppDeps, input: SendTaskInput): Promise<SendTaskOutput> {
  return submitSerial(deps, () => executeSendTask(deps, input))
}

async function executeSendTask(deps: AppDeps, input: SendTaskInput): Promise<SendTaskOutput> {
  const sessionId = requireNonEmpty(input.sessionId, 'sessionId')
  const requestId = requireNonEmpty(input.requestId, 'requestId')
  const sourcePermission = readSourcePermission(input.sourcePermission)
  const content = readContent(input.text, input.reply)
  const mode = readMode(input.mode, content.kind)

  const record = await deps.ports.registry.get(sessionId)
  if (record === null) {
    throw bridgeError('session-not-found', `会话不存在或不属于本插件：${sessionId}`, { sessionId })
  }

  // 同一 requestId 的重放：不重复提交、不推进基线，只回当前状态。
  //
  // 这里必须走完整观测而不是「不在 running 就算 accepted」：`observed` 在该
  // 请求成功时被写成 `accepted`，若按它回显，一个早已 `completed` 的请求在
  // 客户端重试时会看到「已受理」，然后一直等下去。观测走的是与 `dsh_wait`
  // 完全相同的判定链（终态保持 + 回合归属），结论一致。
  //
  // 摘要里带上 `mode`：同一 requestId 换个提交方式（queue ↔ steer）不是同一
  // 次提交，必须按冲突拒绝，而不是静默沿用旧记录。
  const fingerprint = requestFingerprint({ content, mode, sourcePermission })
  const saved = record.requests?.[requestId]
  if (saved !== undefined && saved.fingerprint !== fingerprint) {
    throw bridgeError('invalid-argument', '同一 requestId 已用于不同的提交（内容或提交方式不同）', { sessionId, requestId })
  }
  if (saved?.phase === 'accepted' || (saved === undefined && record.lastRequestId === requestId)) {
    const key = observedKey(sessionId, requestId)
    const { snapshot, resolved } = await observeTask(deps, forRequest(record, requestId), deps.observed.get(key) ?? null)
    deps.observed.set(key, resolved.status)
    return {
      sessionId,
      requestId,
      status: resolved.status,
      cursor: snapshot.cursor,
      ...await currentViews(deps, sessionId),
      ...(saved?.kind === 'text' ? { mode: saved.mode ?? 'queue' } : {}),
    }
  }

  await assertNotBusy(deps, record.canonicalCwd, sessionId)
  if (saved === undefined) await applyPermissionIfChanged(deps, record, sourcePermission, sessionId)

  // 提交前记录基线（T0 = 提交前的 lastTurn、C0 = 提交前的会话游标）。
  //
  // 这两个值只用来**限定观察窗口**：从 C0 之后翻历史、只认回合号 ≥ T0 的
  // `turn/end`。真正的落点回合由原生事件里的 `rpcId` / `callId` 决定，不由
  // 这里的 T0 推算——`steer` 会插进提交时已经打开的那个回合（正是 T0），
  // `queue` 才会落到 T0 之后新开的回合上。
  const baseline = await deps.ports.session.readState({ sessionId })
  const request: RequestRecord = saved ?? {
    kind: content.kind,
    fingerprint,
    baselineTurn: baseline.lastTurn,
    baselineCursor: baseline.cursor,
    phase: 'prepared',
    ...(content.kind === 'text' ? { mode: mode ?? 'queue' } : {}),
    ...(content.kind === 'reply' ? { callId: content.callId } : {}),
  }
  const next: SessionRecord = {
    ...record,
    lastRequestId: requestId,
    lastSourcePermission: sourcePermission ?? record.lastSourcePermission,
    baselineTurn: request.baselineTurn,
    baselineCursor: request.baselineCursor,
    requests: { ...record.requests, [requestId]: request },
  }
  await deps.ports.registry.upsert(next)

  // 清掉该 requestId 的旧观察值：新请求不继承旧状态。
  deps.observed.delete(observedKey(sessionId, requestId))

  if (content.kind === 'reply') {
    // 回答提问走原生 `userQuestions.answer`：它把答案作为 steering 消息塞进
    // **当前正在执行的回合**，不会新开回合。所以落点是那个已经打开的回合
    // （回合号可能就等于 T0），由适配器按 `callId` 从原生事件里认出来。
    const progress = await deps.ports.session.readProgress({ sessionId, requestId, callId: content.callId, afterSeq: request.baselineCursor, sinceTurn: request.baselineTurn })
    if (!progress.admitted) await deps.ports.interaction.answer({ sessionId, callId: content.callId, answers: content.answers })
    await deps.ports.registry.upsert({ ...next, requests: { ...next.requests, [requestId]: { ...request, phase: 'accepted' } } })
    deps.observed.set(observedKey(sessionId, requestId), 'accepted')
    return { sessionId, requestId, status: 'accepted', cursor: request.baselineCursor, ...await currentViews(deps, sessionId) }
  }

  // 提交方式由调用方显式选择，桥接只做透传：
  // - `queue`（缺省）：等当前回合结束后再执行，适合「任务完成后的返工」或
  //   「独立的下一个步骤」。
  // - `steer`：插进当前回合，由宿主在可接受的边界注入，适合「正在跑但方向
  //   需要纠正」。宿主不保证立刻打断所有工具调用，`accepted` 也不代表已生效。
  await deps.ports.session.prompt({ sessionId, requestId, text: content.text, mode: mode ?? 'queue' })
  await deps.ports.registry.upsert({ ...next, requests: { ...next.requests, [requestId]: { ...request, phase: 'accepted' } } })
  deps.observed.set(observedKey(sessionId, requestId), 'accepted')

  // 返回的是**提交时**的游标（新基线），客户端拿它直接接着 `dsh_wait` 即可
  // 只看到本次提交之后产生的输出。
  return {
    sessionId,
    requestId,
    status: 'accepted',
    cursor: request.baselineCursor,
    ...await currentViews(deps, sessionId),
    ...(mode === null ? {} : { mode }),
  }
}

/**
 * 权限同步：仅当源权限值相对上次记录发生变化时才应用。
 *
 * 返回本次的权限视图。没有变化时按记录里的上次源值反推档位，并标
 * `source-session`——这不是「猜」，而是「上次由源会话定的值仍然是当前值」。
 */
async function applyPermissionIfChanged(
  deps: AppDeps,
  record: SessionRecord,
  sourcePermission: PermissionLevel | null,
  sessionId: string,
): Promise<PermissionView> {
  if (sourcePermission === null) return (await currentViews(deps, sessionId)).permission
  if (sourcePermission === record.lastSourcePermission) {
    return (await currentViews(deps, sessionId)).permission
  }

  const presetId = presetOfLevel(sourcePermission)
  const presets = deps.ports.permission.availablePresets()
  const available = presets.options.some((option) => option.presetId === presetId)
  if (!available) {
    throw bridgeError(
      'permission-unavailable',
      sourcePermission === 'auto'
        ? '权限档位 "auto" 在当前环境不可用（需要启用自动审查插件），任务未提交'
        : `权限档位 "${sourcePermission}" 在当前环境不可用，任务未提交`,
      { requested: sourcePermission, presetId, available: presets.options.map((o) => o.presetId) },
    )
  }

  try {
    await deps.ports.permission.applyPreset({ sessionId, presetId })
  } catch (cause) {
    throw bridgeError(
      'permission-unavailable',
      '应用权限档位失败，任务未提交',
      { sessionId, presetId },
      cause,
    )
  }

  return { level: sourcePermission, presetId, source: 'source-session' }
}

/** 读源权限：缺省 `null`；非法值必须报错。 */
function readSourcePermission(value: unknown): PermissionLevel | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !isPermissionLevel(value)) {
    throw bridgeError('invalid-argument', 'sourcePermission 只能是 "ask" / "auto" / "full"', {
      field: 'sourcePermission',
    })
  }
  return value
}

/**
 * 读提交方式。
 *
 * 只对 `text` 有意义：`reply` 走宿主的提问回答通道（`userQuestions.answer`），
 * 答案天然被塞进当前开放回合，没有第二种投递方式，因此显式传 `mode` 一律报
 * `invalid-argument`，而不是静默忽略——静默忽略会让调用方以为自己用了 steer。
 *
 * 缺省即 `queue`：与加入 `mode` 之前的调用语义完全一致，老客户端不用改。
 */
function readMode(value: unknown, kind: 'text' | 'reply'): PromptMode | null {
  const provided = value !== undefined && value !== null
  if (kind === 'reply') {
    if (provided) {
      throw bridgeError('invalid-argument', 'reply 走宿主的提问回答通道，不能同时指定 mode', { field: 'mode' })
    }
    return null
  }
  if (!provided) return 'queue'
  if (value !== 'queue' && value !== 'steer') {
    throw bridgeError('invalid-argument', 'mode 只能是 "queue" 或 "steer"', { field: 'mode' })
  }
  return value
}

/**
 * 读提交内容：`text` 与 `reply` 互斥，二者必须恰好给一个。
 *
 * `reply` 走宿主原生 `userQuestions.answer`（第 4 阶段接入）。形状校验放在这里
 * 而不是交给宿主：宿主的 `BAD_ANSWER` 只校验「每个问题恰好答一次」，不校验
 * 字段类型，脏结构会以更难懂的方式失败。
 */
function readContent(
  text: unknown,
  reply: unknown,
): { kind: 'text'; text: string } | { kind: 'reply'; callId: string; answers: readonly QuestionAnswer[] } {
  const hasText = text !== undefined && text !== null
  const hasReply = reply !== undefined && reply !== null
  if (hasText && hasReply) {
    throw bridgeError('invalid-argument', 'text 与 reply 不能同时提供', {
      fields: ['text', 'reply'],
    })
  }
  if (hasReply) {
    return readReply(reply)
  }
  if (!hasText) {
    throw bridgeError('invalid-argument', '必须提供 text 或 reply', { fields: ['text', 'reply'] })
  }
  return { kind: 'text', text: requireNonEmpty(text, 'text') }
}

/** 读 `reply`：`{ callId, answers: [{ id, selected: string[], custom? }] }`。 */
function readReply(reply: unknown): { kind: 'reply'; callId: string; answers: readonly QuestionAnswer[] } {
  if (typeof reply !== 'object' || reply === null || Array.isArray(reply)) {
    throw bridgeError('invalid-argument', 'reply 必须是对象', { field: 'reply' })
  }
  const raw = reply as Record<string, unknown>
  const callId = requireNonEmpty(raw['callId'], 'reply.callId')
  const rawAnswers = raw['answers']
  if (!Array.isArray(rawAnswers) || rawAnswers.length === 0) {
    throw bridgeError('invalid-argument', 'reply.answers 必须是非空数组', { field: 'reply.answers' })
  }
  const answers = rawAnswers.map((item, index) => readAnswer(item, index))
  return { kind: 'reply', callId, answers }
}

function readAnswer(value: unknown, index: number): QuestionAnswer {
  const field = `reply.answers[${index}]`
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw bridgeError('invalid-argument', `${field} 必须是对象`, { field })
  }
  const raw = value as Record<string, unknown>
  const id = requireNonEmpty(raw['id'], `${field}.id`)
  const selectedRaw = raw['selected']
  if (!Array.isArray(selectedRaw) || selectedRaw.some((item) => typeof item !== 'string')) {
    throw bridgeError('invalid-argument', `${field}.selected 必须是字符串数组`, { field: `${field}.selected` })
  }
  const customRaw = raw['custom']
  if (customRaw !== undefined && customRaw !== null && typeof customRaw !== 'string') {
    throw bridgeError('invalid-argument', `${field}.custom 必须是字符串`, { field: `${field}.custom` })
  }
  return {
    id,
    selected: selectedRaw as readonly string[],
    custom: typeof customRaw === 'string' ? customRaw : null,
  }
}
