import { readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { resolveCodexHome } from './codex-home.js'

/** 只识别本机 Codex 明确记录的无项目目录，不从目录名猜测。 */
export async function isCodexProjectlessDirectory(cwd: string): Promise<boolean> {
  let snapshot: unknown
  try {
    snapshot = JSON.parse(await readFile(join(resolveCodexHome(), '.codex-global-state.json'), 'utf8'))
  } catch {
    // Codex CLI、其他客户端或较旧桌面版本可能没有这份状态，不能据此改写 cwd。
    return false
  }

  const state = record(snapshot)
  const ids = state['projectless-thread-ids']
  if (!Array.isArray(ids)) return false
  const projectless = new Set<unknown>(ids)
  const matches = Object.entries(state).some(([key, directories]) =>
    key.startsWith('electron-owner-value:thread-projectless-output-directories:') &&
    Object.entries(record(directories)).some(([id, output]) =>
      projectless.has(id) && typeof output === 'string' && isAbsolute(output) &&
      basename(output) === 'outputs' && relative(cwd, dirname(output)) === '',
    ),
  )
  if (!matches) return false

  // 用户可以把旧对话目录选作真正的本地项目；明确登记的项目优先。
  return !Object.values(record(state['local-projects'])).some(project => {
    const roots = record(project)['rootPaths']
    return Array.isArray(roots) && roots.some(root =>
      typeof root === 'string' && isAbsolute(root) && relative(cwd, root) === '',
    )
  })
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
