/**
 * `dsh_wait` 的 MCP 工具定义。
 */

import { waitTask } from '../../app/wait-task.js'
import type { ToolDefinition } from './types.js'

export const WAIT_TOOL: ToolDefinition = {
  name: 'dsh_wait',
  title: '等待 DSH 任务进展',
  description:
    '按游标返回增量输出与当前状态。超时不等于失败或取消，客户端可带同一 cursor 继续等待。' +
    'status 为 needs_input 时附带 needsInput（卡在等什么）。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      requestId: { type: 'string', description: '要观察的请求 ID' },
      cursor: { type: 'integer', description: '上次返回的 cursor；首次传 -1 或省略' },
      timeoutMs: { type: 'integer', description: '等待时长（毫秒），缺省 30000' },
    },
    required: ['sessionId', 'requestId'],
    additionalProperties: false,
  },
  run: (deps, args, signal) =>
    waitTask(deps, {
      sessionId: args['sessionId'],
      requestId: args['requestId'],
      cursor: args['cursor'],
      timeoutMs: args['timeoutMs'],
      // 客户端断开只中断本次等待，不取消会话执行。
      signal,
    }),
}
