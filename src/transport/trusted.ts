/**
 * 「这个请求是不是 DSH 自己的界面发的」——同源可信通道的判定。
 *
 * 设置页挂在 DSH 的 webServer 上，页面用相对路径 fetch 就能到，因此不需要
 * Bearer 凭据（页面拿不到、也不该拿到 access.json 里的 token：把凭据发到浏览器
 * 等于暴露给任何能读页面脚本的东西）。代价是必须自己挡住跨站请求。
 *
 * 四道条件缺一不可，与参考实现
 * `deepseek-harness-zh_pro/src/lib/session-delete.ts` 的 `isTrustedApiRequest`
 * 保持一致：
 * 1. `host` 头能解析，且主机名是回环地址——挡住 DNS rebinding（外部域名解析到
 *    127.0.0.1 时，浏览器仍会带那个域名当 host 头）；
 * 2. `sec-fetch-site` 不是 `cross-site`——挡住别的站点发起的跨站请求；
 * 3. 没有 `origin` 头时放行（同源 GET 与部分浏览器导航不带 origin）；
 * 4. 有 `origin` 时它的 host 必须与 `host` 头逐字相等。
 *
 * 只接受 `headers` 形状而不是完整 `IncomingMessage`，方便在没有真实请求对象时
 * 直接按头表判断。
 */

/** 回环主机名判定。`::ffff:127.0.0.1` 这类映射形式也要认。 */
export function isLoopbackHostname(hostname: string): boolean {
  const name = hostname.trim().toLowerCase()
  if (name === 'localhost') return true
  if (name === '::1' || name === '[::1]') return true
  const mapped = name.startsWith('::ffff:') ? name.slice('::ffff:'.length) : name
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(mapped)
}

export function isTrustedApiRequest(req: {
  readonly headers: Record<string, string | string[] | undefined>
}): boolean {
  const host = req.headers['host']
  if (typeof host !== 'string' || host === '') return false

  let hostname: string
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostname)) return false

  if (req.headers['sec-fetch-site'] === 'cross-site') return false

  const origin = req.headers['origin']
  if (origin === undefined) return true
  if (typeof origin !== 'string') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
