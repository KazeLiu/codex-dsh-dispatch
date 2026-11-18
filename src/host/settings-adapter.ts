/**
 * 设置端口的宿主实现：读写 `$DSH_HOME/codex-dsh-dispatch/settings.json`。
 *
 * 为什么不用宿主的 `ctx.settings`：那是「编辑 profile 里各插件 Config」的表单
 * 服务（`dsh-settings/src/index.ts` 的 `SettingsForms.describe()` 返回全部已激活
 * 插件的配置项，`update()` 带 `expectedRevision` 走 profile 文档），不是插件存
 * 自己业务状态的 KV。把「桥接默认模型/权限」塞进去要么污染 profile 配置，要么
 * 得给自己注册一份 Config schema —— 两者都比一份扁平 JSON 重。
 *
 * 与 `registry-adapter.ts` 共用同一个数据目录与同一套原子写（临时文件 →
 * rename），但**分文件**：登记表是运行期会话事实，设置是用户偏好，一次损坏
 * 不该互相牵连。
 *
 * 为什么放在 `host/`：依赖规则 D2 禁止 `domain/` 与 `ports/` 触碰 `node:fs`。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { bridgeError } from '../domain/errors.js'
import {
  EMPTY_SETTINGS,
  parseSettingsDocument,
  SETTINGS_VERSION,
  type PersistedSettings,
} from '../domain/settings.js'
import type { SettingsPort } from '../ports/settings-port.js'
import type { HostContext } from './host-types.js'

/** 本插件在 DSH 主目录下的数据子目录名（与登记表一致）。 */
const DATA_DIR_NAME = 'codex-dsh-dispatch'

/** 设置文件名。 */
const SETTINGS_FILE_NAME = 'settings.json'

/**
 * 解析 DSH 主目录。
 *
 * 优先级照抄宿主：显式传入 > `$DSH_HOME`（空白视为未设）> `~/.dsh`。
 * 不 import `dsh-home-paths`（依赖规则 D1 要求全仓 0 处宿主 import）。
 */
function resolveDshHome(configured?: string): string {
  if (configured !== undefined && configured.trim() !== '') return configured
  const fromEnv = process.env['DSH_HOME']
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv
  return join(homedir(), '.dsh')
}

/**
 * 创建设置端口。
 *
 * 读写都串行化在一个 Promise 链上：设置页可能连点保存，而「读-改-写」整文件
 * 不是原子的。串行化比文件锁简单且够用（单进程内）。
 */
export function createSettingsAdapter(
  ctx: HostContext,
  configuredHome?: string,
): SettingsPort {
  const filePath = join(resolveDshHome(configuredHome), DATA_DIR_NAME, SETTINGS_FILE_NAME)
  let queue: Promise<unknown> = Promise.resolve()

  /** 串行执行，保证「读-改-写」不交错。 */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task)
    // 吞掉拒绝，避免一次失败让后续任务全部短路（调用方各自拿到自己的错误）。
    queue = next.catch(() => undefined)
    return next
  }

  /**
   * 每次读盘，不做内存缓存。
   *
   * 缓存看起来省一次 IO，但会让「用户手工编辑 settings.json」永远不生效，也让
   * 损坏降级路径实际不可达（缓存命中就看不到坏文件）。设置文件很小、读频率只跟
   * `dsh_start` 同阶，直接读盘换来行为可预期。
   */
  async function load(): Promise<PersistedSettings> {
    let raw: string
    try {
      raw = await readFile(filePath, 'utf8')
    } catch (cause) {
      if (isNotFound(cause)) {
        return EMPTY_SETTINGS
      }
      // 读不动（权限、磁盘错误）：按空设置继续，但要留下可排查的痕迹。
      ctx.logger.warn(`读取桥接设置失败，按「无保存值」继续：${filePath}`)
      return EMPTY_SETTINGS
    }

    try {
      return parseSettingsDocument(JSON.parse(raw) as unknown)
    } catch {
      // 内容损坏：不覆盖原文件（保留现场），本次按「无保存值」工作。
      ctx.logger.warn(`桥接设置内容损坏，本次按「无保存值」继续：${filePath}`)
      return EMPTY_SETTINGS
    }
  }

  async function persist(state: PersistedSettings): Promise<void> {
    const directory = dirname(filePath)
    await mkdir(directory, { recursive: true })
    // 先写临时文件再 rename：进程在写一半时被杀不会留下半截 JSON。
    const temporary = `${filePath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temporary, filePath)
  }

  return {
    read(): Promise<PersistedSettings> {
      return serial(async () => load())
    },

    write(input): Promise<PersistedSettings> {
      // 「读-合并-写」全在同一个串行段里：补丁只覆盖它带来的键，其余读盘旧值。
      // 这样老版本 CLI 与只传模型/权限的调用不会清掉默认工作区，而并发的两次保存
      // 也不会互相看到对方的半成品。
      return serial(async () => {
        const previous = await load()
        const next: PersistedSettings = {
          version: SETTINGS_VERSION,
          defaults: {
            model: 'model' in input.defaults ? (input.defaults.model ?? null) : previous.defaults.model,
            permission:
              'permission' in input.defaults ? (input.defaults.permission ?? null) : previous.defaults.permission,
            workspaceId:
              'workspaceId' in input.defaults
                ? (input.defaults.workspaceId ?? null)
                : previous.defaults.workspaceId,
          },
        }
        try {
          await persist(next)
        } catch (cause) {
          throw bridgeError('internal', `写入桥接设置失败：${filePath}`, {}, cause)
        }
        return next
      })
    },
  }
}

/** 判断 `ENOENT`。 */
function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: unknown }).code === 'ENOENT'
  )
}
