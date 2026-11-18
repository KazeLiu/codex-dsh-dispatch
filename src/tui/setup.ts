import { confirm, select } from '@inquirer/prompts'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { readConnection } from '../connection.js'
import { CodexCliError } from '../codex/codex-cli.js'
import {
  AgentsFileError,
  blockPresent,
  detectEol,
  overrideExists,
  readAgentsFile,
  removeBlock,
  renderBlock,
  resolveAgentsTarget,
  upsertBlock,
  writeAgentsFile,
  type AgentsScope,
  type AgentsTarget,
} from '../codex/agents-file.js'
import { fetchSettings, readClientConfig, SettingsClientError } from './client.js'
import { COLLABORATION_PROMPT } from '../codex/collaboration-prompt.js'
import { printModels, runConfigTui } from './main.js'
import { resolveNodeRuntime } from '../codex/node-runtime.js'
import {
  DISABLED_HINT,
  SERVER_NAME,
  describeCurrent,
  inspectRegistration,
  isDisabled,
  register,
  resolveBinPath,
  unregister,
  type RegistrationState,
} from '../codex/mcp-registration.js'

/**
 * 首次接入向导。
 *
 * 这个界面刻意不依赖 DSH 在线：MCP 登记与提示词写入都只碰本机的
 * Codex 配置和 AGENTS.md，DSH 没启动也能先配好，等 DSH 起来即可用。
 * 只有「默认设置」和「模型列表」两项需要从桥接服务读实时数据。
 */

const PACKAGE_JSON = new URL('../../package.json', import.meta.url)

async function readVersion(): Promise<string> {
  try {
    const raw = JSON.parse(await readFile(PACKAGE_JSON, 'utf8')) as unknown
    if (typeof raw === 'object' && raw !== null && 'version' in raw && typeof raw.version === 'string') {
      return raw.version
    }
  } catch {
    // 版本号只用于展示，读不到就退回 unknown，不影响任何操作。
  }
  return 'unknown'
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

async function describeDsh(): Promise<string> {
  try {
    const connection = await readConnection()
    return `已发布连接信息：${connection.url}`
  } catch (cause) {
    return `未找到连接信息（DSH 可能未运行，或插件未加载）：${message(cause)}`
  }
}

async function describeRegistration(): Promise<string> {
  let state: RegistrationState
  try {
    state = await inspectRegistration()
  } catch (cause) {
    return `无法确认：${message(cause)}`
  }
  if (state.server === null) return '未登记'
  const where = describeCurrent(state.server)
  // 停用的服务器不会被加载，不能报成「已登记、可用」。
  if (isDisabled(state.server)) return `已登记但被停用，不会加载（${where}）`
  return state.matchesCurrent ? `已登记，指向当前安装位置（${where}）` : `已登记，但指向别处（${where}）`
}

async function describeAgents(scope: AgentsScope): Promise<string> {
  const target = resolveAgentsTarget(scope)
  try {
    const existing = await readAgentsFile(target.path)
    const present = blockPresent(existing, target.path)
    const override = await overrideExists(target)
    const head = present ? '已写入托管区块' : '没有托管区块'
    const tail = override ? `；同目录存在 ${basename(target.overridePath)}，它会覆盖本文件` : ''
    return `${head}：${target.path}${tail}`
  } catch (cause) {
    return `无法读取：${message(cause)}`
  }
}

/** 只读状态汇总：不写任何文件，不要求 DSH 在线。 */
export async function printStatus(): Promise<number> {
  const node = await resolveNodeRuntime()
  console.log('Codex DSH Dispatch · 状态')
  console.log(`  版本：${await readVersion()}`)
  console.log(`  当前 Node：${node.ok ? `${node.runtime.path}（${node.runtime.version ?? '版本未知'}）` : `不可用：${node.message}`}`)
  console.log(`  bin 入口：${resolveBinPath()}`)
  console.log(`  Codex MCP：${await describeRegistration()}`)
  console.log(`  AGENTS.md（全局）：${await describeAgents('global')}`)
  console.log(`  AGENTS.md（当前目录）：${await describeAgents('project')}`)
  console.log(`  DSH 连接：${await describeDsh()}`)
  return 0
}

async function openSettings(): Promise<void> {
  try {
    await runConfigTui()
  } catch (cause) {
    if (cause instanceof SettingsClientError) {
      console.log(`暂时读不到桥接服务：${cause.message}`)
      console.log('先完成 Codex 接入也可以，等 DSH 启动后再回来设置默认值。')
      return
    }
    throw cause
  }
}

async function showModels(): Promise<void> {
  try {
    printModels(await fetchSettings(readClientConfig()))
  } catch (cause) {
    if (cause instanceof SettingsClientError) {
      console.log(`暂时读不到模型列表：${cause.message}`)
      return
    }
    throw cause
  }
}

async function handleRegister(): Promise<void> {
  const state = await inspectRegistration()
  console.log(`Codex CLI：${state.invocation.description}`)
  if (state.server !== null) {
    console.log(`Codex 里已有名为 ${SERVER_NAME} 的 MCP 服务器：`)
    console.log(`  ${describeCurrent(state.server)}`)
    if (isDisabled(state.server)) {
      console.log(DISABLED_HINT)
      if (state.matchesCurrent) {
        console.log('指向是对的，只是被停用，不需要重新登记。')
        return
      }
      console.log('要换成当前安装位置，请先移除登记再重新登记。')
      return
    }
    if (state.matchesCurrent) {
      console.log('它已经指向当前安装位置，无需重复登记。')
      return
    }
    console.log('为避免覆盖现有配置，本次不做修改。要换成当前安装位置，请先移除登记再重新登记。')
    return
  }
  console.log('将登记为 Codex 的 stdio MCP 服务器：')
  console.log(`  名称：${SERVER_NAME}`)
  console.log(`  命令：${state.plan.node}`)
  console.log(`  参数：${[state.plan.bin, ...state.plan.args].join(' ')}`)
  const ok = await confirm({ message: '确认写入 Codex 的 MCP 配置？', default: true })
  if (!ok) {
    console.log('已取消，未做任何修改。')
    return
  }
  await register(state)
  console.log('已登记。重新加载 Codex 的 MCP 连接后生效，此时不需要 DSH 在线。')
}

async function handleUnregister(): Promise<void> {
  const state = await inspectRegistration()
  if (state.server === null) {
    console.log(`Codex 里没有名为 ${SERVER_NAME} 的 MCP 服务器，无需移除。`)
    return
  }
  console.log('将移除 Codex 的 MCP 服务器：')
  console.log(`  名称：${SERVER_NAME}`)
  console.log(`  当前配置：${describeCurrent(state.server)}`)
  const ok = await confirm({ message: '确认移除？其它 MCP 服务器不受影响。', default: false })
  if (!ok) {
    console.log('已取消，未做任何修改。')
    return
  }
  await unregister(state)
  console.log('已移除。')
}

async function chooseTarget(): Promise<AgentsTarget> {
  const scope = await select<AgentsScope>({
    message: '写入哪个 AGENTS.md？',
    choices: [
      {
        name: '全局（Codex 的所有项目都生效）',
        value: 'global',
        description: resolveAgentsTarget('global').path,
      },
      {
        name: '当前目录（只对这个项目生效）',
        value: 'project',
        description: resolveAgentsTarget('project').path,
      },
    ],
  })
  return resolveAgentsTarget(scope)
}

async function handlePromptWrite(): Promise<void> {
  const target = await chooseTarget()
  const existing = await readAgentsFile(target.path)
  const present = blockPresent(existing, target.path)
  const override = await overrideExists(target)
  console.log(`目标文件：${target.path}`)
  console.log(present ? '已有托管区块，将就地更新（区块外内容保持不变）。' : '将把托管区块追加到文件末尾。')
  if (override) {
    console.log(`注意：同目录存在 ${basename(target.overridePath)}，它的优先级更高。`)
    console.log('写进本文件的内容可能不会生效，除非把同样的内容也写进覆盖文件。')
  }
  const ok = await confirm({
    message: override ? '仍然写入？（内容可能被覆盖文件挡住）' : '确认写入协作提示词？',
    default: !override,
  })
  if (!ok) {
    console.log('已取消，未做任何修改。')
    return
  }
  const eol = detectEol(existing)
  const next = upsertBlock(existing, target.path, renderBlock(COLLABORATION_PROMPT, eol), eol)
  // 传入读取时的原文：确认期间文件若被改动，写入会报错而不是覆盖。
  const written = await writeAgentsFile(target.path, next, existing)
  if (!written) {
    console.log('内容已是最新，未改动文件。')
    return
  }
  if (override) {
    // 写成功了但可能不生效，必须说清楚，不能只报「已写入」。
    console.log(`已写入 ${target.path}，但同目录的 ${basename(target.overridePath)} 优先级更高，`)
    console.log('协作提示词很可能不生效。要真正生效，需要把同样的内容也写进覆盖文件，或先移除覆盖文件。')
    return
  }
  console.log('已写入。')
}

async function handlePromptRemove(): Promise<void> {
  const target = await chooseTarget()
  const existing = await readAgentsFile(target.path)
  if (existing === null) {
    console.log(`没有找到 ${target.path}，无需移除。`)
    return
  }
  if (!blockPresent(existing, target.path)) {
    console.log(`${target.path} 里没有 codex-dsh-dispatch 的托管区块，无需移除。`)
    console.log('你自己写的同名小节不会被改动。')
    return
  }
  const ok = await confirm({ message: `从 ${target.path} 移除托管区块？区块外内容保持不变。`, default: false })
  if (!ok) {
    console.log('已取消，未做任何修改。')
    return
  }
  const eol = detectEol(existing)
  const next = removeBlock(existing, target.path, eol)
  const written = await writeAgentsFile(target.path, next, existing)
  console.log(written ? '已移除。' : '未改动文件。')
}

type MenuAction =
  | 'settings'
  | 'models'
  | 'register'
  | 'unregister'
  | 'prompt-write'
  | 'prompt-remove'
  | 'status'
  | 'quit'

/** 选一项要做什么；Ctrl+C 返回 null，由调用方正常退出。 */
async function askAction(): Promise<MenuAction | null> {
  try {
    return await select<MenuAction>({
      message: '要做什么？',
      choices: [
        { name: '登记 Codex 的 MCP 连接', value: 'register', description: '让 Codex 能调用 dsh_start 等工具' },
        { name: '移除 Codex 的 MCP 连接', value: 'unregister', description: `移除名为 ${SERVER_NAME} 的条目` },
        { name: '写入协作提示词到 AGENTS.md', value: 'prompt-write', description: '显式写入，不自动注入' },
        { name: '移除 AGENTS.md 里的协作提示词', value: 'prompt-remove', description: '只删托管区块' },
        { name: '设置默认模型与权限', value: 'settings', description: '需要 DSH 正在运行' },
        { name: '查看可用模型', value: 'models', description: '需要 DSH 正在运行' },
        { name: '查看当前状态', value: 'status', description: '只读，不需要 DSH 在线' },
        { name: '退出', value: 'quit' },
      ],
    })
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'ExitPromptError') return null
    throw cause
  }
}

export async function runSetup(): Promise<number> {
  console.log('Codex DSH Dispatch · 接入向导（↑↓ 选择，Enter 确认，Ctrl+C 退出）')
  for (;;) {
    const action = await askAction()
    if (action === null) return 0
    try {
      switch (action) {
        case 'settings':
          await openSettings()
          break
        case 'models':
          await showModels()
          break
        case 'register':
          await handleRegister()
          break
        case 'unregister':
          await handleUnregister()
          break
        case 'prompt-write':
          await handlePromptWrite()
          break
        case 'prompt-remove':
          await handlePromptRemove()
          break
        case 'status':
          await printStatus()
          break
        case 'quit':
          return 0
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'ExitPromptError') return 0
      // 单项失败不结束向导：打印原因后回到菜单，用户还能继续做别的。
      if (cause instanceof CodexCliError || cause instanceof AgentsFileError) {
        console.error(cause.message)
        continue
      }
      throw cause
    }
    console.log('')
  }
}
