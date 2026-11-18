import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { resolveCodexHome } from './codex-home.js'

/**
 * AGENTS.md 的托管区块读写。
 *
 * 只碰自己那一对标记之间的内容：区块外的一切（包括用户自己写的同名小节）
 * 原样保留。标记不配对时直接报错、不写盘——宁可失败，也不能猜着覆盖。
 */

export const BLOCK_BEGIN = '<!-- codex-dsh-dispatch begin -->'
export const BLOCK_END = '<!-- codex-dsh-dispatch end -->'

export type AgentsScope = 'global' | 'project'

export interface AgentsTarget {
  /** 实际写入的文件。 */
  readonly path: string
  /** 同目录下优先级更高的覆盖文件（存在时本文件的内容不会生效）。 */
  readonly overridePath: string
  readonly scope: AgentsScope
}

export class AgentsFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentsFileError'
  }
}

/** 全局位置遵循 Codex 自己的约定：`CODEX_HOME` 优先，缺省 `~/.codex`。 */
export function resolveAgentsTarget(scope: AgentsScope, cwd = process.cwd()): AgentsTarget {
  if (scope === 'project') {
    const dir = resolve(cwd)
    return { path: join(dir, 'AGENTS.md'), overridePath: join(dir, 'AGENTS.override.md'), scope }
  }
  const dir = resolveCodexHome()
  return { path: join(dir, 'AGENTS.md'), overridePath: join(dir, 'AGENTS.override.md'), scope }
}

/** 读现有内容；文件不存在返回 null（与「读取失败」区分开）。 */
export async function readAgentsFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (cause) {
    if (cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') return null
    throw new AgentsFileError(`无法读取 ${path}：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

export async function overrideExists(target: AgentsTarget): Promise<boolean> {
  try {
    return (await readFile(target.overridePath, 'utf8')).trim() !== ''
  } catch (cause) {
    if (cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') return false
    throw new AgentsFileError(`无法读取 ${target.overridePath}：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

interface BlockRange {
  readonly start: number
  readonly end: number
}

/** 定位托管区块；标记缺失返回 null，标记异常抛错。 */
function findBlock(text: string, path: string): BlockRange | null {
  const beginCount = text.split(BLOCK_BEGIN).length - 1
  const endCount = text.split(BLOCK_END).length - 1
  if (beginCount === 0 && endCount === 0) return null
  if (beginCount !== 1 || endCount !== 1) {
    throw new AgentsFileError(
      `${path} 里 codex-dsh-dispatch 的托管标记不完整（开始 ${beginCount} 个、结束 ${endCount} 个）。\n` +
        '为避免覆盖你的内容，本次不做任何修改；请手动修复成一对后重试。',
    )
  }
  const start = text.indexOf(BLOCK_BEGIN)
  const end = text.indexOf(BLOCK_END)
  if (end < start) {
    throw new AgentsFileError(
      `${path} 里 codex-dsh-dispatch 的结束标记出现在开始标记之前。\n` +
        '为避免覆盖你的内容，本次不做任何修改；请手动修复成一对后重试。',
    )
  }
  return { start, end: end + BLOCK_END.length }
}

/** 判断文件用的是 CRLF 还是 LF；新建文件按 LF。 */
export function detectEol(text: string | null): string {
  return text !== null && text.includes('\r\n') ? '\r\n' : '\n'
}

/** 生成托管区块；内部换行跟随目标文件的 EOL，避免把 CRLF 文件写成混合换行。 */
export function renderBlock(promptBody: string, eol = '\n'): string {
  const body = promptBody.trim().replace(/\r?\n/g, eol)
  return `${BLOCK_BEGIN}${eol}${body}${eol}${BLOCK_END}`
}

/**
 * 幂等写入：已有区块就地替换，没有就追加到文件末尾。
 *
 * 追加时在区块前补一个 EOL 作为分隔（原文已以 EOL 结尾时再补一个空行），
 * `removeBlock` 会把这一个 EOL 原样收走，因此「写入 → 删除」不会让空行越积越多。
 */
export function upsertBlock(existing: string | null, path: string, block: string, eol = detectEol(existing)): string {
  if (existing === null || existing === '') return `${block}${eol}`
  const range = findBlock(existing, path)
  if (range === null) return `${existing}${eol}${block}${eol}`
  const before = existing.slice(0, range.start)
  const after = existing.slice(range.end)
  return `${before}${block}${after}`
}

/** 幂等删除：只删自己的区块，其余内容与换行保持不变。 */
export function removeBlock(existing: string, path: string, eol = detectEol(existing)): string {
  const range = findBlock(existing, path)
  if (range === null) return existing
  const before = existing.slice(0, range.start)
  const after = existing.slice(range.end)
  if (before === '') {
    if (after === eol) return ''
    // 区块在文件开头：收掉追加时补的分隔 EOL，避免文件以空行开头。
    return after.startsWith(eol) ? after.slice(eol.length) : after
  }
  if (after === eol) {
    // 区块在文件末尾：连同追加时补的那个分隔 EOL 一起收掉。
    return before.endsWith(eol) ? before.slice(0, before.length - eol.length) : before
  }
  if (before.endsWith(eol) && after.startsWith(eol)) return `${before}${after.slice(eol.length)}`
  return `${before}${after}`
}

export function blockPresent(existing: string | null, path: string): boolean {
  if (existing === null) return false
  return findBlock(existing, path) !== null
}

/**
 * 写盘。内容未变化时不写，避免无意义的修改时间抖动。
 *
 * `expected` 是调用方计算新内容时读到的原文（不存在传 null）。写之前重新读一次并比对，
 * 不一致说明用户在确认期间动过这个文件，此时报错退出而不是覆盖掉他的改动。
 */
export async function writeAgentsFile(path: string, text: string, expected?: string | null): Promise<boolean> {
  const current = await readAgentsFile(path)
  if (expected !== undefined && current !== expected) {
    throw new AgentsFileError(
      `${path} 在你确认期间被修改过，为避免覆盖你的改动，本次不写入。\n` +
        '请重新执行这一步，基于最新内容再确认一次。',
    )
  }
  if (current === text) return false
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text, 'utf8')
    return true
  } catch (cause) {
    throw new AgentsFileError(`无法写入 ${path}：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
