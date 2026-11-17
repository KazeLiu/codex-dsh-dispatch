/**
 * `dsh_send` 的 MCP 工具定义。
 */

import { sendTask } from '../../app/send-task.js'
import type { ToolDefinition } from './types.js'

export const SEND_TOOL: ToolDefinition = {
  name: 'dsh_send',
  title: '向 DSH 会话补充任务',
  description:
    '向已有会话提交一段补充文字，或回答该会话正在等待的提问，返回新的 requestId 与受理状态。' +
    'text 与 reply 必须恰好给一个：text 新开一个回合，reply 把答案塞进当前开放的回合。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      requestId: { type: 'string', description: '本次补充请求的稳定 ID' },
      text: { type: 'string', description: '补充文字；与 reply 互斥' },
      reply: {
        type: 'object',
        description: '回答该会话正在等待的提问；与 text 互斥',
        properties: {
          callId: { type: 'string', description: '待回答提问的 callId' },
          answers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                selected: { type: 'array', items: { type: 'string' } },
                custom: { type: 'string' },
              },
              required: ['id', 'selected'],
              additionalProperties: false,
            },
          },
        },
        required: ['callId', 'answers'],
        additionalProperties: false,
      },
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
