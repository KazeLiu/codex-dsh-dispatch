/**
 * 工具注册表：本插件对外暴露的四个 MCP 工具。
 *
 * 新增工具只需在这里登记一条，分派器不需要改动（docs/ARCHITECTURE.md 第 9 节）。
 */

import { CANCEL_TOOL } from './dsh-cancel.js'
import { SEND_TOOL } from './dsh-send.js'
import { START_TOOL } from './dsh-start.js'
import { WAIT_TOOL } from './dsh-wait.js'
import type { ToolDefinition } from './types.js'

export type { ToolDefinition } from './types.js'

/** 全部工具，按对外顺序排列。 */
export const TOOLS: readonly ToolDefinition[] = [START_TOOL, WAIT_TOOL, SEND_TOOL, CANCEL_TOOL]

/** 按名字查工具；找不到返回 `undefined`，由分派器转 `-32602`。 */
export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name)
}
