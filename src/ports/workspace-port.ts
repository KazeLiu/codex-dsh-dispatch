/**
 * 工作区端口：把「一个绝对路径」变成一个可挂会话的工作区。
 *
 * 为什么单独成端口：工作区注册是宿主侧副作用（会写 `workspace.json`），
 * 而领域层只关心「规范化后的路径」和「工作区标识」这两个值。
 *
 * 注意：本层只允许类型声明（依赖规则 D3），错误类型放在 `domain/errors.ts`。
 */

import type { WorkspaceSummary } from '../domain/workspace.js'

export type { WorkspaceSummary }

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

  /**
   * 列出已注册工作区。
   *
   * 设置页用它渲染「无项目默认工作区」的候选项：保存的是工作区 ID，所以这里
   * 给出的 `id` 必须是宿主认可的稳定标识，不能拿路径顶替。
   *
   * 只读、不创建：没有工作区返回空数组，读不到时返回 null。
   */
  listWorkspaces(): Promise<readonly WorkspaceSummary[] | null>

  /**
   * 按工作区 ID 找回已登记的工作区，不创建、不重建。
   *
   * `dsh_start` 省略 cwd 时用它：保存的是 ID，就必须用 ID 去宿主里查当前事实
   * （标题和路径都可能被用户改过），而不是拿保存时的路径去 `ensureWorkspace`
   * ——那会在工作区被删掉后悄悄重建一个同路径的新工作区。
   */
  resolveWorkspace(id: string): Promise<EnsureWorkspaceResult | null>
}
