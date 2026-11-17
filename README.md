# dsh-mcp-bridge

在 Codex 中把任务交给 DeepSeek Harness（DSH），等待结果，并在原 DSH 对话里继续补充和返工。DSH 使用自己的模型、工具和执行循环。

```text
Codex ── stdio MCP ── 本机代理 ── 回环 HTTP MCP ── DSH 插件
                                                   │
                                              DSH 原生会话服务
```

插件只监听自己的本机回环端口，不使用 DSH 的网页端口，**无需开启“允许浏览器访问”**。MCP 协议和客户端使用官方 TypeScript SDK。

## 在 CMD 中选择默认模型与思考强度

保持 DSH 运行，打开 CMD，执行：

```cmd
dsh-mcp-bridge config
```

用 ↑↓ 和 Enter 选择：

1. **模型**：输入名称筛选列表，例如 `deepseek-v4.1-flash`，选中对应供应商的模型。
2. **思考强度**：从该模型实际支持的列表中选择，例如 `low`。
3. **保存默认值**：保存后立即影响后续桥接新建的 DSH 对话。

选择“跟随 DSH 默认设置”时不固定模型和强度。默认权限支持“请求批准 / 帮我批准 / 完全访问”，仅在调用方无法提供源会话权限时使用。保存设置不修改 DSH 全局默认值，也不覆盖已有对话中的手动设置。

查看模型与支持的强度：

```cmd
dsh-mcp-bridge models
```

如果 CMD 找不到命令，在源码目录使用：

```cmd
cd /d D:\code\dsh-mcp-bridge
node bin\dsh-mcp-bridge.mjs config
```

## 安装和 Codex 接入

在 DSH 插件管理界面选择“添加插件”，填写已构建的本地目录并启用。桌面版的 desktop Profile 由应用管理，不通过 CLI 或手工编辑安装。

本机 Codex 已登记名为 `dsh` 的 stdio MCP，入口是 `bin/dsh-mcp-bridge.mjs mcp`。代理自动发现插件端口并读取专用认证信息，不需要把凭据填写进 Codex 配置。

完整安装、卸载与故障处理见 [安装与接入](docs/INSTALL.md)。

希望 Codex 负责规划、审查与 bug 纠正，并自动把细节实现交给 DSH，使用 [协作指令与项目规则](docs/WORKFLOW.md)。

## 已验证的闭环

2026-11-17，在 DSH Desktop 2.0.23-next、原生服务 0.2.2-rc.3 上，通过官方 MCP 客户端连接 stdio 代理，创建了使用 `cpr / deepseek-v4.1-flash`、`low` 强度的新对话，实际回答 **`2`**，状态为 `completed`。DSH 全局默认强度仍为 `high`。

CMD 中的模型搜索、强度下拉、默认值保存和退出已实际操作；验证结束后桥接默认值恢复为原来的“跟随 DSH”。详细证据和仍未验证的路径见 [验收记录](docs/ACCEPTANCE.md)。

## 四个任务工具

| 工具 | 用途 |
| --- | --- |
| `dsh_start` | 复用或注册工作区，创建专属 DSH 对话并提交任务 |
| `dsh_wait` | 按请求 ID 和游标等待结果或人工输入 |
| `dsh_send` | 在原对话中补充任务或回答受支持的提问 |
| `dsh_cancel` | 显式请求取消，不把接收确认当成已取消 |

同目录共享 DSH 工作区，不同 Codex 对话使用各自的 DSH 会话。本插件只串行协调自己的同目录任务；不锁用户或其他程序的文件操作。

开发要求见 [开发文档](docs/DEVELOPMENT.md)。
