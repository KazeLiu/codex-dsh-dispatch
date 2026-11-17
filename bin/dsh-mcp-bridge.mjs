#!/usr/bin/env node
/**
 * `dsh-mcp-bridge` 命令行入口。
 *
 * 只做一件事：把子命令转给 `lib/` 里的实现。刻意保持零依赖、零构建——
 * 它是发布产物里的启动脚本，不能假设用户装了 TypeScript。
 *
 * 用法：
 *   dsh-mcp-bridge config    打开默认值设置界面
 *   dsh-mcp-bridge --help    显示帮助
 */

const HELP = `用法：dsh-mcp-bridge <命令>

命令：
  config    打开默认模型 / 思考强度 / 默认权限的下拉设置界面
  models    显示 DSH 当前模型和支持的思考强度
  mcp       为 Codex 提供 stdio MCP 接入

环境变量：
  默认自动发现本机插件并读取专用认证信息，无需手动填写端口或凭据。
  DSH_MCP_BRIDGE_URL / DSH_MCP_BRIDGE_TOKEN 可用于显式覆盖设置客户端连接。

说明：
  config 子命令是插件的**配置客户端**：它通过本机认证通道读写插件服务，
  不直接改写 DSH profile、全局默认模型或会话文件。保存后新建会话立即生效，
  已有会话与运行中的回合保持原设置。`

async function main(argv) {
  const [command, ...rest] = argv

  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${HELP}\n`)
    return 0
  }

  if (command === 'mcp') {
    await (await import('../lib/tui/proxy.js')).runMcpProxy()
    return 0
  }
  if (command === 'models') {
    const { fetchSettings, readClientConfig } = await import('../lib/tui/client.js')
    const { printModels } = await import('../lib/tui/main.js')
    printModels(await fetchSettings(readClientConfig()))
    return 0
  }
  if (command !== undefined && command !== 'config') {
    process.stderr.write(`未知命令：${command}\n\n${HELP}\n`)
    return 2
  }

  if (rest.length > 0) {
    process.stderr.write(`config 不接受参数：${rest.join(' ')}\n`)
    return 2
  }

  let runConfigTui
  try {
    // 动态 import：未构建时给出可操作的提示，而不是一句 ERR_MODULE_NOT_FOUND。
    ;({ runConfigTui } = await import('../lib/tui/main.js'))
  } catch (cause) {
    process.stderr.write(
      `无法加载 lib/tui/main.js：${cause instanceof Error ? cause.message : String(cause)}\n` +
        '请先在插件目录执行 npm run build。\n',
    )
    return 1
  }

  return await runConfigTui()
}

try { process.exitCode = await main(process.argv.slice(2)) }
catch (cause) { process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`); process.exitCode = 1 }
