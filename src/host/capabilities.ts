import { bridgeError } from '../domain/errors.js'
import { requireService } from './context.js'
import type { HostContext, HostSessionController } from './host-types.js'

// 与 package.json 的宿主下限一致。
const MIN_HOST_HARNESS = '0.2.2-rc.3'

const MIN_HOST_HINT =
  `请把 DSH NEXT 升级到 2.0.23-next（内置 Harness ${MIN_HOST_HARNESS}）` +
  '或适配的后续版本后重启 DSH。'

type ControllerMethod = keyof HostSessionController
type HostCapability = ControllerMethod | 'agentModel'

const CAPABILITY_LABEL: Readonly<Record<HostCapability, string>> = {
  create: '创建会话',
  prompt: '提交任务',
  cancel: '取消任务',
  state: '读取会话状态',
  events: '读取会话历史',
  wait: '等待会话',
  resolveAgent: '激活会话的 agent',
  modelCatalog: '读取模型目录',
  agentModel: '在会话上切换模型',
}

export function missingCapability(
  capability: HostCapability,
  detail: Readonly<Record<string, unknown>> = {},
): never {
  throw bridgeError(
    'host-capability-missing',
    `当前 DSH 版本没有本插件需要的「${CAPABILITY_LABEL[capability]}」接口。${MIN_HOST_HINT}`,
    { capability, minHarness: MIN_HOST_HARNESS, ...detail },
  )
}

export function requireController<K extends ControllerMethod>(
  ctx: HostContext,
  capabilities: readonly K[],
): HostSessionController & Required<Pick<HostSessionController, K>> {
  const controller = requireService(ctx, 'sessionController')
  for (const name of capabilities) {
    if (typeof controller[name] !== 'function') missingCapability(name)
  }
  return controller as HostSessionController & Required<Pick<HostSessionController, K>>
}
