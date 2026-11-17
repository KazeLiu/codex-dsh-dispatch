import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { AppDeps } from '../app/deps.js'
import { TOOLS, findTool } from './tools/index.js'
import { toErrorResult, toJsonRpcError, toTextResult } from './errors.js'

/** 协议协商、取消和传输由官方 SDK 负责，工具只负责业务。 */
export function createMcpServer(deps: AppDeps): Server {
  const server = new Server({ name: 'dsh-mcp-bridge', version: '0.1.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(tool => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = findTool(request.params.name)
    if (tool === undefined) throw new McpError(-32602, '未知工具')
    try {
      const value = await tool.run(deps, request.params.arguments ?? {}, extra.signal)
      const result = toTextResult(value)
      return { ...result, content: [...result.content] }
    } catch (cause) {
      const error = toJsonRpcError(cause)
      if (error !== null) throw new McpError(error.code, error.message, error.data)
      const result = toErrorResult(cause)
      return { ...result, content: [...result.content] }
    }
  })
  return server
}
