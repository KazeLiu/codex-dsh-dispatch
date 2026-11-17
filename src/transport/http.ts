import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { checkRequest, readConfiguredToken } from './auth.js'
import type { RouteHandler } from './route.js'

export const MAX_BODY_BYTES = 1024 * 1024
export interface TransportOptions { readonly token: string | null }

export function createMcpHandler(createServer: () => Server, options?: Partial<TransportOptions>): RouteHandler {
  const token = options?.token ?? readConfiguredToken()
  return async (req, res) => {
    const rejection = checkRequest(req, token)
    if (rejection !== null) { sendJson(res, rejection.status, { error: rejection.message }); return }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST')
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }
    let body: unknown
    try { body = JSON.parse(await readBody(req)) as unknown }
    catch (cause) {
      if (cause instanceof SyntaxError) sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: '无法解析 JSON' } })
      else sendJson(res, 413, { error: '请求体超过上限' })
      return
    }
    const server = createServer()
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
    res.once('close', () => { void server.close() })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  }
}

export async function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Buffer
    size += buffer.length
    if (size > limit) throw new Error('请求体超过上限')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}
