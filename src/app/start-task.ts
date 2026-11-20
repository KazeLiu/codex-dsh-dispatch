/**
 * `dsh_start` 用例：注册工作区 → 建会话 → 应用配置 → 提交首条任务。
 *
 * 顺序上刻意把「能不能解析出配置」放在建会话之前：模型目录读不到、请求的
 * 模型不存在、权限档位在当前环境不可用——这些都在**建会话之前**就能判定，
 * 先建再失败会留下一个什么都不做的空会话，客户端还得自己收拾。真正的
 * 「应用被拒」只能发生在建会话之后，那时错误里会带上 `workspaceId` /
 * `sessionId` / `cwd` / `requestId`，满足文档第 4 节「返回错误 + 已创建会话
 * 定位信息」的要求。
 */

import { isCodexProjectlessDirectory } from '../codex/projectless-directory.js'
import { BridgeError, bridgeError } from '../domain/errors.js'
import { resolveModelChoice, type ModelChoiceFailure } from '../domain/model-choice.js'
import { resolvePermissionChoice } from '../domain/permission-choice.js'
import { isPermissionLevel } from '../domain/permission-map.js'
import type { PermissionLevel, RequestedModel, TaskStatus } from '../domain/types.js'
import type { SessionRecord } from '../ports/index.js'
import {
  assertNotBusy,
  isAbsolutePath,
  observedKey,
  observeTask,
  requireNonEmpty,
  type AppDeps,
  type StartRecord,
  currentViews,
  forRequest,
  requestFingerprint,
  submitSerial,
} from './deps.js'
import { readSavedModel, readSavedPermission, readSavedWorkspaceId } from './settings.js'

/** `dsh_start` 入参（已从 MCP 参数解析）。 */
export interface StartTaskInput {
  /** 省略或传入 Codex 已知的无项目目录时，使用「无项目默认工作区」。 */
  readonly cwd: unknown
  readonly task: unknown
  readonly requestId: unknown
  readonly sourcePermission: unknown
  readonly model: unknown
}

/** `dsh_start` 出参。 */
export interface StartTaskOutput extends StartRecord {
  readonly status: TaskStatus
}

/**
 * 执行 `dsh_start`。
 *
 * 幂等：同一 `requestId` 再次到达时不重复建会话，而是按登记表找回会话、
 * 重新观测状态后返回同一份定位信息。宿主的 `prompt` 去重只在同一会话内按
 * `rpcId` 生效，覆盖不到「每次都会新建会话」的 `dsh_start`，所以这一层
 * 回执必须由桥接自己持有。
 */
export async function startTask(deps: AppDeps, input: StartTaskInput): Promise<StartTaskOutput> {
  return submitSerial(deps, () => executeStartTask(deps, input))
}

async function executeStartTask(deps: AppDeps, input: StartTaskInput): Promise<StartTaskOutput> {
  const task = requireNonEmpty(input.task, 'task')
  const requestId = requireNonEmpty(input.requestId, 'requestId')
  const sourcePermission = readSourcePermission(input.sourcePermission)
  const requestedModel = readRequestedModel(input.model)
  const explicitCwd = readExplicitCwd(input.cwd)
  const explicitWorkspace = explicitCwd === null || await isCodexProjectlessDirectory(explicitCwd)
    ? null
    : await deps.ports.workspace.ensureWorkspace({ cwd: explicitCwd })

  // 无项目派单的重试沿用首次登记的目录，不重新读默认工作区。
  // 显式传入的目录仍参与冲突检测，不能把不同项目的请求当成同一次。
  for (const existing of await deps.ports.registry.list()) {
    const request = existing.requests?.[requestId]
    if (request?.kind !== 'start') continue
    const fingerprint = requestFingerprint({
      cwd: explicitWorkspace?.canonicalCwd ?? existing.canonicalCwd,
      task,
      sourcePermission,
      requestedModel,
    })
    if (request.fingerprint !== fingerprint) throw bridgeError('invalid-argument', '同一 requestId 已用于不同的创建参数', { requestId })
    await assertNotBusy(deps, existing.canonicalCwd, existing.sessionId)
    if (request.phase === 'prepared') {
      await deps.ports.session.prompt({ sessionId: existing.sessionId, requestId, text: task, mode: 'queue' })
      await deps.ports.registry.upsert({ ...existing, requests: { ...existing.requests, [requestId]: { ...request, phase: 'accepted' } } })
    }
    const { resolved } = await observeTask(deps, forRequest(existing, requestId), null)
    return { workspaceId: existing.workspaceId, sessionId: existing.sessionId, cwd: existing.canonicalCwd, requestId, status: resolved.status, ...await currentViews(deps, existing.sessionId) }
  }

  const workspace = explicitWorkspace ?? await resolveDefaultWorkspace(deps)
  const fingerprint = requestFingerprint({ cwd: workspace.canonicalCwd, task, sourcePermission, requestedModel })
  await assertNotBusy(deps, workspace.canonicalCwd, null)

  // 配置解析：全部在建会话之前完成，失败不留空会话。
  // 三层顺序 = 源权限/请求模型 → 桥接保存的默认值 → DSH 默认（见 docs/DEVELOPMENT.md 第 4、6 节）。
  // 保存值读失败按「无保存值」继续：退到下一层是合法降级，不是错误。
  const savedPermission = await readSavedPermission(deps)
  const savedModel = await readSavedModel(deps)

  const presets = deps.ports.permission.availablePresets()
  const permission = resolvePermissionChoice({
    sourcePermission,
    savedDefault: savedPermission,
    availablePresetIds: presets.options.map((option) => option.presetId),
  })
  if (!permission.ok) {
    throw bridgeError('permission-unavailable', permission.detail, {
      failure: permission.failure,
      requested: sourcePermission,
      saved: savedPermission,
      available: presets.options.map((option) => option.presetId),
    })
  }

  const modelCatalog = await deps.ports.model.catalog()
  const model = resolveModelChoice({
    requested: requestedModel,
    saved: savedModel,
    catalog: modelCatalog.entries,
    dshDefault: modelCatalog.dshDefault,
  })
  if (!model.ok) {
    throw bridgeError(mapModelFailure(model.failure), model.detail, {
      failure: model.failure,
      requested: requestedModel,
    })
  }

  const created = await deps.ports.session.createSession({ workspaceId: workspace.workspaceId })
  const sessionId = created.sessionId

  // 从这里开始出错都要带上会话定位信息，客户端才知道去哪个会话里收拾残局。
  const location = {
    workspaceId: workspace.workspaceId,
    sessionId,
    cwd: workspace.canonicalCwd,
    requestId,
  } as const

  if (permission.apply && permission.view.presetId !== null) {
    try {
      await deps.ports.permission.applyPreset({ sessionId, presetId: permission.view.presetId })
    } catch (cause) {
      throw bridgeError('permission-unavailable', '应用权限档位失败，任务未提交', {
        ...location,
        presetId: permission.view.presetId,
      }, cause)
    }
  }

  if (model.view.provider !== null && model.view.model !== null) {
    try {
      await deps.ports.model.applySelection({
        sessionId,
        provider: model.view.provider,
        model: model.view.model,
        reasoningEffort: model.view.reasoningEffort,
      })
    } catch (cause) {
      const error = cause instanceof BridgeError ? cause : null
      throw bridgeError(
        error?.code ?? 'internal',
        error?.message ?? '应用模型选择失败，任务未提交',
        {
          ...error?.detail,
          ...location,
          provider: model.view.provider,
          model: model.view.model,
          reasoningEffort: model.view.reasoningEffort,
          source: model.view.source,
        },
        cause,
      )
    }
  }

  // 提交前记录基线：回合归属判定式是「对应回合 = T0 + 1」，T0 必须是
  // **提交之前**的 lastTurn，否则会把上一回合的结束事件算成本请求的。
  const baseline = await deps.ports.session.readState({ sessionId })

  const record: SessionRecord = {
    sessionId,
    workspaceId: workspace.workspaceId,
    canonicalCwd: workspace.canonicalCwd,
    lastRequestId: requestId,
    lastSourcePermission: sourcePermission,
    baselineTurn: baseline.lastTurn,
    baselineCursor: baseline.cursor,
    requests: { [requestId]: { kind: 'start', fingerprint, baselineTurn: baseline.lastTurn, baselineCursor: baseline.cursor, phase: 'prepared' } },
  }
  await deps.ports.registry.upsert(record)

  await deps.ports.session.prompt({ sessionId, requestId, text: task, mode: 'queue' })
  await deps.ports.registry.upsert({ ...record, requests: { [requestId]: { ...record.requests![requestId]!, phase: 'accepted' } } })

  const started: StartRecord = {
    workspaceId: workspace.workspaceId,
    sessionId,
    cwd: workspace.canonicalCwd,
    requestId,
    permission: permission.view,
    model: model.view,
  }
  deps.observed.set(observedKey(sessionId, requestId), 'accepted')

  return { ...started, status: 'accepted' }
}

async function resolveDefaultWorkspace(deps: AppDeps): Promise<{
  readonly workspaceId: string
  readonly canonicalCwd: string
}> {
  const savedId = await readSavedWorkspaceId(deps)
  if (savedId === null) {
    throw bridgeError(
      'invalid-argument',
      '本次是无项目派单，但设置里还没有选『无项目默认工作区』。' +
        '请在 DSH 设置 → Codex 派单 → 无项目默认工作区里选一个，或传入实际项目的 cwd。',
      { field: 'cwd' },
    )
  }
  // 用 ID 回查宿主当前事实：工作区可能已被删、被改名、路径被改。
  // 查不到就明确报错，绝不按保存时的路径去 `ensureWorkspace` 重建一个。
  const resolved = await deps.ports.workspace.resolveWorkspace(savedId)
  if (resolved === null) {
    throw bridgeError(
      'invalid-argument',
      `设置里保存的默认工作区 ${savedId} 已不在当前 DSH 里。` +
      '请到 DSH 设置 → Codex 派单 重新选择，或传入实际项目的 cwd。',
      { field: 'cwd', workspaceId: savedId },
    )
  }
  return { workspaceId: resolved.workspaceId, canonicalCwd: resolved.canonicalCwd }
}

/**
 * 读显式 cwd。
 *
 * 一旦传入 cwd 就必须是绝对路径；先校验输入，再判断它是否为 Codex 无项目目录。
 */
function readExplicitCwd(value: unknown): string | null {
  if (value === undefined) return null
  const cwd = requireNonEmpty(value, 'cwd')
  if (!isAbsolutePath(cwd)) {
    throw bridgeError('invalid-argument', `cwd 必须是绝对路径：${cwd}`, { cwd })
  }
  return cwd
}

/** 把模型解析失败原因映射到对外错误码。 */
function mapModelFailure(
  failure: ModelChoiceFailure,
): 'invalid-argument' | 'model-unavailable' | 'dsh-default-unavailable' | 'reasoning-effort-unavailable' | 'saved-model-invalid' {
  switch (failure) {
    case 'incomplete-request':
      return 'invalid-argument'
    case 'requested-effort-unavailable':
      return 'reasoning-effort-unavailable'
    case 'saved-model-unavailable':
      return 'saved-model-invalid'
    case 'dsh-default-unavailable':
      return 'dsh-default-unavailable'
    case 'requested-model-unavailable':
    case 'no-model-available':
      return 'model-unavailable'
  }
}

/** 读源权限：缺省为 `null`；给了非法值必须报错，不能当成「没给」。 */
function readSourcePermission(value: unknown): PermissionLevel | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !isPermissionLevel(value)) {
    throw bridgeError('invalid-argument', 'sourcePermission 只能是 "ask" / "auto" / "full"', {
      field: 'sourcePermission',
    })
  }
  return value
}

/** 读本次模型选择：缺省为 `null`；字段类型不对必须报错。 */
function readRequestedModel(value: unknown): RequestedModel | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object') {
    throw bridgeError('invalid-argument', 'model 必须是对象', { field: 'model' })
  }
  const raw = value as Record<string, unknown>
  const provider = readOptionalString(raw['provider'], 'model.provider')
  const model = readOptionalString(raw['model'], 'model.model')
  const reasoningEffort = readOptionalString(raw['reasoningEffort'], 'model.reasoningEffort')
  const requested: RequestedModel = {
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
  return requested
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw bridgeError('invalid-argument', `${field} 必须是非空字符串`, { field })
  }
  return value
}
