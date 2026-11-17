/**
 * TUI 的纯状态机：把「设置快照 + 用户草稿」摊平成可渲染、可提交的形状。
 *
 * 刻意不含任何 I/O 与 readline：渲染与状态迁移都能脱离终端单测，交互循环
 * （`main.ts`）只负责把按键翻译成这里的调用。
 *
 * 依赖规则：本文件只 import `../domain/**`。TUI 是**进程外的配置客户端**，
 * 只允许依赖最内层的纯类型与纯函数——它拿不到用例层与宿主层，也就无法绕过
 * 插件直接改 profile、全局默认模型或会话文件。
 */

import type {
  ReasoningEffortOption,
  SavedModelChoice,
  SettingsModel,
  SettingsSnapshot,
} from '../domain/settings.js'
import type { PermissionLevel } from '../domain/types.js'

/** 界面状态。 */
export interface TuiState {
  /** 最近一次成功读到的快照；从未读到为 `null`。 */
  readonly snapshot: SettingsSnapshot | null
  /** 连接失败的中文原因；成功为 `null`。 */
  readonly connectionError: string | null
  /** 草稿：待保存的模型选择（`null` = 跟随 DSH 默认设置）。 */
  readonly draftModel: SavedModelChoice | null
  /** 草稿：待保存的默认权限（`null` = 未设置，运行时退到初始值）。 */
  readonly draftPermission: PermissionLevel | null
  /** 最近一次操作的结果提示；无提示为 `null`。 */
  readonly message: string | null
}

/** 初始状态：还没连上，草稿为空。 */
export const INITIAL_STATE: TuiState = {
  snapshot: null,
  connectionError: null,
  draftModel: null,
  draftPermission: null,
  message: null,
}

/**
 * 用一次成功读取的结果重置状态。
 *
 * 草稿一律回到「已保存值」：刷新是重新取事实，不该保留上一次没保存的编辑
 * （否则用户会以为改动还在，实际保存的是旧快照上的值）。
 */
export function applySnapshot(snapshot: SettingsSnapshot): TuiState {
  return {
    snapshot,
    connectionError: null,
    draftModel: snapshot.saved.model,
    draftPermission: snapshot.saved.permission,
    message: null,
  }
}

/**
 * 连接失败。
 *
 * **保留旧快照但标记不可用**：`connectionError` 非空时渲染层不展示模型列表，
 * 避免用户对着上一次的列表做选择、保存时才发现服务不在。
 */
export function applyConnectionError(state: TuiState, error: string): TuiState {
  return { ...state, connectionError: error, message: null }
}

/** 设置一条提示。 */
export function withMessage(state: TuiState, message: string): TuiState {
  return { ...state, message }
}

/**
 * 选模型。
 *
 * **思考强度同时重置为「跟随模型默认设置」**（docs/DEVELOPMENT.md 第 5 节）：
 * 沿用上一个模型的强度会让新模型收到一个它可能不支持的值，而保存时又会被
 * 校验拒绝，用户看到的是「保存失败」而不是「强度不适用」。
 */
export function selectModel(state: TuiState, model: SettingsModel): TuiState {
  return {
    ...state,
    draftModel: {
      providerId: model.providerId,
      modelId: model.modelId,
      reasoningEffort: null,
    },
    message: null,
  }
}

/** 选「跟随 DSH 默认设置」：清空模型草稿，强度随之无意义。 */
export function selectDshDefaultModel(state: TuiState): TuiState {
  return { ...state, draftModel: null, message: null }
}

/** 选思考强度；`null` = 跟随模型默认。 */
export function selectEffort(state: TuiState, effortId: string | null): TuiState {
  if (state.draftModel === null) return state
  return {
    ...state,
    draftModel: { ...state.draftModel, reasoningEffort: effortId },
    message: null,
  }
}

/** 选默认权限。 */
export function selectPermission(state: TuiState, level: PermissionLevel): TuiState {
  return { ...state, draftPermission: level, message: null }
}

/** 当前草稿选中的模型在目录里的条目；未选或找不到为 `null`。 */
export function currentModel(state: TuiState): SettingsModel | null {
  const draft = state.draftModel
  const snapshot = state.snapshot
  if (draft === null || snapshot === null) return null
  for (const provider of snapshot.providers) {
    for (const model of provider.models) {
      if (model.providerId === draft.providerId && model.modelId === draft.modelId) return model
    }
  }
  return null
}

/**
 * 当前模型可选的思考强度。
 *
 * 未选模型时返回空数组：此时强度项应显示「跟随模型默认设置」并禁止展开
 * （没有模型就没有可选的强度集合）。
 */
export function effortOptions(state: TuiState): readonly ReasoningEffortOption[] {
  return currentModel(state)?.reasoningEfforts ?? []
}

/** 草稿是否与已保存值不同。 */
export function isDirty(state: TuiState): boolean {
  const snapshot = state.snapshot
  if (snapshot === null) return false
  return !sameModel(state.draftModel, snapshot.saved.model) || state.draftPermission !== snapshot.saved.permission
}

/** 两个模型选择是否等价（含强度）。 */
function sameModel(left: SavedModelChoice | null, right: SavedModelChoice | null): boolean {
  if (left === null || right === null) return left === right
  return (
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.reasoningEffort === right.reasoningEffort
  )
}

/** 把草稿转成写入请求体。 */
export function toUpdate(state: TuiState): { readonly model: SavedModelChoice | null; readonly permission: PermissionLevel | null } {
  return { model: state.draftModel, permission: state.draftPermission }
}
