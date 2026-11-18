/**
 * Codex 接入配置端口：读写「用户指定的 node 路径」。
 *
 * 为什么单独成端口而不是复用 `SettingsPort`：两者的数据是两回事（见
 * `domain/codex-config.ts` 的注释），且设置页的「还原」只该丢桥接默认值的草稿，
 * 不该顺手把用户填的 node 路径也清掉。
 *
 * 注意：本层只允许类型声明（依赖规则 D3）。
 */

import type { CodexConfig } from '../domain/codex-config.js'

export interface CodexConfigPort {
  read(): Promise<CodexConfig>
  write(config: CodexConfig): Promise<CodexConfig>
}
