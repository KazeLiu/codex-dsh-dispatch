import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { readConnection } from '../connection.js'

/** Codex 通过 stdio 接入；认证材料由客户端正常读取，不进入 Codex 配置或参数。 */
export async function runMcpProxy(): Promise<void> {
  let upstream: Client | undefined
  let connectedUrl: string | undefined
  async function client(): Promise<Client> {
    const connection = await readConnection()
    if (upstream !== undefined && connectedUrl === connection.url) return upstream
    await upstream?.close()
    const next = new Client({ name: 'codex-dsh-dispatch-proxy', version: '0.1.0' })
    await next.connect(new StreamableHTTPClientTransport(new URL(`${connection.url}/mcp/codex-dsh-dispatch`), {
      requestInit: { headers: { authorization: `Bearer ${connection.token}` } },
    }))
    upstream = next
    connectedUrl = connection.url
    return next
  }
  const server = new Server({ name: 'codex-dsh-dispatch', version: '0.1.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => (await client()).listTools())
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => (await client()).callTool(request.params, undefined, { signal: extra.signal }))
  server.onclose = () => { void upstream?.close() }
  await server.connect(new StdioServerTransport())
}
