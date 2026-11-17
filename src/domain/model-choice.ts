/**
 * 模型选择解析：决定本次任务实际使用哪个 provider / model / 思考强度。
 *
 * 三层顺序（见 docs/DEVELOPMENT.md 第 4 节）：
 * 1. 请求显式指定（`model` 参数）
 * 2. 桥接保存的默认值（由 `SettingsPort` 持久化，读不到时降级为缺失）
 * 3. DSH 全局默认（由宿主 `modelCatalog().default` 提供）
 *
 * 关键约束：**不猜**。请求里 provider 与 model 必须成对出现；保存的默认值
 * 若已失效（provider 或 model 不在目录里）必须报错并保留失效状态，不能
 * 自动换成别的模型，也不能悄悄退回 DSH 默认。
 */

import type { ModelSource, ModelView, RequestedModel, SavedModel } from './types.js'

/** 模型目录中的一项（已抹平宿主细节）。 */
export interface ModelCatalogEntry {
  readonly provider: string
  readonly model: string
  readonly reasoningEfforts: readonly string[]
  readonly defaultReasoningEffort: string | null
}

/** 解析输入。 */
export interface ModelChoiceInput {
  readonly requested: RequestedModel | null
  readonly saved: SavedModel | null
  readonly catalog: readonly ModelCatalogEntry[]
  /** 宿主报告的全局默认；不可读时为 `null`。 */
  readonly dshDefault: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string | undefined } | null
}

/** 解析失败原因。 */
export type ModelChoiceFailure =
  /** provider 与 model 只给了一个。 */
  | 'incomplete-request'
  /** 请求指定的模型不在当前目录里。 */
  | 'requested-model-unavailable'
  /** 请求指定的思考强度不被该模型支持。 */
  | 'requested-effort-unavailable'
  /** 保存的默认模型已失效。 */
  | 'saved-model-unavailable'
  /** 三层都没有可用的模型。 */
  | 'no-model-available'

/** 解析结果。 */
export type ModelChoiceResult =
  | { readonly ok: true; readonly view: ModelView }
  | { readonly ok: false; readonly failure: ModelChoiceFailure; readonly detail: string }

/** 在目录里找一条记录。 */
function findEntry(
  catalog: readonly ModelCatalogEntry[],
  provider: string,
  model: string,
): ModelCatalogEntry | null {
  for (const entry of catalog) {
    if (entry.provider === provider && entry.model === model) return entry
  }
  return null
}

/**
 * 决定思考强度。
 *
 * 规则：显式指定优先；否则跟随模型默认（`defaultReasoningEffort`）；
 * 模型不支持思考时返回 `null`（表示「不设置」），而不是空字符串。
 */
function resolveEffort(
  entry: ModelCatalogEntry,
  requested: string | undefined,
): { ok: true; effort: string | null } | { ok: false; detail: string } {
  if (requested === undefined) {
    return { ok: true, effort: entry.defaultReasoningEffort }
  }
  if (!entry.reasoningEfforts.includes(requested)) {
    return {
      ok: false,
      detail:
        `模型 ${entry.provider}/${entry.model} 不支持思考强度 "${requested}"，` +
        `可用值：${entry.reasoningEfforts.length === 0 ? '（无）' : entry.reasoningEfforts.join(', ')}`,
    }
  }
  return { ok: true, effort: requested }
}

/**
 * 按三层顺序解析模型选择。
 *
 * 返回 `source` 让调用方能如实回显「这个选择是谁定的」，这是文档第 7 节
 * 对 `dsh_start` 返回体的硬要求。
 */
export function resolveModelChoice(input: ModelChoiceInput): ModelChoiceResult {
  const { requested, saved, catalog, dshDefault } = input

  // 第 1 层：请求显式指定
  if (requested !== null) {
    const hasProvider = requested.provider !== undefined
    const hasModel = requested.model !== undefined
    if (hasProvider !== hasModel) {
      return {
        ok: false,
        failure: 'incomplete-request',
        detail: 'model.provider 与 model.model 必须同时提供或同时省略',
      }
    }
    if (hasProvider && hasModel) {
      const provider = requested.provider as string
      const model = requested.model as string
      const entry = findEntry(catalog, provider, model)
      if (entry === null) {
        return {
          ok: false,
          failure: 'requested-model-unavailable',
          detail: `当前 Profile 中不存在模型 ${provider}/${model}`,
        }
      }
      const effort = resolveEffort(entry, requested.reasoningEffort)
      if (!effort.ok) {
        return { ok: false, failure: 'requested-effort-unavailable', detail: effort.detail }
      }
      return {
        ok: true,
        view: { provider, model, reasoningEffort: effort.effort, source: 'request' satisfies ModelSource },
      }
    }
    // 只给了 reasoningEffort：落到下一层选模型，但强度仍按请求值处理。
  }

  const requestedEffort = requested?.reasoningEffort

  // 第 2 层：桥接保存的默认值（失效即报错，不自动换）
  if (saved !== null) {
    const entry = findEntry(catalog, saved.provider, saved.model)
    if (entry === null) {
      return {
        ok: false,
        failure: 'saved-model-unavailable',
        detail: `桥接保存的默认模型 ${saved.provider}/${saved.model} 在当前 Profile 中已不可用，请重新配置`,
      }
    }
    const effort = resolveEffort(entry, requestedEffort ?? saved.reasoningEffort)
    if (!effort.ok) {
      return { ok: false, failure: 'requested-effort-unavailable', detail: effort.detail }
    }
    return {
      ok: true,
      view: {
        provider: saved.provider,
        model: saved.model,
        reasoningEffort: effort.effort,
        source: 'bridge-default' satisfies ModelSource,
      },
    }
  }

  // 第 3 层：DSH 全局默认
  if (dshDefault !== null) {
    const entry = findEntry(catalog, dshDefault.provider, dshDefault.model)
    if (entry !== null) {
      const effort = resolveEffort(entry, requestedEffort ?? dshDefault.reasoningEffort)
      if (!effort.ok) {
        return { ok: false, failure: 'requested-effort-unavailable', detail: effort.detail }
      }
      return {
        ok: true,
        view: {
          provider: dshDefault.provider,
          model: dshDefault.model,
          reasoningEffort: effort.effort,
          source: 'dsh-default' satisfies ModelSource,
        },
      }
    }
  }

  // 目录读不到：如实报未知，不编造 provider/model
  if (catalog.length === 0) {
    return {
      ok: true,
      view: { provider: null, model: null, reasoningEffort: null, source: 'unknown' satisfies ModelSource },
    }
  }

  return {
    ok: false,
    failure: 'no-model-available',
    detail: '模型目录中没有可用的默认模型，请在请求中显式指定 model',
  }
}
