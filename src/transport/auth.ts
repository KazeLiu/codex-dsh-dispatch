/**
 * 认证围栏：仅回环 + 客户端凭据。
 *
 * 两道关都要过（docs/DEVELOPMENT.md 第 9 节）：
 * 1. **来源必须是回环地址**——即使宿主把端口暴露到局域网，也不接受外部来源。
 * 2. **必须带正确的 Bearer 凭据**——回环上的其它进程同样不可信。
 *
 * 凭据只从环境变量读取，**绝不写进源码、Git、任务正文或日志**。没配置凭据时
 * 一律拒绝（fail closed）：宁可插件不可用，也不能在无认证状态下暴露一个能
 * 在用户机器上执行任务的接口。
 */

import type { IncomingMessage } from 'node:http'

/** 凭据环境变量名。 */
export const TOKEN_ENV = 'CODEX_DSH_DISPATCH_TOKEN'

/** 认证结果：`null` 表示放行。 */
export interface AuthRejection {
  readonly status: number
  readonly message: string
}

/**
 * 判断地址是否属于回环。
 *
 * 覆盖 IPv4 回环段、IPv6 回环、以及 IPv4-mapped IPv6 形式（`::ffff:127.0.0.1`）
 * ——Node 在双栈监听时会把 IPv4 连接报成后者，漏判会让所有本机请求都被拒。
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined || address === '') return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) {
    return isLoopbackAddress(normalized.slice('::ffff:'.length))
  }
  if (normalized === 'localhost') return true
  const octets = normalized.split('.')
  if (octets.length !== 4) return false
  const first = Number(octets[0])
  return Number.isInteger(first) && first === 127
}

/** 读取配置的凭据；未配置或为空白时返回 `null`。 */
export function readConfiguredToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[TOKEN_ENV]
  if (raw === undefined || raw.trim() === '') return null
  return raw
}

/**
 * 校验一次请求。
 *
 * 返回 `null` 表示放行。拒绝信息刻意不含内部路径、不含期望凭据的任何片段
 * ——错误信息本身也是泄漏面。
 */
export function checkRequest(request: IncomingMessage, token: string | null): AuthRejection | null {
  if (!isLoopbackAddress(request.socket.remoteAddress ?? undefined)) {
    return { status: 403, message: 'forbidden: loopback-only' }
  }
  if (token === null) {
    return {
      status: 503,
      message: `bridge is not configured: set ${TOKEN_ENV} before starting DSH`,
    }
  }
  const presented = readBearer(request.headers.authorization)
  if (presented === null) {
    return { status: 401, message: 'unauthorized: missing bearer credential' }
  }
  if (!timingSafeEqual(presented, token)) {
    return { status: 401, message: 'unauthorized: invalid credential' }
  }
  return null
}

/** 从 `Authorization` 头取 Bearer 值。 */
function readBearer(header: string | undefined): string | null {
  if (header === undefined) return null
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim())
  if (match === null) return null
  const value = match[1]
  return value === undefined || value === '' ? null : value
}

/**
 * 定长比较，避免按字节提前返回泄漏凭据前缀。
 *
 * 长度不同时仍然走完整轮比较：先把长度差异折进结果，再逐字节异或。
 */
function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  let diff = leftBytes.length ^ rightBytes.length
  const length = Math.max(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return diff === 0
}
