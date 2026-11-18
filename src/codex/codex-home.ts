import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Codex 自己的配置目录。
 *
 * 遵循 Codex 的约定：`CODEX_HOME` 优先，缺省 `~/.codex`。`CODEX_HOME` 可能是
 * 相对路径，先 `resolve` 成绝对路径——否则会出现「界面显示一个路径、实际写到
 * 另一个路径」这种最难排查的偏差。
 */
export function resolveCodexHome(): string {
  const home = process.env['CODEX_HOME']?.trim()
  return home !== undefined && home !== '' ? resolve(home) : join(homedir(), '.codex')
}

/**
 * Codex 的 MCP 配置文件。
 *
 * 只用于**展示**：真正写入走 `codex mcp add/remove`，由 Codex 自己决定落在哪、
 * 怎么写，本插件不解析也不重写这份 TOML。
 */
export function codexConfigPath(): string {
  return join(resolveCodexHome(), 'config.toml')
}
