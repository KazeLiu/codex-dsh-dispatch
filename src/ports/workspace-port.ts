/**
 * 工作区端口：把「一个绝对路径」变成一个可挂会话的工作区。
 *
 * 为什么单独成端口：工作区注册是宿主侧副作用（会写 `workspace.json`），
 * 而领域层只关心「规范化后的路径」和「工作区标识」这两个值。
 *
 * 注意：本层只允许类型声明（依赖规则 D3），错误类型放在 `domain/errors.ts`。
 */

/** 注册或复用工作区的入参。 */
export interface EnsureWorkspaceInput {
  /** 客户端给的绝对路径；未规范化。 */
  readonly cwd: string
}

/** 注册或复用工作区的结果。 */
export interface EnsureWorkspaceResult {
  readonly workspaceId: string
  /** 宿主 realpath 规范化后的绝对路径，后续所有比较都用它。 */
  readonly canonicalCwd: string
  /** 本次是否新建；`false` 表示复用既有工作区。 */
  readonly created: boolean
}

export interface WorkspacePort {
  /**
   * 注册或复用工作区。
   *
   * 同一规范化路径重复调用必须返回同一个 `workspaceId`，且**不得改动标题**。
   * 路径不存在、不是目录、或是相对路径时抛 `WorkspaceRejectedError`。
   */
  ensureWorkspace(input: EnsureWorkspaceInput): Promise<EnsureWorkspaceResult>
}
