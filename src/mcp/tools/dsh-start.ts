/**
 * `dsh_start` 的 MCP 工具定义。
 *
 * schema 只描述形状，真正的校验在用例层（那里能给出更准确的中文说明）。
 */

import { startTask } from '../../app/start-task.js'
import type { ToolDefinition } from './types.js'

export const START_TOOL: ToolDefinition = {
  name: 'dsh_start',
  title: '新建 DSH 会话并派单',
  description:
    '新建 DSH 会话并提交首项任务，返回 workspaceId / sessionId / cwd / requestId / status，' +
    '以及本次实际生效的模型与权限档位（含各自来源）。' +
    '同一个 Codex 对话在同一工作区继续派单时，请把返回的 sessionId 传给 dsh_send，不要再次调用 dsh_start。' +
    'cwd 可省略：省略时使用用户在 DSH 设置里选定的「无项目默认工作区」；' +
    '无项目对话即使有 Codex 自动生成的工作目录，也应省略 cwd；已识别的无项目目录会按省略处理。' +
    '同一 requestId 重复调用不会重复建会话。',
  inputSchema: {
    type: 'object',
    properties: {
      cwd: {
        type: 'string',
        description: '实际项目或 worktree 的绝对路径；无项目对话应省略，不要传 Codex 生成的对话目录',
      },
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
    required: ['task', 'requestId'],
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
