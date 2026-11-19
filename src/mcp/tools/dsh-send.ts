/**
 * `dsh_send` 的 MCP 工具定义。
 */

import { sendTask } from '../../app/send-task.js'
import type { ToolDefinition } from './types.js'

export const SEND_TOOL: ToolDefinition = {
  name: 'dsh_send',
  title: '在原 DSH 会话继续派单',
  description:
    '用已有的 sessionId 在原 DSH 会话里提交下一项任务、补充指令或回答提问，不新建会话。' +
    '同一个 Codex 对话在同一工作区的后续派单优先用本工具；每项新任务用新的 requestId。' +
    '返回本次状态和 dsh_wait 所需的 sessionId、requestId 与 cursor。' +
    'text 与 reply 必须恰好给一个。text 用 mode 选择投递方式：queue（缺省）排队等当前回合结束后执行，' +
    '适合提交下一项任务或返工；steer 插进当前正在执行的回合，适合在跑的过程中纠偏或补充方向。' +
    'steer 由宿主在可接受的边界注入，不保证立刻打断正在执行的工具调用，受理也不代表已经生效。' +
    'reply 走宿主的提问回答通道，把答案塞进当前开放的回合，不能同时指定 mode。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: '此前 dsh_start 返回的 DSH 会话 ID；不要用工作区 ID 代替' },
      requestId: { type: 'string', description: '本次请求的稳定 ID；新任务用新 ID，重试沿用该 ID' },
      text: { type: 'string', description: '下一项任务或补充指令；与 reply 互斥' },
      mode: {
        type: 'string',
        enum: ['queue', 'steer'],
        description:
          '仅配合 text 使用。queue（缺省）排队等当前回合结束后执行；steer 插进当前正在执行的回合。' +
          '与 reply 一起提供会报 invalid-argument。',
      },
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
      mode: args['mode'],
      sourcePermission: args['sourcePermission'],
    }),
}
