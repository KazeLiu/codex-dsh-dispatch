/**
 * 工具定义的类型契约。
 *
 * 单独成文件是为了让四个工具模块与注册表共享同一份类型，而不互相 import
 * （避免循环依赖：注册表 import 各工具，各工具 import 类型）。
 */

import type { AppDeps } from '../../app/deps.js'

/** 单个 MCP 工具的完整定义。 */
export interface ToolDefinition {
  /** 工具名，对外暴露；改动会破坏客户端契约。 */
  readonly name: string
  /** 人类可读标题。 */
  readonly title: string
  /** 工具说明：告诉模型什么时候该用它。 */
  readonly description: string
  /** 入参 JSON Schema。 */
  readonly inputSchema: Readonly<Record<string, unknown>>
  /**
   * 执行工具；抛出的错误由分派器统一映射为 `isError` 或 `-32602`。
   *
   * `signal` 在客户端断开时触发，**只用于中断本次等待**，绝不能拿它去取消
   * 会话执行（取消只能由 `dsh_cancel` 显式发起，见第 8 节）。
   */
  readonly run: (
    deps: AppDeps,
    args: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ) => Promise<unknown>
}
