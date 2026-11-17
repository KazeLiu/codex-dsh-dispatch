/**
 * 设置端口：读写桥接保存的默认模型与默认权限。
 *
 * 为什么单独一个端口而不是塞进 `registry`：两者生命周期不同。登记表是
 * **运行期会话事实**（哪个会话归哪个 cwd、基线回合是多少），丢了只影响占用
 * 判定与回合归属；设置是**用户偏好**，丢了会让下一次任务悄悄退回 DSH 默认，
 * 属于行为变化。分开存也避免一次损坏互相牵连。
 *
 * 注意：本层只允许类型声明（依赖规则 D3）。
 */

import type { PersistedSettings, SettingsDefaults } from '../domain/settings.js'

export interface ReadSettingsInput {
  /** 预留：当前只有一份全局设置，无按工作区区分。 */
  readonly scope?: 'global'
}

export interface WriteSettingsInput {
  readonly defaults: SettingsDefaults
}

export interface SettingsPort {
  /**
   * 读保存的默认值。
   *
   * **读失败不抛错**：返回空设置并让调用方按「无保存值」继续。理由：设置文件
   * 损坏不应该让整个桥接不可用，而「无保存值」正是三层解析里合法的第二层
   * 缺失状态（退到 DSH 默认）。
   */
  read(input: ReadSettingsInput): Promise<PersistedSettings>

  /** 写保存的默认值；写失败抛错（用户主动操作，不能假装成功）。 */
  write(input: WriteSettingsInput): Promise<PersistedSettings>
}
