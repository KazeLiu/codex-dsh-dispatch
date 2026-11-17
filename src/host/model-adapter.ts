/**
 * 模型适配器：`ModelPort` 的宿主实现。
 *
 * 只设置会话模型，不使用会同时保存全局默认值的 selectModel 界面接口。
 */

import type {
  ApplySelectionInput,
  CurrentSelectionInput,
  ModelCatalogResult,
  ModelPort,
} from '../ports/model-port.js'
import type { ModelCatalogEntry } from '../domain/model-choice.js'
import { bridgeError } from '../domain/errors.js'
import { readService, requireService } from './context.js'
import type { HostContext, HostModelCatalog } from './host-types.js'

export function createModelAdapter(ctx: HostContext): ModelPort {
  return {
    async catalog(): Promise<ModelCatalogResult> {
      const controller = readService(ctx, 'sessionController')
      if (controller === undefined) return { entries: [], dshDefault: null }

      let catalog: HostModelCatalog
      try {
        catalog = await controller.modelCatalog()
      } catch (cause) {
        throw bridgeError('model-unavailable', '读取模型目录失败', {}, cause)
      }

      return {
        entries: toEntries(catalog),
        dshDefault:
          catalog.default === undefined
            ? null
            : { provider: catalog.default.provider, model: catalog.default.model, reasoningEffort: catalog.default.reasoningEffort },
      }
    },

    async applySelection(input: ApplySelectionInput): Promise<void> {
      const controller = requireService(ctx, 'sessionController')
      try {
        const resolved = await controller.resolveAgent(input.sessionId)
        if ('error' in resolved) throw bridgeError('session-not-found', '会话无法激活', { sessionId: input.sessionId })
        resolved.agent.model.select({
          provider: input.provider,
          model: input.model,
          // `null` 表示「跟随模型默认」，此时**不传**该字段，让宿主取默认；
          // 传空字符串会被当成一个不存在的强度。
          ...(input.reasoningEffort === null ? {} : { reasoningEffort: input.reasoningEffort }),
        })
      } catch (cause) {
        throw bridgeError(
          'model-unavailable',
          `应用模型 ${input.provider}/${input.model} 失败`,
          { provider: input.provider, model: input.model },
          cause,
        )
      }
    },

    async currentSelection(input: CurrentSelectionInput): Promise<{
      readonly provider: string
      readonly model: string
      readonly reasoningEffort: string | null
    } | null> {
      // 优先读取会话模型控制器；未取得时只读取原生日志中的实际调用配置。
      const agent = readService(ctx, 'agents')?.get(input.sessionId)
      const current = agent?.model.current()
      if (current !== undefined) return { ...current, reasoningEffort: current.reasoningEffort ?? null }
      const session = readService(ctx, 'sessions')?.get(input.sessionId)
      const events = session?.snapshotEvents() ?? []
      const header = events.findLast(event => event.type === 'request/header')?.data as { header?: { config?: { provider?: string; model?: string; reasoningEffort?: string } } } | undefined
      const config = header?.header?.config
      return typeof config?.provider === 'string' && typeof config.model === 'string'
        ? { provider: config.provider, model: config.model, reasoningEffort: config.reasoningEffort ?? null }
        : null
    },
  }
}

/**
 * 宿主目录 → 端口条目。
 *
 * 只保留桥接需要的信息：`reasoningEfforts` 用于校验强度，`defaultReasoningEffort`
 * 用于「跟随模型默认」。宿主的分组（`groups`）在这里被抹平成一层列表，
 * 因为桥接的模型选择只认 `provider + model` 这一对稳定 ID。
 */
function toEntries(catalog: HostModelCatalog): readonly ModelCatalogEntry[] {
  const entries: ModelCatalogEntry[] = []
  for (const group of catalog.groups) {
    for (const model of group.models) {
      entries.push({
        provider: group.id,
        model: model.id,
        reasoningEfforts: (model.reasoning?.efforts ?? []).map((effort) => effort.id),
        defaultReasoningEffort: model.reasoning?.defaultEffort ?? null,
      })
    }
  }
  return entries
}
