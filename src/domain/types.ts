/**
 * 桥接领域类型：只描述桥接自身的语义，不依赖任何宿主（DSH）类型。
 */

/** 任务六态。`cancelled` 只在观察到会话真正停止后才出现。 */
export type TaskStatus =
  | 'accepted'
  | 'running'
  | 'needs_input'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** 桥接三档权限语义值；它不是可直接写入 DSH 的预设 ID。 */
export type PermissionLevel = 'ask' | 'auto' | 'full'

/**
 * 权限值来源，用于回显「实际生效配置与来源」。
 * `source-session` 指源会话带来的值，`bridge-default` 指桥接保存的默认值，
 * `initial` 指初始值（`ask`），`unknown` 指当前无法读到实际生效值。
 *
 * 注意：**三层顺序保证 `unknown` 不会因「解析失败」产生**——源会话 → 桥接默认
 * → 初始值 `ask` 总有值，来源随之确定；「读不到实际预设」只影响
 * `PermissionView.presetId`，不影响 `source`。`unknown` 只在「连档位都无法确定」
 * 时出现（`dsh_send` 对从未记录过源权限的会话回显），另为第 2 阶段回读失败预留；
 * `source` 是开放枚举（可新增，不可改名或删除）。
 *
 * `bridge-default` 自设置持久化接入后**会**产生：`start-task.ts` 把
 * `settings.json` 里保存的默认权限作为第二层传入 `resolvePermissionChoice`。
 */
export type PermissionSource = 'source-session' | 'bridge-default' | 'initial' | 'unknown'

/**
 * 模型选择来源。`dsh-default` 指 DSH 的全局默认设置（不是会话级默认），
 * `unknown` 指当前无法读到实际生效值。
 *
 * 与 `PermissionSource.unknown` 不同：这里的 `unknown` **真的会产生**
 * ——模型目录读不到时连 `provider` / `model` 都不知道，整个视图退化为
 * `{ provider: null, model: null, source: 'unknown' }`。
 *
 * `bridge-default` 自设置持久化接入后**会**产生：`start-task.ts` 把
 * `settings.json` 里保存的默认模型作为第二层传入 `resolveModelChoice`。
 */
export type ModelSource = 'request' | 'bridge-default' | 'dsh-default' | 'unknown'

export interface ModelView {
  readonly provider: string | null
  readonly model: string | null
  readonly reasoningEffort: string | null
  readonly source: ModelSource
}

export interface PermissionView {
  /**
   * 桥接语义值；读不到实际生效值时为 `unknown`。
   * 三层解析保证新建会话时恒为具体档位，`unknown` 只在「从未记录过源权限」
   * （`dsh_send` 的早期请求）或第 2 阶段回读失败时出现——调用方不必为它写
   * 分支，但也不要假设它不可能出现。
   */
  readonly level: PermissionLevel | 'unknown'
  /** DSH 预设 ID；读不到时为 `null`，不得用 `level` 反推猜测值。 */
  readonly presetId: string | null
  readonly source: PermissionSource
}

/** 一次任务在桥接侧的可回显快照。 */
export interface TaskView {
  readonly sessionId: string
  readonly workspaceId: string
  readonly cwd: string
  readonly requestId: string
  readonly status: TaskStatus
  /** 输出游标：下一次 `dsh_wait` 应回传的值。 */
  readonly cursor: number
  /** 归属回合号；尚未出现对应回合时为 `null`。 */
  readonly turn: number | null
  readonly permission: PermissionView
  readonly model: ModelView
}

/** 保存的模型默认值（来自设置）。 */
export interface SavedModel {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** 请求里可选的模型选择；provider 与 model 必须成对出现。 */
export interface RequestedModel {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
}

/** 会话待处理输入类别（与宿主 `SessionPendingInput` 同义）。 */
export type PendingInputKind = 'approval' | 'question' | 'other'

/** 一次会话状态快照，已抹平宿主细节。 */
export interface SessionSnapshot {
  /** 会话事件游标；桥接只做透传，不解释其内部含义。 */
  readonly cursor: number
  /** 会话是否仍处于可交互状态（未归档、未卸载）。 */
  readonly active: boolean
  /** 是否正在执行回合。 */
  readonly running: boolean
  readonly pendingInput: readonly PendingInputKind[]
  /** 开放回合的 `turn/start` 事件 seq；回合之间为 `null`。 */
  readonly openTurnStartSeq: number | null
  /** 最近一次 `turn/start` 的回合号；首个回合之前为 0。 */
  readonly lastTurn: number
}

/** 等待结果原因，直接映射宿主 `SessionWaitValue.reason`。 */
export type WaitReason = 'idle' | 'input-required' | 'timeout'

/** 输出投影的输入记录：宿主事件已在此层被裁剪成桥接语义。 */
export type OutputRecord =
  | { readonly kind: 'assistant'; readonly seq: number; readonly text: string }
  | {
      readonly kind: 'tool-call'
      readonly seq: number
      readonly name: string
      readonly argumentsPreview: string
    }
  | { readonly kind: 'tool-result'; readonly seq: number; readonly isError: boolean }

export interface WaitOutcome {
  readonly reason: WaitReason
  readonly state: SessionSnapshot
  /** 宿主按「新→旧」返回，投影层负责翻转与裁剪。 */
  readonly records: readonly OutputRecord[]
  /** 宿主侧是否因条数上限发生了截断。 */
  readonly truncated: boolean
}

/** 回合结束原因（与宿主 `TurnEndReasonMap` 的键同义）。 */
export type TurnEndKind =
  | 'completed'
  | 'aborted'
  | 'blocked'
  | 'error'
  | 'max-tokens'
  | 'interrupted'
  | 'forked'

export interface TurnEndInfo {
  readonly turn: number
  readonly kind: TurnEndKind
}

/** 游标之后的回合进展：已开始的最大回合号与全部回合结束事件。 */
export interface TurnProgress {
  readonly startedTurn: number | null
  /**
   * 游标之后观察到的全部 `turn/end`。
   *
   * 为什么是数组而不是单个：`mode: 'queue'` 下会话可能连跑多个回合，
   * 「最新一条结束事件」未必属于本请求对应的回合，必须按回合号精确匹配。
   */
  readonly ends: readonly TurnEndInfo[]
  /**
   * 观察窗口是否被截断（宿主历史分页翻到页数上限仍未覆盖到提交点）。
   *
   * 为 `true` 时**不能**据此判定「回合缺失」：我们只是没看到，不是确认没发生。
   * 误报 `failed` 比多等一轮更伤——客户端会放弃一个其实还在跑的任务。
   */
  readonly truncated: boolean
}
