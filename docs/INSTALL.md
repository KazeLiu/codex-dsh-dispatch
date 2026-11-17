# 安装、CMD 设置与 Codex 接入

## 已安装后直接打开设置

保持 DSH 运行，在 CMD 执行：

```cmd
dsh-mcp-bridge config
```

用方向键选择项目，Enter 打开下拉列表：先选**模型**，输入模型名筛选；再选**思考强度**，例如 `low`；最后选择**保存默认值**。保存后不需要重启 DSH，新建的桥接对话立即使用它，已有对话不受影响。Ctrl+C 可以退出。

思考强度与具体模型绑定。模型选择“跟随 DSH 默认设置”时，强度一并跟随 DSH；要固定为 `low`，先选一个支持 `low` 的具体模型。

**默认权限**有三档：请求批准、帮我批准、完全访问。调用方能提供当前 Codex 三档权限时优先同步；取不到时采用保存的默认权限；初始值为请求批准。帮我批准必须由 DSH 的原生自动审查能力提供，不可用时会禁用该选项。

```cmd
rem 只查看模型与它们支持的强度
dsh-mcp-bridge models

rem 找不到全局命令时，直接运行本机源码入口
cd /d D:\code\dsh-mcp-bridge
node bin\dsh-mcp-bridge.mjs config
```

## 从源码安装到 DSH Desktop

本机已验证环境：DSH Desktop **2.0.23-next**，DSH 原生服务 **0.2.2-rc.3**；系统 Node.js **22.19.0**。其他宿主版本应先核对原生接口。

在源码目录构建：

```cmd
cd /d D:\code\dsh-mcp-bridge
npm install
npm run typecheck
npm run build
npm link --ignore-scripts
```

`npm link` 注册本地 `dsh-mcp-bridge` 命令；本地源码目录需继续保留。`lib/` 是 DSH 和 CLI 都会使用的运行产物，不能省略构建。

在 **DSH 桌面应用的插件管理界面**打开“添加插件”，输入：

```text
D:\code\dsh-mcp-bridge
```

安装源可选官方 npm 源。完成后启用插件。安装会由 DSH 自己登记 desktop Profile 的依赖和启用清单，不手工改写该 Profile 或复制到它的 node_modules。DSH CLI 会拒绝管理保留的 desktop Profile，应使用桌面界面。

## 不需要打开浏览器访问

插件在 DSH 进程内运行，直接调用原生会话服务，并拥有独立的 `127.0.0.1` HTTP 监听；没有修改或使用 DSH 内置网页路由的访问策略。

每次加载由系统分配端口，客户端从本机连接文件自动发现，避免手填端口。插件生成独立随机 Bearer 凭据，保存于用户 DSH 数据目录的 `dsh-mcp-bridge/access.json`；CLI 按正常认证流程读取它。不要把这个文件发给别人、提交到仓库或展示其内容。

模型供应商密钥、AA Connector 凭据和 DSH 渲染进程令牌都不用于本桥接。关闭或卸载插件会关闭它拥有的监听，不结束用户的 DSH 对话。

## Codex 接入

在本机执行一次：

```cmd
codex mcp add dsh -- "C:\nvm4w\nodejs\node.exe" "D:\code\dsh-mcp-bridge\bin\dsh-mcp-bridge.mjs" mcp
codex mcp get dsh
```

上述 Node 路径是本机实际位置；其他设备应使用自己的 `node.exe`。本机已完成登记。配置仅含启动命令和参数，不写认证值，也不把端口固定成某次启动的临时端口。

代理使用官方 MCP SDK 提供 stdio，再连接插件的本机 Streamable HTTP MCP。它只负责通信，不启动另一个 DSH，不复制模型执行循环。DSH 需保持运行；没有加载插件时会明确报连接错误。

若正在打开的 Codex 对话仍未出现四个工具，需要让客户端重新加载 MCP 连接；配置登记成功与当前对话工具清单已刷新是两件事。

## 保存的数据和默认值范围

默认位置为 `%USERPROFILE%\.dsh\dsh-mcp-bridge\`，设置 `DSH_HOME` 时位于对应目录下：

| 文件 | 内容 |
| --- | --- |
| `access.json` | 本机插件连接地址和独立认证信息 |
| `settings.json` | 只供桥接新会话使用的默认模型、强度、权限 |
| `state.json` | 插件创建的会话与各请求的接收阶段、输入摘要、观察基线 |

设置优先级为本次明确指定、桥接默认值、DSH 默认值。权限没有源值和保存值时采用请求批准。用户在 DSH 中手动修改已有对话后，续聊读取当前值；不会每次套用默认值。

## 卸载

通过 DSH 插件管理界面停用或卸载。若不再需要 Codex 接入，执行：

```cmd
codex mcp remove dsh
npm unlink --global dsh-mcp-bridge
```

停用不删除已创建的 DSH 会话或桥接数据，便于恢复。需要删除本地数据时，先确认要保留的默认设置和会话关联，再单独清理该目录。

## 排查

- **找不到桥接连接信息**：确认 DSH 中插件已启用且 `lib/index.js` 已构建，检查 DSH 的该插件启动错误。
- **连接被拒绝或超时**：确认 DSH 仍在运行、插件未停用。重新加载插件后会重新发布端口；重新启动设置客户端或 MCP 连接。
- **出现 `Browser access is disabled`**：当前客户端连接到了旧的 DSH 网页端口。正常的自动发现不访问它；清除自己设置的 `DSH_MCP_BRIDGE_URL`、`DSH_MCP_BRIDGE_TOKEN` 覆盖后重试，不需要打开网页访问。
- **模型列表为空或某个供应商失败**：检查 DSH 自己的模型目录和供应商状态，不伪造模型或自动更换保存的模型。
- **workspace-busy**：同目录已有其他本插件任务运行、排队或等待人工输入。先处理或取消该任务；不反复重新派单。
- **需要人工输入**：在 DSH 中处理当前审批或提问。当前问题回复入口仅支持原生 `userQuestions.answer`；完整的 Codex 端审批回复仍需进一步接入。

实际验收结果见 [验收记录](ACCEPTANCE.md)，不要用早期离线冒烟结果代替真实宿主验证。
