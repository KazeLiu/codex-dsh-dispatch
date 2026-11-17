/**
 * `dsh_start` 的 MCP 工具定义。
 *
 * schema 只描述形状，真正的校验在用例层（那里能给出更准确的中文说明）。
 */

import { startTask } from '../../app/start-task.js'
import type { ToolDefinition } from './types.js'

export const START_TOOL: ToolDefinition = {
  name: 'dsh_start',
  title: '启动 DSH 任务',
  description:
    '在一个绝对工作目录下启动 DSH 任务，返回 workspaceId / sessionId / cwd / requestId / status ' +
    '以及本次实际生效的模型与权限档位（含各自来源）。同一 requestId 重复调用不会重复建会话。',
  inputSchema: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: '绝对工作目录路径' },
      task: { type: 'string', description: '完整任务文字' },
      requestId: { type: 'string', description: '客户端生成的稳定请求 ID，用于幂等' },
      sourcePermission: {
        type: 'string',
        enum: ['ask', 'auto', 'full'],
        description: '源会话的权限档位；省略则使用桥接默认值',
      },
      model: {
        type: 'object',
        description: '本次模型选择；provider 与 model 必须成对出现',
        properties: {
          provider: { type: 'string' },
          model: { type: 'string' },
          reasoningEffort: { type: 'string', description: '思考强度；省略则跟随模型默认' },
        },
        additionalProperties: false,
      },
    },
    required: ['cwd', 'task', 'requestId'],
    additionalProperties: false,
  },
  run: (deps, args) =>
    startTask(deps, {
      cwd: args['cwd'],
      task: args['task'],
      requestId: args['requestId'],
      sourcePermission: args['sourcePermission'],
      model: args['model'],
    }),
}
