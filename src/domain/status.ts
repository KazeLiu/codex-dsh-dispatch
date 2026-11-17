/**
 * 任务六态与迁移合法性。
 *
 * 六态里只有四个是终态（completed / failed / cancelled），`accepted` 与
 * `running` 是过程态，`needs_input` 是「回合仍在进行、但挂起了待处理输入」。
 */

import type { TaskStatus } from './types.js'

/** 终态集合：进入后不再变化。 */
const TERMINAL: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['completed', 'failed', 'cancelled'])

/** 判断是否为终态。 */
export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL.has(status)
}

/**
 * 判断一次状态迁移是否合法。
 *
 * 规则只有三条，刻意保守：
 * 1. 终态不可再迁移（避免「已取消」被后续 wait 改成「已完成」）。
 * 2. 任何非终态都可以直接进入任一终态。
 * 3. 过程态之间可任意迁移（`accepted → running → needs_input → running` 是常态）。
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true
  if (isTerminal(from)) return false
  return true
}

/**
 * 合并两次观察到的状态，取「信息更靠后」的一个。
 *
 * 用途：`dsh_wait` 超时返回 `reason: 'timeout'` 时，文档要求「保持上一状态，
 * 不升级为终态」。此时若上一状态是 `running`、本次观察到仍是 `running`，
 * 结果就是 `running`；若上一状态已经是终态，则保持不变。
 *
 * `previous` 允许为 `null` 表示「不继承」：`dsh_send` 与 `dsh_cancel` 都是
 * 新任务的第一次观察，若沿用上一请求的终态，`completed` 会被保留下来，
 * 而它们刚刚提交/受理了新动作——客户端会误读。把「不继承」放进签名，
 * 比让调用方记得「别调这个函数」可靠（见 ARCHITECTURE §6.5）。
 */
export function mergeStatus(previous: TaskStatus | null, observed: TaskStatus): TaskStatus {
  if (previous === null) return observed
  if (isTerminal(previous)) return previous
  return observed
}
