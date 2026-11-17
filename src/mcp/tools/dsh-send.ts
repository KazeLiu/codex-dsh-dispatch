/**
 * `dsh_send` 的 MCP 工具定义。
 */

import { sendTask } from '../../app/send-task.js'
import type { ToolDefinition } from './types.js'

export const SEND_TOOL: ToolDefinition = {
  name: 'dsh_send',
  title: '向 DSH 会话补充任务',
  description:
    '向已有会话提交一段补充文字，返回新的 requestId 与受理状态。' +
    '第 1 阶段不支持 reply（提问回复通道尚未接入），传入会明确报错。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      requestId: { type: 'string', description: '本次补充请求的稳定 ID' },
      text: { type: 'string', description: '补充文字；与 reply 互斥' },
      reply: { type: 'object', description: '第 1 阶段不支持；传入会报错' },
      sourcePermission: {
        type: 'string',
        enum: ['ask', 'auto', 'full'],
        description: '源会话的权限档位；仅在真正变化时同步一次',
      },
    },
    required: ['sessionId', 'requestId'],
    additionalProperties: false,
  },
  run: (deps, args) =>
    sendTask(deps, {
      sessionId: args['sessionId'],
      requestId: args['requestId'],
      text: args['text'],
      reply: args['reply'],
      sourcePermission: args['sourcePermission'],
    }),
}
