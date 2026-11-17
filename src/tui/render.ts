/**
 * TUI 的渲染层：把 `TuiState` 摊成终端文本。
 *
 * 纯字符串拼装，不写 stdout、不读按键——这样渲染结果可以直接断言，交互循环
 * 只负责「打印 + 等键」。宽度按固定 78 列排版，不依赖终端探测（探测失败时
 * 各平台的回退值不一致，反而更难对齐）。
 */

import type { SettingsPermissionOption, SettingsSnapshot } from '../domain/settings.js'
import { currentModel, effortOptions, isDirty, type TuiState } from './state.js'

/** 渲染宽度。 */
const WIDTH = 78

/** 渲染结果：多行文本。 */
export function render(state: TuiState): string {
  const lines: string[] = []
  lines.push(...renderHeader(state))
  lines.push('')

  if (state.connectionError !== null) {
    lines.push(...renderConnectionError(state.connectionError))
  } else if (state.snapshot === null) {
    lines.push('  正在读取设置……')
  } else {
    lines.push(...renderBody(state, state.snapshot))
  }

  lines.push('')
  lines.push(...renderFooter(state))
  return lines.join('\n')
}

/** 标题行：左标题、右连接状态。 */
function renderHeader(state: TuiState): string[] {
  const title = 'Codex DSH Dispatch'
  const status = connectionLabel(state)
  const padding = Math.max(1, WIDTH - displayWidth(title) - displayWidth(status))
  return [title + ' '.repeat(padding) + status]
}

/** 右上角连接状态。 */
function connectionLabel(state: TuiState): string {
  if (state.connectionError !== null) return '未连接'
  const snapshot = state.snapshot
  if (snapshot === null) return '连接中…'
  if (!snapshot.connection.ok) return '已连接（模型目录读取失败）'
  // profile 名宿主不提供可读服务（`SettingsConnection.profile` 恒为 null），
  // 此时显示端点 origin 而不是编一个 profile 名。
  return `已连接：${snapshot.connection.profile ?? snapshot.connection.origin ?? 'desktop'}`
}

/** 连接失败时只显示错误，不显示任何模型列表（避免对着旧列表做选择）。 */
function renderConnectionError(error: string): string[] {
  return [
    '  无法连接 DSH 桥接服务：',
    `    ${error}`,
    '',
    '  请确认：',
    '    1. DSH 正在运行，且已加载 codex-dsh-dispatch 插件；',
    '    2. 环境变量 CODEX_DSH_DISPATCH_TOKEN 已设置，且与本机客户端一致。',
  ]
}

/** 主体：三项设置。 */
function renderBody(state: TuiState, snapshot: SettingsSnapshot): string[] {
  const lines: string[] = []
  lines.push(...renderModelSection(state, snapshot))
  lines.push('')
  lines.push(...renderEffortSection(state))
  lines.push('')
  lines.push(...renderPermissionSection(state, snapshot))
  return lines
}

/** 默认模型。 */
function renderModelSection(state: TuiState, snapshot: SettingsSnapshot): string[] {
  const lines: string[] = []
  const draft = state.draftModel
  const label = draft === null ? '跟随 DSH 默认设置' : `${draft.providerId} / ${draft.modelId}`
  lines.push(`  默认模型      ${label}`)

  if (snapshot.dshDefault !== null) {
    lines.push(
      `                DSH 当前默认：${snapshot.dshDefault.providerId} / ${snapshot.dshDefault.modelId}`,
    )
  }
  if (snapshot.saved.invalid.model) {
    lines.push('                ⚠ 已保存的模型不在当前 Profile 中，请重新选择')
  }

  lines.push('  可选模型：')
  let index = 0
  for (const provider of snapshot.providers) {
    for (const model of provider.models) {
      index += 1
      const mark = draft !== null && draft.providerId === model.providerId && draft.modelId === model.modelId ? '●' : '○'
      // 同名模型必须带供应商，否则两个供应商的同名模型在列表里无法区分。
      lines.push(`    ${mark} [${index}] ${model.providerId} / ${model.modelId}`)
    }
  }
  if (index === 0) {
    lines.push('    （当前 Profile 没有可用模型）')
  }
  return lines
}

/** 思考强度。 */
function renderEffortSection(state: TuiState): string[] {
  const lines: string[] = []
  const model = currentModel(state)
  const draft = state.draftModel
  const label =
    draft === null || draft.reasoningEffort === null ? '跟随模型默认设置' : draft.reasoningEffort
  lines.push(`  思考强度      ${label}`)

  const options = effortOptions(state)
  if (model === null) {
    lines.push('                （先选一个模型才能选强度）')
    return lines
  }
  if (options.length === 0) {
    lines.push(`                （${model.modelId} 不支持思考强度，该项已禁用）`)
    return lines
  }
  const defaultLabel = model.defaultReasoningEffort ?? '（无）'
  lines.push(`                模型默认：${defaultLabel}`)
  for (const option of options) {
    const mark = draft?.reasoningEffort === option.id ? '●' : '○'
    lines.push(`    ${mark} ${option.id}${option.name === option.id ? '' : `（${option.name}）`}`)
  }
  return lines
}

/** 默认权限。 */
function renderPermissionSection(state: TuiState, snapshot: SettingsSnapshot): string[] {
  const lines: string[] = []
  const current = state.draftPermission ?? snapshot.initialPermission
  lines.push(`  默认权限      ${permissionLabel(snapshot, current)}`)

  if (snapshot.saved.invalid.permission) {
    lines.push('                ⚠ 已保存的权限档位当前不可用，请重新选择')
  }
  for (const option of snapshot.permissions) {
    const mark = state.draftPermission === option.level ? '●' : '○'
    const suffix = option.available ? '' : `  ✗ ${option.unavailableReason ?? '不可用'}`
    lines.push(`    ${mark} ${option.level}  ${option.label}${suffix}`)
  }
  if (state.draftPermission === null) {
    lines.push(`    （未保存默认值，新建会话使用初始值：${permissionLabel(snapshot, snapshot.initialPermission)}）`)
  }
  return lines
}

/** 权限档位的中文标签；找不到时退回语义值。 */
function permissionLabel(snapshot: SettingsSnapshot, level: string): string {
  const option: SettingsPermissionOption | undefined = snapshot.permissions.find((item) => item.level === level)
  return option === undefined ? level : option.label
}

/** 底栏：提示 + 操作键。 */
function renderFooter(state: TuiState): string[] {
  const lines: string[] = []
  if (state.message !== null) {
    lines.push(`  ${state.message}`)
    lines.push('')
  }
  if (state.snapshot?.saved.invalid.reasoningEffort === true) {
    lines.push('  ⚠ 已保存的思考强度不被当前模型支持，请重新选择')
    lines.push('')
  }
  const dirty = isDirty(state) ? '  *未保存' : ''
  lines.push(
    `  [m] 选模型  [e] 选强度  [p] 选权限  [r] 刷新列表  [s] 保存默认值  [q] 退出${dirty}`,
  )
  return lines
}

/**
 * 计算显示宽度。
 *
 * 中文按 2 列算，否则标题行右侧状态会错位。只处理常见的宽字符区间，
 * 不引入 `string-width` 依赖（本插件零运行时依赖）。
 */
function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    width += isWide(code) ? 2 : 1
  }
  return width
}

/** 是否是占两列的字符（CJK、全角标点、常见 emoji 区段）。 */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff)
  )
}
