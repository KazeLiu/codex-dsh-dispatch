import { execFile } from 'node:child_process'
import { basename, isAbsolute } from 'node:path'
import { findOnPath, isFile } from './path-scan.js'

/**
 * 解析一个**真的能跑 Node 脚本**的 node 可执行文件。
 *
 * 为什么不能直接用 `process.execPath`：本插件既能在独立 Node 里跑，也能在
 * DSH 桌面端里跑。桌面端是 Electron，此时 `process.execPath` 是 `DSH.exe`
 * ——把它登记成 Codex 的 stdio 命令，Codex 启动时会去执行一个 GUI 程序，
 * 既不会跑 `bin/codex-dsh-dispatch.mjs`，也看不出错在哪。
 *
 * 但反过来不能一律排除 `process.execPath`：独立 Node 里跑 CLI 时，那个路径
 * 就是最可靠的 node，排除掉只会逼着用户去装第二份。所以只在 Electron 宿主
 * 里排除自身。
 *
 * 刻意**不使用** `ELECTRON_RUN_AS_NODE`：那要求启动方额外设环境变量，而
 * Codex 写进配置的只是一条命令，环境变量不会跟着走。
 */

export interface NodeRuntime {
  readonly path: string
  /** 来源：进程自身 / 用户配置 / PATH。 */
  readonly source: 'process' | 'configured' | 'path'
  /** `node --version` 的原始输出，形如 `v22.19.0`；探测失败为 null。 */
  readonly version: string | null
}

export type NodeRuntimeResult =
  | { readonly ok: true; readonly runtime: NodeRuntime }
  | { readonly ok: false; readonly message: string }

const WINDOWS_CANDIDATES = ['node.exe', 'node'] as const
const POSIX_CANDIDATES = ['node'] as const

/** 只接受 `vX.Y.Z` 形态，避免把任意可执行文件的输出当成 node 版本。 */
const VERSION_PATTERN = /^v(\d+)\.(\d+)\.(\d+)/

/** 与 `package.json` 的 `engines.node`（`^22.19.0 || >=24.9.0`）保持一致。 */
const SUPPORTED_RANGE_TEXT = '22.19 以上（22.x）或 24.9 以上'

function execVersion(command: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile(command, ['--version'], { windowsHide: true, timeout: 5_000, encoding: 'utf8' }, (error, stdout) => {
      if (error !== null) {
        resolve(null)
        return
      }
      const text = stdout.trim()
      resolve(VERSION_PATTERN.test(text) ? text : null)
    })
  })
}

/**
 * 版本是否落在 `^22.19.0 || >=24.9.0` 里。
 *
 * 不支持的版本必须报出来：登记一个跑不起来的 node，用户只会看到 Codex 那边
 * 莫名其妙的启动失败，而设置页还显示「已连接」。
 */
function isSupportedVersion(version: string): boolean {
  const matched = VERSION_PATTERN.exec(version)
  if (matched === null) return false
  const major = Number(matched[1])
  const minor = Number(matched[2])
  if (major === 22) return minor >= 19
  if (major === 23) return false
  if (major === 24) return minor >= 9
  return major >= 25
}

/**
 * 按文件名判断是不是桌面端自己的可执行文件。
 *
 * Electron 下 `process.versions.electron` 有值，`process.execPath` 一定是
 * 桌面端程序；这里再按文件名兜底，防止某些打包方式抹掉 electron 版本字段。
 */
function isHostBinaryName(path: string): boolean {
  const name = basename(path).toLowerCase()
  return name === 'dsh' || name === 'dsh.exe' || name.startsWith('dsh next')
}

/** 进程自身能否当 node 用。只在 Electron 宿主里排除自身。 */
function processRuntime(): NodeRuntime | null {
  if (process.versions['electron'] !== undefined) return null
  if (isHostBinaryName(process.execPath)) return null
  if (!isSupportedVersion(process.version)) return null
  return { path: process.execPath, source: 'process', version: process.version }
}

/**
 * 解析可用的 node。
 *
 * `configured` 是用户在设置页里填的绝对路径，优先级最高——PATH 里同时装了
 * 多个 node 时，用户能指定到底用哪个。填了但不可用时**不静默回退**，直接
 * 报错，否则用户会以为自己选的生效了。
 */
export async function resolveNodeRuntime(configured?: string | null): Promise<NodeRuntimeResult> {
  const wanted = configured?.trim()
  if (wanted !== undefined && wanted !== '') {
    // 相对路径不能写进 Codex 配置：Codex 的工作目录是项目目录，不是这里。
    if (!isAbsolute(wanted)) {
      return { ok: false, message: `Node 路径必须是绝对路径：${wanted}` }
    }
    if (!(await isFile(wanted))) {
      return { ok: false, message: `指定的 Node 路径不存在或不是文件：${wanted}` }
    }
    const version = await execVersion(wanted)
    if (version === null) {
      return { ok: false, message: `指定的路径不是可用的 Node：${wanted}（执行 --version 没有得到版本号）` }
    }
    if (!isSupportedVersion(version)) {
      return {
        ok: false,
        message: `指定的 Node 版本不受支持：${wanted}（${version}）。本插件要求 Node ${SUPPORTED_RANGE_TEXT}。`,
      }
    }
    return { ok: true, runtime: { path: wanted, source: 'configured', version } }
  }

  const self = processRuntime()
  if (self !== null) return { ok: true, runtime: self }

  const candidates = process.platform === 'win32' ? WINDOWS_CANDIDATES : POSIX_CANDIDATES
  const found = await findOnPath(candidates)
  if (found !== null) {
    const version = await execVersion(found)
    if (version !== null && isSupportedVersion(version)) {
      return { ok: true, runtime: { path: found, source: 'path', version } }
    }
    if (version !== null) {
      return {
        ok: false,
        message: `PATH 里的 Node 版本不受支持：${found}（${version}）。本插件要求 Node ${SUPPORTED_RANGE_TEXT}。`,
      }
    }
  }

  return {
    ok: false,
    message:
      '找不到可用的 Node。当前 DSH 运行在桌面端，它自己的可执行文件不能当 Node 用；' +
      `请安装 Node.js（${SUPPORTED_RANGE_TEXT}），或在下方填写 node 可执行文件的绝对路径。`,
  }
}
