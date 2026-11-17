/**
 * 会话归属登记端口。
 *
 * 桥接只操作「本插件创建的会话」，而宿主不提供「这个会话是谁建的」查询，
 * 因此归属关系必须自己记。记的只有定位与最近一次请求的元数据，
 * 不复制会话内容、不缓存状态机、不存模型密钥（见 ARCHITECTURE 第 7 节）。
 *
 * 注意：本层只允许类型声明（依赖规则 D3）。
 */

import type { PermissionLevel } from '../domain/types.js'

export interface RequestRecord {
  readonly kind: 'start' | 'text' | 'reply'
  readonly fingerprint: string
  readonly baselineTurn: number
  readonly baselineCursor: number
  readonly phase: 'prepared' | 'accepted'
  readonly callId?: string
}

/** 一条会话归属记录。 */
export interface SessionRecord {
  readonly sessionId: string
  readonly workspaceId: string
  /** 规范化后的绝对路径，串行占用按它判定。 */
  readonly canonicalCwd: string
  /** 最近一次提交的请求 ID，用于占用冲突时回显「谁在跑」。 */
  readonly lastRequestId: string
  /**
   * 最近一次从源取得的权限值。
   *
   * 只用于「源权限是否真的变了」的比较（DEVELOPMENT.md 第 6 节：
   * `dsh_send` 不重复应用默认权限，仅当源权限值变化时才同步一次）。
   */
  readonly lastSourcePermission: PermissionLevel | null
  /**
   * 最近一次提交前读到的 `lastTurn`（即回合归属的 T0）。
   *
   * 必须持久化：回合归属的判定式是「对应回合 = T0 + 1」，而 `dsh_wait`
   * 与 `dsh_cancel` 都是**后续独立请求**，不持久化就只能在重载后重新猜 T0，
   * 那会把别的回合算成本请求的（REVIEW.md 风险 R5）。
   */
  readonly baselineTurn: number
  /**
   * 最近一次提交前读到的会话游标。
   *
   * 读回合进展时从它开始翻历史，保证本请求的 `turn/start` 一定在范围内；
   * 若改用客户端回传的 `cursor`，该回合开始得早于首次 `dsh_wait` 时就会漏掉。
   */
  readonly baselineCursor: number
  readonly requests?: Readonly<Record<string, RequestRecord>>
}

/** 登记表读写。 */
export interface SessionRegistryPort {
  list(): Promise<readonly SessionRecord[]>
  /** 未登记返回 `null`（调用方据此报 `session-not-found`）。 */
  get(sessionId: string): Promise<SessionRecord | null>
  upsert(record: SessionRecord): Promise<void>
}
