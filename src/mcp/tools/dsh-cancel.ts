/**
 * `dsh_cancel` 的 MCP 工具定义。
 */

import { cancelTask } from '../../app/cancel-task.js'
import type { ToolDefinition } from './types.js'

export const CANCEL_TOOL: ToolDefinition = {
  name: 'dsh_cancel',
  title: '取消 DSH 任务',
  description:
    '请求取消会话当前执行。返回的 status 是受理瞬间观察到的状态，' +
    '永远不会是 cancelled——真正的取消结果要由 dsh_wait 观察到 aborted 后报出。',
  inputSchema: {
    type: 'object',
    properties: { sessionId: { type: 'string' } },
    required: ['sessionId'],
    additionalProperties: false,
  },
  run: (deps, args) => cancelTask(deps, { sessionId: args['sessionId'] }),
}
