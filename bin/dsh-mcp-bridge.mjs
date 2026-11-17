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
  config    打开默认模型 / 思考强度 / 默认权限的设置界面

环境变量：
  DSH_MCP_BRIDGE_URL     插件端点，缺省 http://127.0.0.1:7275
  DSH_MCP_BRIDGE_TOKEN   本机认证凭据（必填，与插件启动时用的一致）

说明：
  config 子命令是插件的**配置客户端**：它通过本机认证通道读写插件服务，
  不直接改写 DSH profile、全局默认模型或会话文件。保存后新建会话立即生效，
  已有会话与运行中的回合保持原设置。`

async function main(argv) {
  const [command, ...rest] = argv

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${HELP}\n`)
    return 0
  }

  if (command !== 'config') {
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

process.exitCode = await main(process.argv.slice(2))
