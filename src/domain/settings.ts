/**
 * 设置领域模型：桥接保存的默认模型 / 默认权限，以及设置页要展示的快照。
 *
 * 三层配置解析（docs/DEVELOPMENT.md 第 4、5、6 节）里，「桥接保存的默认值」
 * 就是这一层。它只描述**用户选择过什么**，不描述**当前环境能不能用**——
 * 后者必须每次现场问宿主（模型目录、可用预设），否则保存值一旦失效就会被
 * 当成仍然有效，等于悄悄换模型或悄悄放宽权限。
 *
 * 注意：本层是纯类型与纯函数，不碰 `node:*`，也不碰宿主包（依赖规则 D2）。
 */

import { bridgeError } from './errors.js'
import type { WorkspaceSummary } from './workspace.js'
import type { ModelCatalogEntry } from './model-choice.js'
import { presetOfLevel } from './permission-map.js'
import type { PermissionLevel, SavedModel } from './types.js'

/* ------------------------------------------------------------------ *
 * 设置页展示用的形状（由 transport 层与 TUI 共同消费）
 * ------------------------------------------------------------------ */

/** 一个可选思考强度。 */
export interface ReasoningEffortOption {
  readonly id: string
  readonly name: string
}

/** 设置页里的一个模型。 */
export interface SettingsModel {
  readonly providerId: string
  readonly modelId: string
  readonly displayName: string
  readonly reasoningEfforts: readonly ReasoningEffortOption[]
  /** 该模型经 DSH 解析出的默认强度；没有则为 `null`。 */
  readonly defaultReasoningEffort: string | null
}

/** 设置页里的一个供应商。 */
export interface SettingsProvider {
  readonly providerId: string
  readonly displayName: string
  readonly models: readonly SettingsModel[]
}

/**
 * 保存下来的模型选择。
 *
 * 模型与思考强度作为**同一个选择**保存（docs/DEVELOPMENT.md 第 5 节）：
 * 切换模型时强度重置为「跟随模型默认」，所以两者必须一起写、一起读。
 */
export interface SavedModelChoice {
  readonly providerId: string
  readonly modelId: string
  /** `null` = 跟随模型默认强度。 */
  readonly reasoningEffort: string | null
}

/** 设置页里的一个权限档位。 */
export interface SettingsPermissionOption {
  /** 桥接语义值。 */
  readonly level: PermissionLevel
  /** 中文标签，可直接展示。 */
  readonly label: string
  /** 映射到的 DSH 预设 ID；读不到为 `null`。 */
  readonly presetId: string | null
  readonly available: boolean
  /** 不可用原因（中文，可直接展示）；可用时为 `null`。 */
  readonly unavailableReason: string | null
}

/**
 * 已保存但当前失效的项。
 *
 * 保留为失效状态：不自动换成别的模型，也不自动放宽权限
 * （docs/DEVELOPMENT.md 第 5、6 节）。
 */
export interface SettingsInvalid {
  readonly model: boolean
  readonly reasoningEffort: boolean
  readonly permission: boolean
  /** 保存的工作区 ID 已不在宿主里；不替用户改选，只标出来。 */
  readonly workspace: boolean
}

/** 与 DSH 的连接状态。 */
export interface SettingsConnection {
  readonly ok: boolean
  /** 当前 profile 名；宿主没有可读的 profile 名服务，恒为 `null`。 */
  readonly profile: string | null
  /** 桥接端点 origin；`app/` 层拿不到 `webServer`（D7），恒为 `null`。 */
  readonly origin: string | null
  /** 读模型目录失败时的中文原因；成功为 `null`。 */
  readonly error: string | null
}

/** 设置页的完整快照。 */
export interface SettingsSnapshot {
  readonly connection: SettingsConnection
  readonly providers: readonly SettingsProvider[]
  readonly dshDefault: SavedModelChoice | null
  readonly permissions: readonly SettingsPermissionOption[]
  /** 宿主已登记的工作区，供「无项目默认工作区」下拉直接选。 */
  readonly workspaces: readonly WorkspaceSummary[] | null
  /** 桥接初始默认值，恒为 `ask`。 */
  readonly initialPermission: PermissionLevel
  readonly saved: {
    readonly model: SavedModelChoice | null
    readonly permission: PermissionLevel | null
    /** 保存的工作区 ID（不是路径）；未设置为 `null`。 */
    readonly workspaceId: string | null
    readonly invalid: SettingsInvalid
  }
}

/**
 * 设置页的写入请求：**可选字段的补丁**。
 *
 * 省略与 `null` 语义不同：省略表示「这次不改这一项」，`null` 表示「改回跟随
 * DSH」。老版本 CLI 与老的 `/mcp/settings` 调用只传模型与权限，绝不能因为
 * 少了 `workspaceId` 就把用户存好的默认工作区清掉。
 */
export interface SettingsUpdate {
  readonly model?: SavedModelChoice | null
  readonly permission?: PermissionLevel | null
  readonly workspaceId?: string | null
}

/* ------------------------------------------------------------------ *
 * 持久化模型
 * ------------------------------------------------------------------ */

/**
 * 设置文件格式版本；结构变化时递增。
 *
 * 3：加入 `defaults.workspaceId`。旧文件没有该字段时按「未设置」读，
 * 不影响模型与权限两项。
 */
export const SETTINGS_VERSION = 3

/** 桥接保存的默认值。 */
export interface SettingsDefaults {
  readonly model: SavedModelChoice | null
  readonly permission: PermissionLevel | null
  /** 无项目默认工作区的 ID；`null` 表示未设置。 */
  readonly workspaceId: string | null
}

/** 磁盘上的形态。 */
export interface PersistedSettings {
  readonly version: number
  readonly defaults: SettingsDefaults
}

/** 空设置：两项都跟随 DSH。 */
export const EMPTY_SETTINGS: PersistedSettings = {
  version: SETTINGS_VERSION,
  defaults: { model: null, permission: null, workspaceId: null },
}

/** 三档权限的中文标签。 */
const PERMISSION_LABELS: Readonly<Record<PermissionLevel, string>> = {
  ask: '请求批准',
  auto: '帮我批准',
  full: '完全访问',
}

/* ------------------------------------------------------------------ *
 * 纯函数
 * ------------------------------------------------------------------ */

/** 读一个可空字符串；非字符串或空白视为 `null`。 */
function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * 解析磁盘上的设置文件。
 *
 * 逐字段校验而不是整体信任：手工编辑过的文件、旧版本写入的缺字段记录，
 * 都应降级成「无保存值」而不是让插件起不来。**任何一项解析失败只丢该项**，
 * 不丢整个文件——用户保存的另一项仍然有效。
 */
export function parseSettingsDocument(value: unknown): PersistedSettings {
  if (typeof value !== 'object' || value === null) return EMPTY_SETTINGS
  const defaults = (value as { defaults?: unknown }).defaults
  if (typeof defaults !== 'object' || defaults === null) return EMPTY_SETTINGS
  const record = defaults as Record<string, unknown>

  return {
    version: SETTINGS_VERSION,
    defaults: {
      model: parseSavedModelChoice(record['model']),
      permission: readPermissionLevel(record['permission']),
      // 旧文件没有这一项：读成「未设置」，不是读失败。
      workspaceId: readNullableString(record['workspaceId']),
    },
  }
}

/** 解析一个保存的模型选择；任一必需字段缺失即视为无效（返回 `null`）。 */
function parseSavedModelChoice(value: unknown): SavedModelChoice | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const providerId = readNullableString(record['providerId'])
  const modelId = readNullableString(record['modelId'])
  if (providerId === null || modelId === null) return null
  return {
    providerId,
    modelId,
    reasoningEffort: readNullableString(record['reasoningEffort']),
  }
}

/** 读三档权限值；非法返回 `null`。 */
function readPermissionLevel(value: unknown): PermissionLevel | null {
  return value === 'ask' || value === 'auto' || value === 'full' ? value : null
}

/**
 * 把保存的选择转成模型解析器要的形状。
 *
 * 两个类型刻意不同名：`SavedModelChoice` 是设置页的持久化形状
 * （`providerId` / `modelId`），`SavedModel` 是领域解析形状
 * （`provider` / `model`）。转换放在这里而不是让解析器认识持久化形状，
 * 是为了让 `model-choice.ts` 不依赖设置模块。
 */
export function toSavedModel(choice: SavedModelChoice | null): SavedModel | null {
  if (choice === null) return null
  return choice.reasoningEffort === null
    ? { provider: choice.providerId, model: choice.modelId }
    : {
        provider: choice.providerId,
        model: choice.modelId,
        reasoningEffort: choice.reasoningEffort,
      }
}

/** 把领域里的模型选择转回设置页形状。 */
export function toSavedModelChoice(saved: SavedModel | null): SavedModelChoice | null {
  if (saved === null) return null
  return {
    providerId: saved.provider,
    modelId: saved.model,
    reasoningEffort: saved.reasoningEffort ?? null,
  }
}

/**
 * 校验写入请求。
 *
 * 与磁盘解析不同，这里**非法就报错**：写入是用户主动操作，静默丢弃会让
 * 用户以为保存成功。错误码用 `invalid-argument`（对应 JSON-RPC `-32602`）。
 */
export function readSettingsUpdate(value: unknown): SettingsUpdate {
  if (typeof value !== 'object' || value === null) {
    throw bridgeError('invalid-argument', '设置请求体必须是对象', { field: 'body' })
  }
  const record = value as Record<string, unknown>
  // 只把请求里真正出现的字段放进补丁：`'model' in record` 为假时这里不加键，
  // 落盘那一步据此保留磁盘上的旧值。
  const patch: {
    model?: SavedModelChoice | null
    permission?: PermissionLevel | null
    workspaceId?: string | null
  } = {}
  if ('model' in record) patch.model = readUpdateModel(record['model'])
  if ('permission' in record) patch.permission = readUpdatePermission(record['permission'])
  if ('workspaceId' in record) patch.workspaceId = readUpdateWorkspace(record['workspaceId'])
  return patch
}

/** 校验请求体里的模型项。 */
function readUpdateModel(value: unknown): SavedModelChoice | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') {
    throw bridgeError('invalid-argument', 'model 必须是对象或 null', { field: 'model' })
  }
  const record = value as Record<string, unknown>
  const providerId = record['providerId']
  const modelId = record['modelId']
  if (typeof providerId !== 'string' || providerId.trim() === '') {
    throw bridgeError('invalid-argument', 'model.providerId 必须是非空字符串', {
      field: 'model.providerId',
    })
  }
  if (typeof modelId !== 'string' || modelId.trim() === '') {
    throw bridgeError('invalid-argument', 'model.modelId 必须是非空字符串', {
      field: 'model.modelId',
    })
  }
  const effort = record['reasoningEffort']
  if (effort !== null && effort !== undefined && typeof effort !== 'string') {
    throw bridgeError('invalid-argument', 'model.reasoningEffort 必须是字符串或 null', {
      field: 'model.reasoningEffort',
    })
  }
  return {
    providerId,
    modelId,
    reasoningEffort: typeof effort === 'string' && effort !== '' ? effort : null,
  }
}

/** 校验请求体里的权限项。 */
function readUpdatePermission(value: unknown): PermissionLevel | null {
  if (value === null || value === undefined) return null
  const level = readPermissionLevel(value)
  if (level === null) {
    throw bridgeError('invalid-argument', 'permission 必须是 ask / auto / full 或 null', {
      field: 'permission',
      received: value,
    })
  }
  return level
}

/** 校验请求体里的默认工作区 ID。空串与 `null` 都表示清除。 */
function readUpdateWorkspace(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw bridgeError('invalid-argument', 'workspaceId 必须是字符串或 null', {
      field: 'workspaceId',
    })
  }
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** 组装快照所需的输入。 */
export interface SettingsSnapshotInput {
  readonly catalog: readonly ModelCatalogEntry[]
  readonly dshDefault: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string | undefined } | null
  readonly availablePresetIds: readonly string[]
  readonly saved: SettingsDefaults
  /** 宿主已登记的工作区；读不到为 null。 */
  readonly workspaces: readonly WorkspaceSummary[] | null
  /** 读模型目录失败时的中文原因；成功为 `null`。 */
  readonly catalogError: string | null
}

/**
 * 组装设置页快照。
 *
 * 关键约束：**失效判定只在「读得到」时才做**。模型目录为空说明读不到，
 * 此时把保存值标成失效等于拿「读不到」当「不存在」，用户会去改一个其实
 * 好端端的配置。同理可用预设列表为空时不判定权限失效。
 */
export function buildSettingsSnapshot(input: SettingsSnapshotInput): SettingsSnapshot {
  const catalogReadable = input.catalog.length > 0
  const presetsReadable = input.availablePresetIds.length > 0
  const savedModel = input.saved.model
  const entry =
    savedModel === null || !catalogReadable
      ? null
      : (input.catalog.find(
          (item) => item.provider === savedModel.providerId && item.model === savedModel.modelId,
        ) ?? null)

  const modelInvalid = savedModel !== null && catalogReadable && entry === null
  const effortInvalid =
    savedModel !== null &&
    savedModel.reasoningEffort !== null &&
    entry !== null &&
    !entry.reasoningEfforts.includes(savedModel.reasoningEffort)
  const permissionInvalid =
    input.saved.permission !== null &&
    presetsReadable &&
    !input.availablePresetIds.includes(presetOfLevel(input.saved.permission))
  // 工作区列表读得到才判失效：读不到（宿主没起、服务晚就绪）不等于工作区被删。
  // 失效也不替用户改选，只把 `saved.workspaceId` 原样留着让人重选或清除。
  const workspaceInvalid =
    input.saved.workspaceId !== null &&
    input.workspaces !== null &&
    !input.workspaces.some((workspace) => workspace.id === input.saved.workspaceId)

  return {
    connection: {
      ok: input.catalogError === null,
      profile: null,
      origin: null,
      error: input.catalogError,
    },
    providers: toProviders(input.catalog),
    dshDefault:
      input.dshDefault === null
        ? null
        : {
            providerId: input.dshDefault.provider,
            modelId: input.dshDefault.model,
            reasoningEffort: input.dshDefault.reasoningEffort ?? null,
          },
    permissions: toPermissionOptions(input.availablePresetIds),
    workspaces: input.workspaces,
    initialPermission: 'ask',
    saved: {
      model: savedModel,
      permission: input.saved.permission,
      workspaceId: input.saved.workspaceId,
      invalid: {
        model: modelInvalid,
        reasoningEffort: effortInvalid,
        permission: permissionInvalid,
        workspace: workspaceInvalid,
      },
    },
  }
}

/**
 * 按供应商分组。
 *
 * 显示名一律用 ID 兜底：`ModelCatalogEntry` 刻意只保留解析所需的最小字段，
 * 宿主给的 `name` 没有透传下来。宁可显示 ID，也不要在这一层重新查一遍目录。
 */
function toProviders(catalog: readonly ModelCatalogEntry[]): readonly SettingsProvider[] {
  const grouped = new Map<string, SettingsModel[]>()
  for (const entry of catalog) {
    const models = grouped.get(entry.provider) ?? []
    models.push({
      providerId: entry.provider,
      modelId: entry.model,
      displayName: entry.model,
      reasoningEfforts: entry.reasoningEfforts.map((id) => ({ id, name: id })),
      defaultReasoningEffort: entry.defaultReasoningEffort,
    })
    grouped.set(entry.provider, models)
  }
  return [...grouped.entries()].map(([providerId, models]) => ({
    providerId,
    displayName: providerId,
    models,
  }))
}

/** 三档权限的展示项；`available` 由当前可用预设决定。 */
function toPermissionOptions(
  availablePresetIds: readonly string[],
): readonly SettingsPermissionOption[] {
  const levels: readonly PermissionLevel[] = ['ask', 'auto', 'full']
  return levels.map((level) => {
    const presetId = presetOfLevel(level)
    const available = availablePresetIds.includes(presetId)
    return {
      level,
      label: PERMISSION_LABELS[level],
      presetId,
      available,
      unavailableReason:
        available || availablePresetIds.length === 0
          ? null
          : level === 'auto'
            ? '需要启用自动审查插件（dsh-experimental-auto-review）后才会出现'
            : `当前 DSH 未提供预设 ${presetId}`,
    }
  })
}
