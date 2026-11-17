/**
 * 权限选择解析：决定本次任务实际使用哪一档权限，以及它来自哪一层。
 *
 * 三层顺序（见 docs/DEVELOPMENT.md 第 6 节）：
 * 1. 源会话带来的值（`sourcePermission`）
 * 2. 桥接保存的默认值（由 `SettingsPort` 持久化，读不到时降级为缺失）
 * 3. 初始值 `ask`
 *
 * 关键约束：**不猜、不降级**。请求给的档位在当前环境不可用（典型是 `auto`
 * 但没启用自动审查）必须报错，不能悄悄退成 `full` 或 `ask`——放宽权限是安全
 * 事故，收紧权限则是行为变化，两者都不能替用户决定。
 *
 * 本函数是纯函数：可用预设列表由调用方从 `PermissionPort` 读来再传进来，
 * 因此这一层不依赖宿主。
 */

import { INITIAL_PERMISSION, isPermissionLevel, presetOfLevel } from './permission-map.js'
import type { PermissionLevel, PermissionView } from './types.js'

/** 解析输入。 */
export interface PermissionChoiceInput {
  /** 源会话带来的档位；没有则为 `null`。 */
  readonly sourcePermission: PermissionLevel | null
  /** 桥接保存的默认档位；没有则为 `null`。 */
  readonly savedDefault: PermissionLevel | null
  /**
   * 当前环境真正可用的预设 ID。
   *
   * 空数组表示**读不到**可用预设（宿主服务缺失或未就绪），此时无法判断
   * 任何档位是否可用，按 §5.6 报 `unknown`，不报错也不猜。
   */
  readonly availablePresetIds: readonly string[]
}

/** 解析失败原因。 */
export type PermissionChoiceFailure =
  /** 源权限值非法（调用方应更早校验，这里兜底）。 */
  | 'invalid-source-permission'
  /** 请求的档位在当前环境没有对应预设。 */
  | 'preset-unavailable'

/** 解析结果。 */
export type PermissionChoiceResult =
  | { readonly ok: true; readonly view: PermissionView; readonly apply: boolean }
  | { readonly ok: false; readonly failure: PermissionChoiceFailure; readonly detail: string }

/**
 * 按三层顺序解析权限。
 *
 * 返回 `apply` 告诉调用方是否真的要去写预设：读不到可用预设时 `apply: false`，
 * 此时仍返回真实 `source` 与 `presetId: null` 的视图（如实告诉客户端「档位来自
 * 哪一层、但实际预设读不到」），而不是让整个 `dsh_start` 失败——权限读不到
 * 不该阻断任务执行。
 */
export function resolvePermissionChoice(input: PermissionChoiceInput): PermissionChoiceResult {
  const { sourcePermission, savedDefault, availablePresetIds } = input

  const level: PermissionLevel = sourcePermission ?? savedDefault ?? INITIAL_PERMISSION

  // 兜底：类型上 `PermissionLevel` 已被 `isPermissionLevel` 收窄，但本函数是
  // 导出函数，运行时可能收到任意值（JS 调用方、将来从配置文件回读的旧版本
  // 脏值）。不校验会让 `presetOfLevel` 越界查表得到 `undefined`，detail 变成
  // 「需要预设 "undefined"」——把「输入非法」伪装成「环境缺预设」，客户端会
  // 去查错方向。`savedDefault` 一起校验：它现在恒为 `null` 所以没人注意，
  // 但第 ④ 步从 TUI 持久化回读时同样可能拿到脏值。
  if (sourcePermission !== null && !isPermissionLevel(sourcePermission)) {
    return {
      ok: false,
      failure: 'invalid-source-permission',
      detail: `源权限值非法：${JSON.stringify(sourcePermission)}。可用值：ask / auto / full。`,
    }
  }

  if (savedDefault !== null && !isPermissionLevel(savedDefault)) {
    return {
      ok: false,
      failure: 'invalid-source-permission',
      detail: `桥接保存的默认权限值非法：${JSON.stringify(savedDefault)}。可用值：ask / auto / full。`,
    }
  }

  const source: PermissionView['source'] =
    sourcePermission !== null
      ? 'source-session'
      : savedDefault !== null
        ? 'bridge-default'
        : 'initial'

  const presetId = presetOfLevel(level)

  // 读不到可用预设：`presetId: null` 已完整表达「读不到实际预设」，
  // `source` 仍保留真实来源——「初始值 ask + 读不到预设」与「源会话要 full +
  // 读不到预设」的安全含义完全不同，不能用一个字段同时表达两件事。
  // 不阻断执行，也不假装已应用。
  if (availablePresetIds.length === 0) {
    return { ok: true, view: { level, presetId: null, source }, apply: false }
  }

  if (!availablePresetIds.includes(presetId)) {
    return {
      ok: false,
      failure: 'preset-unavailable',
      detail:
        `权限档位 "${level}" 需要预设 "${presetId}"，但当前环境没有该预设。` +
        `可用预设：${availablePresetIds.join(', ')}。` +
        (level === 'auto' ? '（"auto" 需要启用自动审查插件才会出现）' : ''),
    }
  }

  return { ok: true, view: { level, presetId, source }, apply: true }
}
