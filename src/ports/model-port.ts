/**
 * 模型端口：读模型目录、应用选择、读回当前选择。
 *
 * 第 1 阶段只实现 `catalog`（供 `dsh_start` 回显实际生效模型与来源），
 * `applySelection` / `currentSelection` 留接口给第 2 阶段。
 *
 * 注意：本层只允许类型声明（依赖规则 D3）。
 */

import type { ModelCatalogEntry } from '../domain/model-choice.js'

/** 模型目录快照。 */
export interface ModelCatalogResult {
  readonly entries: readonly ModelCatalogEntry[]
  /** DSH 全局默认；不可读时为 `null`。 */
  readonly dshDefault: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string | undefined } | null
}

export interface ApplySelectionInput {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  /** `null` 表示「跟随模型默认」，不是「不设置」。 */
  readonly reasoningEffort: string | null
}

export interface CurrentSelectionInput {
  readonly sessionId: string
}

export interface ModelPort {
  /** 读模型目录；失败时抛错，由调用方转成固定错误码。 */
  catalog(): Promise<ModelCatalogResult>

  /** 给会话应用模型选择；被拒时抛错，调用方不得继续提交任务。 */
  applySelection(input: ApplySelectionInput): Promise<void>

  /** 读回会话当前选择；读不到返回 `null`。 */
  currentSelection(input: CurrentSelectionInput): Promise<{
    readonly provider: string
    readonly model: string
    readonly reasoningEffort: string | null
  } | null>
}
