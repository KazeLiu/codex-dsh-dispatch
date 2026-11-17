/**
 * 权限适配器：`PermissionPort` 的宿主实现。
 *
 * 第 1 阶段只实现 `availablePresets`（判断 `auto` 是否真的可用），
 * `applyPreset` / `currentPreset` 留到第 2 阶段。
 *
 * 两条硬约束：
 * 1. **只消费不注册**。`auto` 预设由已启用的 `@deepseek-ai/dsh-experimental-auto-review`
 *    通过 `permissionPresets.registerAuto()` 发布；桥接再调 `registerAuto` 会抛
 *    `permission: preset "auto" is already registered`（dsh-permission-presets/src/index.ts:307）。
 * 2. **不猜**。读不到目录就返回空列表，由上层报 `permission-unavailable`，
 *    绝不假设某个预设存在。
 */

import { bridgeError } from '../domain/errors.js'
import type {
  ApplyPresetInput,
  AvailablePresetsResult,
  CurrentPresetInput,
  PermissionPort,
  PresetOption,
} from '../ports/permission-port.js'
import { readService, requireService } from './context.js'
import type { HostContext } from './host-types.js'

export function createPermissionAdapter(ctx: HostContext): PermissionPort {
  return {
    availablePresets(): AvailablePresetsResult {
      const presets = readService(ctx, 'permissionPresets')
      // 服务缺失不是「没有可用预设」，而是宿主能力缺失。端口签名是同步返回，
      // 所以这里返回空列表 + null 默认值，由上层统一报 permission-unavailable。
      if (presets === undefined) return { options: [], defaultPresetId: null }

      try {
        const catalog = presets.catalog()
        return {
          options: catalog.options.map(toOption),
          defaultPresetId: catalog.defaultPreset,
        }
      } catch {
        // 宿主在预设未就绪时会抛 `permission: presets are not ready; ...`
        // （dsh-permission-presets/src/index.ts:330），此时如实返回空。
        return { options: [], defaultPresetId: null }
      }
    },

    async applyPreset(input: ApplyPresetInput): Promise<void> {
      const presets = requireService(ctx, 'permissionPresets')
      const sessions = requireService(ctx, 'sessions')

      // 宿主 `set(session, name)` 要的是**活的 Session 实体**，不是 sessionId。
      const session = sessions.get(input.sessionId)
      if (session === undefined) {
        throw bridgeError('session-not-found', `会话不存在：${input.sessionId}`, {
          sessionId: input.sessionId,
        })
      }

      try {
        presets.set(session, input.presetId)
      } catch (cause) {
        // 未知预设时宿主抛 `permission: unknown preset "X" (known: ...)`；
        // 这里转成固定错误码，并把可用列表带出去供客户端纠正。
        throw bridgeError(
          'permission-unavailable',
          `权限预设 "${input.presetId}" 在当前环境不可用`,
          { presetId: input.presetId, available: presets.names },
          cause,
        )
      }
    },

    async currentPreset(input: CurrentPresetInput): Promise<string | null> {
      const presets = readService(ctx, 'permissionPresets')
      const sessions = readService(ctx, 'sessions')
      if (presets === undefined || sessions === undefined) return null

      const session = sessions.get(input.sessionId)
      if (session === undefined) return null

      try {
        return presets.current(session)
      } catch {
        return null
      }
    },
  }
}

/** 宿主选项 → 端口选项（`description` 缺失统一成 `null`）。 */
function toOption(option: { value: string; name: string; description?: string }): PresetOption {
  return {
    presetId: option.value,
    name: option.name,
    description: option.description ?? null,
  }
}
