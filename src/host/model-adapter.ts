/**
 * 模型适配器：`ModelPort` 的宿主实现。
 *
 * 第 1 阶段实现 `catalog`（`dsh_start` 要回显实际生效模型与来源），
 * `applySelection` / `currentSelection` 保留可用实现但暂不接入用例——
 * 权限与模型的写入路径在第 2 阶段随配置解析一起启用。
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
            : { provider: catalog.default.provider, model: catalog.default.model },
      }
    },

    async applySelection(input: ApplySelectionInput): Promise<void> {
      const controller = requireService(ctx, 'sessionController')
      try {
        await controller.selectModel({
          sessionId: input.sessionId,
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
      // 宿主没有「读会话当前模型」的直接方法：模型选择记在会话日志的
      // `request/header` 事件里（dsh-session/src/types.ts:248 `config: LlmCallConfig`），
      // 读它要走历史分页。第 1 阶段不引入这条路径——`dsh_start` 回显的是
      // **本次解析出的选择**，不是从会话读回的值，所以这里返回 `null`，
      // 由上层把 `source` 标成实际来源（而不是 `unknown`）。
      void input
      return null
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
