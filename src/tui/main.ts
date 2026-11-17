/**
 * TUI 主循环：`dsh-mcp-bridge config`。
 *
 * 交互形态刻意用**行命令**而不是 raw-mode 单键：Windows 的 `cmd`/PowerShell
 * 对 raw mode 的支持不一致（方向键序列、Ctrl 组合各不相同），而本界面只有
 * 三个下拉项与三个按钮，行命令足够，且可复制粘贴、可脚本化。
 *
 * 所有读写都走 `client.ts` 的本机认证通道——本进程不碰设置文件、不碰 DSH
 * profile、不碰会话文件（docs/DEVELOPMENT.md 第 5 节）。
 */

import { createInterface } from 'node:readline/promises'

import type { PermissionLevel } from '../domain/types.js'
import {
  fetchSettings,
  readClientConfig,
  saveSettings,
  SettingsClientError,
  type ClientConfig,
} from './client.js'
import { render } from './render.js'
import {
  applyConnectionError,
  applySnapshot,
  INITIAL_STATE,
  selectEffort,
  selectModel,
  selectPermission,
  toUpdate,
  withMessage,
  type TuiState,
} from './state.js'

/** 命令帮助。 */
const HELP = [
  '命令：',
  '  m <序号>   选择默认模型（序号见上方列表）',
  '  m -       改为「跟随 DSH 默认设置」',
  '  e <强度>   选择思考强度（e - 表示跟随模型默认）',
  '  p <档位>   选择默认权限：ask / auto / full',
  '  r          刷新列表',
  '  s          保存默认值',
  '  h          显示本帮助',
  '  q          退出',
].join('\n')

/**
 * 入口。
 *
 * 返回退出码：0 正常退出，1 连接失败（便于脚本判断）。
 */
export async function runConfigTui(config: ClientConfig = readClientConfig()): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  let state: TuiState = INITIAL_STATE
  try {
    state = await refresh(config)
  } catch (cause) {
    state = applyConnectionError(state, describe(cause))
  }

  print(state)
  process.stdout.write(`\n${HELP}\n`)

  for (;;) {
    let line: string
    try {
      line = await rl.question('\n> ')
    } catch {
      // stdin 关闭（管道输入结束）：按退出处理。
      break
    }
    const command = line.trim()
    if (command === '') continue

    if (command === 'q' || command === 'quit' || command === 'exit') break
    if (command === 'h' || command === 'help') {
      process.stdout.write(`\n${HELP}\n`)
      continue
    }

    try {
      if (command === 'r' || command === 'refresh') {
        state = await refresh(config)
      } else if (command === 's' || command === 'save') {
        state = await save(state, config)
      } else if (command.startsWith('m')) {
        state = applyModelCommand(state, command.slice(1).trim())
      } else if (command.startsWith('e')) {
        state = applyEffortCommand(state, command.slice(1).trim())
      } else if (command.startsWith('p')) {
        state = applyPermissionCommand(state, command.slice(1).trim())
      } else {
        state = withMessage(state, `未知命令：${command}（输入 h 查看帮助）`)
      }
    } catch (cause) {
      state = withMessage(state, describe(cause))
    }

    print(state)
  }

  rl.close()
  return state.connectionError === null ? 0 : 1
}

/** 重新读取快照。 */
async function refresh(config: ClientConfig): Promise<TuiState> {
  const snapshot = await fetchSettings(config)
  return applySnapshot(snapshot)
}

/**
 * 保存草稿。
 *
 * 保存成功后用服务端返回的快照重置状态：服务端可能因为「目录读不到」而
 * 放宽了校验，回显的 `saved` 才是真正落盘的内容，不能拿本地草稿当结果。
 */
async function save(state: TuiState, config: ClientConfig): Promise<TuiState> {
  if (state.snapshot === null) {
    return withMessage(state, '还没有读到设置，先刷新（r）')
  }
  const snapshot = await saveSettings(config, toUpdate(state))
  return { ...applySnapshot(snapshot), message: '已保存：新建会话立即生效，已有会话保持原设置' }
}

/** `m <序号>` / `m -`。 */
function applyModelCommand(state: TuiState, argument: string): TuiState {
  if (argument === '-') {
    return withMessage(
      { ...state, draftModel: null },
      '默认模型已改为「跟随 DSH 默认设置」（未保存，按 s 保存）',
    )
  }
  const index = Number.parseInt(argument, 10)
  if (!Number.isInteger(index) || index < 1) {
    return withMessage(state, '用法：m <序号> 或 m -')
  }
  const flat = state.snapshot?.providers.flatMap((provider) => provider.models) ?? []
  const model = flat[index - 1]
  if (model === undefined) {
    return withMessage(state, `没有序号 ${index} 的模型（共 ${flat.length} 个）`)
  }
  return withMessage(selectModel(state, model), `已选 ${model.providerId} / ${model.modelId}（未保存）`)
}

/** `e <强度>` / `e -`。 */
function applyEffortCommand(state: TuiState, argument: string): TuiState {
  if (state.draftModel === null) {
    return withMessage(state, '先选一个模型（m <序号>），再选思考强度')
  }
  const effort = argument === '-' || argument === '' ? null : argument
  if (effort !== null) {
    const available = state.snapshot?.providers
      .flatMap((provider) => provider.models)
      .find(
        (model) =>
          model.providerId === state.draftModel?.providerId && model.modelId === state.draftModel.modelId,
      )
    if (available === undefined || !available.reasoningEfforts.some((item) => item.id === effort)) {
      return withMessage(state, `当前模型不支持思考强度 "${effort}"`)
    }
  }
  return withMessage(
    selectEffort(state, effort),
    effort === null ? '思考强度已改为「跟随模型默认设置」（未保存）' : `思考强度已选 ${effort}（未保存）`,
  )
}

/** `p <档位>`。 */
function applyPermissionCommand(state: TuiState, argument: string): TuiState {
  if (argument !== 'ask' && argument !== 'auto' && argument !== 'full') {
    return withMessage(state, '用法：p ask | p auto | p full')
  }
  const level: PermissionLevel = argument
  const option = state.snapshot?.permissions.find((item) => item.level === level)
  // 不可用档位直接拒绝：允许选上再在保存时报错，用户会以为「选了但没生效」。
  if (option !== undefined && !option.available) {
    return withMessage(state, `档位 ${level} 当前不可用：${option.unavailableReason ?? '原因未知'}`)
  }
  return withMessage(selectPermission(state, level), `默认权限已改为 ${level}（未保存）`)
}

/** 打印一屏。 */
function print(state: TuiState): void {
  process.stdout.write(`\n${render(state)}\n`)
}

/** 把异常翻成一句中文。 */
function describe(cause: unknown): string {
  if (cause instanceof SettingsClientError) return cause.message
  if (cause instanceof Error) return cause.message
  return String(cause)
}
