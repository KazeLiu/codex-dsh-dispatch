import { stat } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

/**
 * 判断路径是不是**真实存在的普通文件**。
 *
 * 早先这里只做 `access()`：那对目录也返回成功，于是「PATH 里有个叫 node 的目录」
 * 会被当成可用的 node，随后 `execFile` 抛 EACCES，报错还指向别处。
 * `stat` + `isFile()` 才是「能当可执行文件跑」的最小事实。
 */
export async function isFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isFile()
  } catch {
    return false
  }
}

/**
 * 在 PATH 里找第一个存在的候选文件。
 *
 * PATH 里的条目可能是带引号的（Windows 上装到 `C:\Program Files\...` 时常见），
 * 直接拼路径会找不到，所以先剥一层引号。
 */
export async function findOnPath(candidates: readonly string[]): Promise<string | null> {
  const raw = process.env['PATH']
  if (raw === undefined) return null
  for (const entry of raw.split(delimiter)) {
    const dir = entry.trim().replace(/^"(.*)"$/, '$1')
    if (dir === '') continue
    for (const candidate of candidates) {
      const full = join(dir, candidate)
      if (await isFile(full)) return full
    }
  }
  return null
}
