/**
 * Codex 接入的本地配置：只存「用户指定的 Node 可执行文件路径」。
 *
 * 为什么不塞进 `settings.json`：那份文件是**桥接默认值**（模型 / 强度 / 权限），
 * 语义是「新建会话用什么」；这里是「本机怎么跑 Codex 的 MCP 登记」，属于另一件事。
 * 混在一起会让设置文件的版本语义变模糊，也会让「还原默认值」误伤 Node 路径。
 *
 * 注意：本层是纯类型与纯函数，不碰 `node:*`（依赖规则 D2）。
 */

import { bridgeError } from './errors.js'

/** 磁盘上的形态。 */
export interface CodexConfig {
  /**
   * 用户填的 node 绝对路径；`null` 表示「自动从 PATH 解析」。
   *
   * 存的是**用户输入的原样**，不是解析结果：解析结果会随 PATH 变化，
   * 存下来就等于把某次探测的偶然结果固化成配置。
   */
  readonly node: string | null
}

export const EMPTY_CODEX_CONFIG: CodexConfig = { node: null }

/** 解析磁盘内容。任何异常都降级成空配置，不让插件起不来。 */
export function parseCodexConfig(value: unknown): CodexConfig {
  if (typeof value !== 'object' || value === null) return EMPTY_CODEX_CONFIG
  const node = (value as { node?: unknown }).node
  if (typeof node !== 'string' || node.trim() === '') return EMPTY_CODEX_CONFIG
  return { node: node.trim() }
}

/**
 * 校验写入请求。
 *
 * 写入是用户主动操作，非法值必须报错而不是静默丢弃——否则用户会以为
 * 自己填的路径生效了，实际还在用 PATH 里那个。
 */
export function readCodexConfigUpdate(value: unknown): CodexConfig {
  if (typeof value !== 'object' || value === null) {
    throw bridgeError('invalid-argument', 'Codex 配置请求体必须是对象', { field: 'body' })
  }
  const node = (value as { node?: unknown }).node
  if (node === null || node === undefined) return EMPTY_CODEX_CONFIG
  if (typeof node !== 'string') {
    throw bridgeError('invalid-argument', 'node 必须是字符串或 null', { field: 'node' })
  }
  const trimmed = node.trim()
  if (trimmed === '') return EMPTY_CODEX_CONFIG
  return { node: trimmed }
}
