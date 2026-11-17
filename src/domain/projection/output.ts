/**
 * 输出投影：把宿主事件裁剪成客户端可读的增量文本。
 *
 * 三条硬约束（docs/ARCHITECTURE.md §5.5 / REVIEW R2）：
 * 1. 只投影 `assistant/message` 的 **text 块**，跳过 reasoning 块——推理内容不进返回体。
 * 2. 工具调用只给「名字 + 参数预览」，工具结果只给「是否报错」，不回传完整输出。
 * 3. 条数与字节双上限，任一触发都必须如实置 `truncated: true`。
 */

import type { OutputRecord } from '../types.js'

/** 单条工具参数预览的字符上限。 */
export const ARGUMENTS_PREVIEW_LIMIT = 200

/** 整个返回体里文本总量的字符上限。 */
export const TOTAL_TEXT_LIMIT = 16000

/** 宿主事件的最小结构（只声明投影用到的字段）。 */
export interface ProjectableEvent {
  readonly type: string
  readonly seq: number
  readonly data: unknown
}

/** 投影选项。 */
export interface ProjectOptions {
  /** 最多保留多少条记录（与宿主 `maxMessages` 同量级）。 */
  readonly maxRecords: number
  /** 文本总字符上限。 */
  readonly totalTextLimit?: number
}

/** 投影结果。 */
export interface ProjectResult {
  readonly records: readonly OutputRecord[]
  readonly truncated: boolean
}

/** 安全取对象字段。 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/**
 * 从 `assistant/message` 事件里抽出纯文本。
 *
 * 只拼接 `type === 'text'` 的块；`reasoning` 块即使存在也被丢弃。
 */
function assistantText(data: unknown): string | null {
  const payload = asRecord(data)
  const message = asRecord(payload?.['message'])
  const content = message?.['content']
  if (!Array.isArray(content)) return null

  const parts: string[] = []
  for (const block of content) {
    const item = asRecord(block)
    if (item === null) continue
    if (item['type'] !== 'text') continue
    const text = item['text']
    if (typeof text === 'string' && text.length > 0) parts.push(text)
  }
  return parts.length === 0 ? null : parts.join('\n')
}

/** 截断参数预览，超长时追加省略标记。 */
function previewArguments(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= ARGUMENTS_PREVIEW_LIMIT) return collapsed
  return `${collapsed.slice(0, ARGUMENTS_PREVIEW_LIMIT)}…`
}

/** 把单条事件投影成零或一条记录。 */
function projectEvent(event: ProjectableEvent): OutputRecord | null {
  switch (event.type) {
    case 'assistant/message': {
      const text = assistantText(event.data)
      return text === null ? null : { kind: 'assistant', seq: event.seq, text }
    }
    case 'tool/call': {
      const payload = asRecord(event.data)
      const name = payload?.['name']
      if (typeof name !== 'string') return null
      return {
        kind: 'tool-call',
        seq: event.seq,
        name,
        argumentsPreview: previewArguments(payload?.['arguments']),
      }
    }
    case 'tool/result': {
      const payload = asRecord(event.data)
      const message = asRecord(payload?.['message'])
      // 结果消息缺失时按「未报错」处理：宁可少报一个错误标记，也不编造。
      const isError = message?.['isError'] === true
      return { kind: 'tool-result', seq: event.seq, isError }
    }
    default:
      return null
  }
}

/**
 * 投影一批事件。
 *
 * 输入顺序由调用方保证为**时间正序**（宿主返回的是新→旧，翻转由适配层完成，
 * 这样 domain 层不必知道宿主的倒序约定）。
 *
 * 裁剪策略：从**最新**的记录往回累加，超过条数或字符上限就停止并置
 * `truncated`。这样客户端拿到的永远是「最近发生了什么」，而不是开头一段。
 */
export function projectOutput(
  events: readonly ProjectableEvent[],
  options: ProjectOptions,
): ProjectResult {
  const totalTextLimit = options.totalTextLimit ?? TOTAL_TEXT_LIMIT
  const maxRecords = Math.max(0, options.maxRecords)

  const kept: OutputRecord[] = []
  let textBudget = totalTextLimit
  let truncated = false

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    const record = projectEvent(event)
    if (record === null) continue

    if (kept.length >= maxRecords) {
      truncated = true
      break
    }

    if (record.kind === 'assistant') {
      if (record.text.length > textBudget) {
        // 字符预算不足：保留能放下的部分并标记截断，避免整条丢失。
        if (textBudget > 0) {
          kept.push({ ...record, text: record.text.slice(0, textBudget) })
          textBudget = 0
        }
        truncated = true
        break
      }
      textBudget -= record.text.length
    }

    kept.push(record)
  }

  // 累加时是「新→旧」，输出前翻回时间正序。
  kept.reverse()
  return { records: kept, truncated }
}
