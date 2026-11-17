#!/usr/bin/env node
/**
 * `codex-dsh-dispatch` 命令行入口。
 *
 * 只做一件事：把子命令转给 `lib/` 里的实现。刻意保持零依赖、零构建——
 * 它是发布产物里的启动脚本，不能假设用户装了 TypeScript。
 *
 * 不带参数直接运行会打开接入向导。向导本身不依赖 DSH 在线：登记 Codex 的
 * MCP 连接、写入协作提示词都只碰本机 Codex 配置与 AGENTS.md。
 *
 * 用法：
 *   codex-dsh-dispatch            打开接入向导
 *   codex-dsh-dispatch setup      同上（显式写法）
 *   codex-dsh-dispatch status     只读查看登记与连接状态
 *   codex-dsh-dispatch config     打开默认值设置界面
 *   codex-dsh-dispatch --help     显示帮助
 */

const HELP = `用法：codex-dsh-dispatch <命令>

命令：
  （无参数）  打开接入向导：登记 Codex MCP、写入协作提示词、设置默认值
  setup      同「无参数」，显式写法
  status     只读查看 MCP 登记、AGENTS.md 与 DSH 连接状态，不需要 DSH 在线
  config     打开默认模型 / 思考强度 / 默认权限的下拉设置界面
  models     显示 DSH 当前模型和支持的思考强度
  mcp        为 Codex 提供 stdio MCP 接入（由 Codex 调用，不手动运行）

环境变量：
  默认自动发现本机插件并读取专用认证信息，无需手动填写端口或凭据。
  CODEX_DSH_DISPATCH_URL / CODEX_DSH_DISPATCH_TOKEN 可用于显式覆盖设置客户端连接。

说明：
  向导与 config 都是插件的**配置客户端**：它们通过本机认证通道读写插件服务，
  并调用 Codex 官方 CLI 登记 MCP，不直接改写 DSH profile、Codex 的 TOML 或会话文件。
  不会在安装、插件加载或向导之外静默改动任何配置。`

/** 动态 import lib/：未构建时给出可操作的提示，而不是一句 ERR_MODULE_NOT_FOUND。 */
async function load(relative) {
  try {
    return await import(relative)
  } catch (cause) {
    process.stderr.write(
      `无法加载 ${relative}：${cause instanceof Error ? cause.message : String(cause)}\n` +
        '请先在包目录执行 npm run build（从 npm 安装的预构建包不需要这一步）。\n',
    )
    return null
  }
}

async function main(argv) {
  const [command, ...rest] = argv

  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${HELP}\n`)
    return 0
  }

  if (command === 'mcp') {
    const proxy = await load('../lib/tui/proxy.js')
    if (proxy === null) return 1
    await proxy.runMcpProxy()
    return 0
  }

  if (command === 'models') {
    const client = await load('../lib/tui/client.js')
    if (client === null) return 1
    const main = await load('../lib/tui/main.js')
    if (main === null) return 1
    main.printModels(await client.fetchSettings(client.readClientConfig()))
    return 0
  }

  if (command === 'status') {
    const setup = await load('../lib/tui/setup.js')
    if (setup === null) return 1
    return await setup.printStatus()
  }

  const known = command === undefined || command === 'setup' || command === 'config'
  if (!known) {
    process.stderr.write(`未知命令：${command}\n\n${HELP}\n`)
    return 2
  }
  if (rest.length > 0) {
    process.stderr.write(`${command ?? 'setup'} 不接受参数：${rest.join(' ')}\n`)
    return 2
  }

  if (command === 'config') {
    const main = await load('../lib/tui/main.js')
    if (main === null) return 1
    return await main.runConfigTui()
  }

  const setup = await load('../lib/tui/setup.js')
  if (setup === null) return 1
  return await setup.runSetup()
}

try { process.exitCode = await main(process.argv.slice(2)) }
catch (cause) { process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`); process.exitCode = 1 }
