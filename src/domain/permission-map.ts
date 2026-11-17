/**
 * 权限映射：桥接语义值（`ask` / `auto` / `full`）↔ DSH 预设 ID。
 *
 * 为什么必须分开：桥接三档是**语义**（要不要人工批准、能写哪些路径），
 * DSH 预设 ID 是**配置项名字**，两者的取值集合并不相同——`auto` 甚至不是
 * 配置表里的预设，而是自动审查插件在运行时注册的。因此：
 * - 语义值 → 预设 ID 的映射表写在这里；
 * - 预设是否真的可用，必须运行时问 `PermissionPort`，不能靠本表推断；
 * - 反向映射只用于「读回当前生效值」，读不到就报 `unknown`，绝不猜。
 */

import type { PermissionLevel } from './types.js'

/** 三档语义值 → DSH 预设 ID。 */
const LEVEL_TO_PRESET: Readonly<Record<PermissionLevel, string>> = {
  // 需要人工逐次批准：用工作区可写沙箱 + 询问式批准
  ask: 'workspace-write',
  // 由自动审查代批准：预设 ID 固定为 auto，可用性由自动审查插件决定
  auto: 'auto',
  // 完全放开：无需批准
  full: 'danger-full-access',
}

/** 预设 ID → 三档语义值；`custom` 等未知值不在表内。 */
const PRESET_TO_LEVEL: Readonly<Record<string, PermissionLevel>> = {
  'workspace-write': 'ask',
  auto: 'auto',
  'danger-full-access': 'full',
}

/** 桥接初始默认值：文档规定为 `ask`。 */
export const INITIAL_PERMISSION: PermissionLevel = 'ask'

/** 判断一个外部传入值是否是合法的三档语义值。 */
export function isPermissionLevel(value: unknown): value is PermissionLevel {
  return value === 'ask' || value === 'auto' || value === 'full'
}

/**
 * 语义值 → 预设 ID。
 *
 * 只做查表，不校验可用性：调用方必须再用 `PermissionPort.availablePresets()`
 * 确认该预设真的存在，否则 `auto` 会在未启用自动审查的环境里静默失败。
 */
export function presetOfLevel(level: PermissionLevel): string {
  return LEVEL_TO_PRESET[level]
}

/**
 * 预设 ID → 语义值。
 *
 * 返回 `null` 表示无法映射（例如 `read-only`、`custom`）。调用方应把这种情况
 * 报成 `level: 'unknown'` + `source: 'unknown'`，而不是猜一个最接近的档位。
 */
export function levelOfPreset(presetId: string): PermissionLevel | null {
  return PRESET_TO_LEVEL[presetId] ?? null
}
