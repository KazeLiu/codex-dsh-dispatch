/**
 * 设置用例：读设置页快照、写桥接默认值。
 *
 * 这一层只做「把宿主现场事实 + 磁盘保存值拼成一份可展示的快照」，以及
 * 「校验后落盘」。所有判定规则都在 `domain/settings.ts` 里，便于离线验证。
 *
 * 关键约束（docs/DEVELOPMENT.md 第 5、6 节）：
 * - 保存值失效时**保留为失效状态并提示**，不自动换模型、不自动放宽权限；
 * - 读不到目录/预设时**不判定失效**——「读不到」不等于「不存在」；
 * - 写入是用户主动操作，非法值必须报错，不能静默丢弃。
 */

import { bridgeError } from '../domain/errors.js'
import { presetOfLevel } from '../domain/permission-map.js'
import {
  buildSettingsSnapshot,
  readSettingsUpdate,
  toSavedModel,
  type PersistedSettings,
  type SettingsSnapshot,
  type SettingsUpdate,
} from '../domain/settings.js'
import type { AppDeps } from './deps.js'

/**
 * 读设置页快照。
 *
 * 模型目录读失败**不抛错**：设置页必须能打开，否则用户连「为什么用不了」
 * 都看不到。失败原因放进 `connection.error`，`connection.ok` 置 `false`。
 */
export async function readSettings(deps: AppDeps): Promise<SettingsSnapshot> {
  const saved = await deps.ports.settings.read({})
  return composeSnapshot(deps, saved)
}

/**
 * 写桥接默认值并返回新快照。
 *
 * 校验顺序：请求体形状 → 模型是否在目录里 → 思考强度是否属于该模型 →
 * 权限预设是否可用。任一不通过就抛 `invalid-argument`（对应 `-32602`），
 * 让用户当场知道「保存没成功」，而不是下次 `dsh_start` 才发现。
 */
export async function writeSettings(
  deps: AppDeps,
  update: SettingsUpdate,
): Promise<SettingsSnapshot> {
  const validated = readSettingsUpdate(update)

  // 目录读不到时跳过校验：此时无法判断模型是否存在，强行拒绝会让用户在
  // 「DSH 还没起来」的情况下连保存都做不到。失效状态留给下次读取时判定。
  const catalog = await readCatalogSafely(deps)
  if (catalog.entries.length > 0 && validated.model !== null) {
    const entry = catalog.entries.find(
      (item) =>
        item.provider === validated.model?.providerId && item.model === validated.model?.modelId,
    )
    if (entry === undefined) {
      throw bridgeError(
        'invalid-argument',
        `模型 ${validated.model.providerId}/${validated.model.modelId} 不在当前 Profile 中`,
        { field: 'model' },
      )
    }
    const effort = validated.model.reasoningEffort
    if (effort !== null && !entry.reasoningEfforts.includes(effort)) {
      throw bridgeError(
        'invalid-argument',
        `模型 ${entry.provider}/${entry.model} 不支持思考强度 "${effort}"，` +
          `可用值：${entry.reasoningEfforts.length === 0 ? '（无）' : entry.reasoningEfforts.join(', ')}`,
        { field: 'model.reasoningEffort' },
      )
    }
  }

  if (validated.permission !== null) {
    const presets = deps.ports.permission.availablePresets()
    const presetId = presetOfLevel(validated.permission)
    // 可用预设列表为空说明读不到，此时不拦（同上）。
    if (presets.options.length > 0 && !presets.options.some((o) => o.presetId === presetId)) {
      throw bridgeError(
        'invalid-argument',
        validated.permission === 'auto'
          ? '权限档位 "auto" 当前不可用：需要启用自动审查插件（dsh-experimental-auto-review）'
          : `权限档位 "${validated.permission}" 对应的预设 ${presetId} 当前不可用`,
        { field: 'permission', presetId },
      )
    }
  }

  const written = await deps.ports.settings.write({
    defaults: { model: validated.model, permission: validated.permission },
  })
  return composeSnapshot(deps, written)
}

/** 组装快照：读目录（可失败）+ 读可用预设（同步）+ 拼装。 */
async function composeSnapshot(
  deps: AppDeps,
  saved: PersistedSettings,
): Promise<SettingsSnapshot> {
  const catalog = await readCatalogSafely(deps)
  const presets = deps.ports.permission.availablePresets()
  return buildSettingsSnapshot({
    catalog: catalog.entries,
    dshDefault: catalog.dshDefault,
    availablePresetIds: presets.options.map((option) => option.presetId),
    saved: saved.defaults,
    catalogError: catalog.error,
  })
}

/**
 * 读模型目录，失败时返回空目录 + 中文原因。
 *
 * 不用 `try/catch` 吞掉一切：只把「读失败」转成可展示的原因，其余异常照常
 * 上抛——那才是真的 bug。
 */
async function readCatalogSafely(deps: AppDeps): Promise<{
  entries: Awaited<ReturnType<AppDeps['ports']['model']['catalog']>>['entries']
  dshDefault: Awaited<ReturnType<AppDeps['ports']['model']['catalog']>>['dshDefault']
  error: string | null
}> {
  try {
    const catalog = await deps.ports.model.catalog()
    return { entries: catalog.entries, dshDefault: catalog.dshDefault, error: null }
  } catch (cause) {
    return {
      entries: [],
      dshDefault: null,
      error: cause instanceof Error ? cause.message : '读取模型目录失败',
    }
  }
}

/**
 * 读「桥接保存的默认模型」，供 `dsh_start` 做三层解析。
 *
 * 单独导出而不是让 `start-task.ts` 直接碰 `settings.read()`：那里需要的是
 * `SavedModel`（领域解析形状），转换与「读失败降级为空」的策略都应该只有一处。
 */
export async function readSavedModel(deps: AppDeps): Promise<ReturnType<typeof toSavedModel>> {
  try {
    const saved = await deps.ports.settings.read({})
    return toSavedModel(saved.defaults.model)
  } catch {
    // 设置读失败按「无保存值」继续：退到 DSH 默认是合法的第三层，不是错误。
    return null
  }
}

/** 读「桥接保存的默认权限」，供 `dsh_start` 做三层解析。 */
export async function readSavedPermission(
  deps: AppDeps,
): Promise<PersistedSettings['defaults']['permission']> {
  try {
    const saved = await deps.ports.settings.read({})
    return saved.defaults.permission
  } catch {
    return null
  }
}
