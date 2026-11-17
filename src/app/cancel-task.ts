/**
 * `dsh_cancel` 用例：请求取消会话当前执行。
 *
 * 硬约束（docs/DEVELOPMENT.md 第 7 节 / ARCHITECTURE 第 5.4 节）：
 * 收到取消请求**不等于**已取消。宿主的 `cancel()` 只是「受理」，真正的
 * `cancelled` 只能由 `dsh_wait` 观察到 `turn/end.aborted` 后报出。所以这里
 * 返回的 `status` 是「受理瞬间观察到的状态」，永远不会是 `cancelled`。
 */

import { bridgeError } from '../domain/errors.js'
import type { TaskStatus } from '../domain/types.js'
import { observeTask, requireNonEmpty, type AppDeps } from './deps.js'

/** `dsh_cancel` 入参。 */
export interface CancelTaskInput {
  readonly sessionId: unknown
}

/** `dsh_cancel` 出参。 */
export interface CancelTaskOutput {
  readonly accepted: true
  readonly status: TaskStatus
}

/**
 * 执行 `dsh_cancel`。
 *
 * 不继承终态（`previous` 传 `null`）：取消是一个独立动作，不该被上一次
 * `dsh_wait` 的观察结果左右。
 */
export async function cancelTask(deps: AppDeps, input: CancelTaskInput): Promise<CancelTaskOutput> {
  const sessionId = requireNonEmpty(input.sessionId, 'sessionId')

  const record = await deps.ports.registry.get(sessionId)
  if (record === null) {
    throw bridgeError('session-not-found', `会话不存在或不属于本插件：${sessionId}`, { sessionId })
  }

  await deps.ports.session.cancel({ sessionId })

  // 只有读到原生结束事件才能报告 cancelled，取消受理本身不构成终态。
  const { resolved } = await observeTask(deps, record, null)

  // 该会话所有请求的观察值都要失效：取消会改变后续 wait 的判定基线。
  for (const key of [...deps.observed.keys()]) {
    if (key.startsWith(`${sessionId}\u0000`)) deps.observed.delete(key)
  }

  return { accepted: true, status: resolved.status }
}
