/**
 * 串行占用判定。
 *
 * 设计取舍：不维护锁表。锁表在插件重载、进程崩溃、或用户在 DSH 界面里手动
 * 取消任务之后都会与真实状态脱节，而脱节的锁会永久占住一个工作目录。
 * 因此占用完全由「投影」推导：某目录被占用 ⟺ 该目录下存在本插件创建、
 * 且当前 `running === true` 的会话。
 */

/** 一条占用候选：本插件记录的会话 + 它当前的运行状态。 */
export interface OccupancyCandidate {
  readonly sessionId: string
  readonly canonicalCwd: string
  /** 该会话当前是否正在执行回合。 */
  readonly running: boolean
  /** 该会话最近一次提交的请求 ID，用于在冲突回执里定位。 */
  readonly lastRequestId: string | null
}

/** 占用冲突信息。 */
export interface OccupancyConflict {
  readonly sessionId: string
  readonly requestId: string | null
  readonly cwd: string
}

/**
 * 找出占用指定目录的会话。
 *
 * 返回 `null` 表示目录空闲。多个会话同时 running 属于异常状态（正常流程下
 * 不可能发生），此时返回第一个命中的，宁可误报占用也不要放行并发写入。
 */
export function findOccupant(
  canonicalCwd: string,
  candidates: readonly OccupancyCandidate[],
): OccupancyConflict | null {
  for (const candidate of candidates) {
    if (!candidate.running) continue
    if (candidate.canonicalCwd !== canonicalCwd) continue
    return {
      sessionId: candidate.sessionId,
      requestId: candidate.lastRequestId,
      cwd: canonicalCwd,
    }
  }
  return null
}
