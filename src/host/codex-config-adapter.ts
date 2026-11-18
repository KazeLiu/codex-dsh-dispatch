/**
 * Codex 配置端口的宿主实现：读写 `$DSH_HOME/codex-dsh-dispatch/codex.json`。
 *
 * 与 `settings-adapter.ts` 同一套约定（每次读盘、串行写、临时文件 + rename），
 * 但**分文件**：这份配置描述「本机怎么跑 Codex」，与桥接默认值互不影响，
 * 一次损坏不该牵连另一份。
 *
 * 为什么放在 `host/`：依赖规则 D2 禁止 `domain/` 与 `ports/` 触碰 `node:fs`。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  EMPTY_CODEX_CONFIG,
  parseCodexConfig,
  type CodexConfig,
} from '../domain/codex-config.js'
import { bridgeError } from '../domain/errors.js'
import type { CodexConfigPort } from '../ports/codex-port.js'
import type { HostContext } from './host-types.js'

const DATA_DIR_NAME = 'codex-dsh-dispatch'
const CONFIG_FILE_NAME = 'codex.json'

/** 与 `settings-adapter.ts` 同规则：显式 > `$DSH_HOME` > `~/.dsh`。 */
function resolveDshHome(configured?: string): string {
  if (configured !== undefined && configured.trim() !== '') return configured
  const fromEnv = process.env['DSH_HOME']
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv
  return join(homedir(), '.dsh')
}

export function createCodexConfigAdapter(
  ctx: HostContext,
  configuredHome?: string,
): CodexConfigPort {
  const filePath = join(resolveDshHome(configuredHome), DATA_DIR_NAME, CONFIG_FILE_NAME)
  let queue: Promise<unknown> = Promise.resolve()

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task)
    queue = next.catch(() => undefined)
    return next
  }

  async function load(): Promise<CodexConfig> {
    let raw: string
    try {
      raw = await readFile(filePath, 'utf8')
    } catch (cause) {
      if (isNotFound(cause)) return EMPTY_CODEX_CONFIG
      ctx.logger.warn(`读取 Codex 接入配置失败，按「自动解析 Node」继续：${filePath}`)
      return EMPTY_CODEX_CONFIG
    }
    try {
      return parseCodexConfig(JSON.parse(raw) as unknown)
    } catch {
      ctx.logger.warn(`Codex 接入配置内容损坏，本次按「自动解析 Node」继续：${filePath}`)
      return EMPTY_CODEX_CONFIG
    }
  }

  async function persist(state: CodexConfig): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temporary, filePath)
  }

  return {
    read(): Promise<CodexConfig> {
      return serial(async () => load())
    },

    write(config): Promise<CodexConfig> {
      return serial(async () => {
        try {
          await persist(config)
        } catch (cause) {
          throw bridgeError('internal', `写入 Codex 接入配置失败：${filePath}`, {}, cause)
        }
        return config
      })
    },
  }
}

function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: unknown }).code === 'ENOENT'
  )
}
