/**
 * 权限端口：读取可用预设、应用预设、读回当前预设。
 *
 * 第 1 阶段只实现 `availablePresets`（用于判断 `auto` 是否真的可用），
 * `applyPreset` / `currentPreset` 留接口给第 2 阶段。
 *
 * 注意：本层只允许类型声明（依赖规则 D3）。
 */

/** 一个可用预设。 */
export interface PresetOption {
  /** DSH 预设 ID，例如 `workspace-write`、`auto`。 */
  readonly presetId: string
  readonly name: string
  readonly description: string | null
}

export interface AvailablePresetsResult {
  readonly options: readonly PresetOption[]
  /** 宿主配置的默认预设 ID；读不到时为 `null`。 */
  readonly defaultPresetId: string | null
}

export interface ApplyPresetInput {
  readonly sessionId: string
  readonly presetId: string
}

export interface CurrentPresetInput {
  readonly sessionId: string
}

export interface PermissionPort {
  /** 列出当前真正可用的预设（含自动审查注册的 `auto`）。 */
  availablePresets(): AvailablePresetsResult

  /**
   * 给会话应用预设。
   *
   * 预设不存在时抛 `PresetUnavailableError`，**不得静默降级**到别的预设。
   */
  applyPreset(input: ApplyPresetInput): Promise<void>

  /** 读回会话当前预设；读不到返回 `null`（调用方报 `unknown`）。 */
  currentPreset(input: CurrentPresetInput): Promise<string | null>
}
