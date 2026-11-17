import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export interface Connection { readonly url: string; readonly token: string }

export function connectionFile(home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')): string {
  return join(home, 'dsh-mcp-bridge', 'access.json')
}

export async function readConnection(home?: string): Promise<Connection> {
  const raw: unknown = JSON.parse(await readFile(connectionFile(home), 'utf8'))
  if (raw === null || typeof raw !== 'object') throw new Error('桥接连接信息无效')
  const value = raw as Record<string, unknown>
  if (typeof value.url !== 'string' || typeof value.token !== 'string' || value.token.length < 24) throw new Error('桥接连接信息无效')
  const url = new URL(value.url)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('桥接只允许连接本机回环地址')
  return { url: value.url, token: value.token }
}

export async function accessToken(home?: string): Promise<string> {
  const configured = process.env['DSH_MCP_BRIDGE_TOKEN']
  if (configured !== undefined && configured.trim() !== '') return configured
  try { return (await readConnection(home)).token }
  catch (cause) {
    if (cause === null || typeof cause !== 'object' || !('code' in cause) || cause.code !== 'ENOENT') throw cause
    return randomBytes(32).toString('base64url')
  }
}

export async function publishConnection(connection: Connection, home?: string): Promise<void> {
  const file = connectionFile(home)
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(connection), { mode: 0o600 })
  await rename(temporary, file)
}
