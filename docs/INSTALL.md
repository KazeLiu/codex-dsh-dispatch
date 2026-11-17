# 安装、CMD 设置与 Codex 接入

DSH 插件与全局命令行需要分别安装：

| | 作用 | 安装方式 |
| --- | --- | --- |
| **DSH 插件** | 在 DSH 进程里提供 `/mcp/codex-dsh-dispatch` 服务 | DSH 桌面应用的插件管理界面 |
| **全局 CLI** | `codex-dsh-dispatch` 命令：接入向导、默认值设置、模型列表 | `npm install -g codex-dsh-dispatch`；源码开发可用 `npm link` |

只装插件的话，DSH 里能跑，但**任意目录敲 `codex-dsh-dispatch` 会找不到命令**。插件安装不会改 PATH、不会改 Codex 配置、不会写 AGENTS.md。

## 第一次接入：菜单

```cmd
codex-dsh-dispatch
```

不带参数打开接入向导。**DSH 没启动也能用**——登记 MCP 和写提示词都只碰本机 Codex 配置与 AGENTS.md：

| 菜单项 | 需要 DSH 在线 | 说明 |
| --- | --- | --- |
| 登记 Codex 的 MCP 连接 | 否 | 写一条名为 `codex-dsh-dispatch` 的 stdio MCP |
| 移除 Codex 的 MCP 连接 | 否 | 只删同名条目，其它服务器不动 |
| 写入协作提示词到 AGENTS.md | 否 | 显式选择全局或当前目录 |
| 移除 AGENTS.md 里的协作提示词 | 否 | 只删托管区块 |
| 设置默认模型与权限 | 是 | 从桥接服务读实时模型目录 |
| 查看可用模型 | 是 | 同上 |
| 查看当前状态 | 否 | 只读汇总 |

子命令等价写法：

```cmd
codex-dsh-dispatch setup
codex-dsh-dispatch status
codex-dsh-dispatch config
codex-dsh-dispatch models
```

`setup` 同不带参数；`status` 只读、不需要 DSH 在线；`config` 直接进默认值设置；`models` 只列模型与支持的强度。

## 默认值设置

```cmd
codex-dsh-dispatch config
```

用方向键选择项目，Enter 打开下拉列表：先选**模型**，输入模型名筛选；再选**思考强度**，例如 `low`；最后选择**保存默认值**。保存后不需要重启 DSH，新建的桥接对话立即使用它，已有对话不受影响。Ctrl+C 可以退出。

思考强度与具体模型绑定。模型选择「跟随 DSH 默认设置」时，强度一并跟随 DSH；要固定为 `low`，先选一个支持 `low` 的具体模型。

**默认权限**有三档：请求批准、帮我批准、完全访问。调用方能提供当前 Codex 三档权限时优先同步；取不到时采用保存的默认权限；初始值为请求批准。帮我批准必须由 DSH 的原生自动审查能力提供，不可用时会禁用该选项。

找不到全局命令时，在包目录直接运行入口：

```cmd
cd /d D:\code\dsh-mcp-bridge
node bin\codex-dsh-dispatch.mjs config
```

## 安装 DSH 插件

### 从源码

本机已验证环境：DSH Desktop **2.0.23-next**，DSH 原生服务 **0.2.2-rc.3**；系统 Node.js **22.19.0**。其他宿主版本应先核对原生接口。

```cmd
cd /d D:\code\dsh-mcp-bridge
npm install
```

`lib/` 是 DSH 和 CLI 都会用的运行产物，不能省。想同时拿到全局命令：

```cmd
npm link --ignore-scripts
```

`--ignore-scripts` 是为了跳过 `prepare`（本地已手工构建过）。`npm link` 注册本地 `codex-dsh-dispatch` 命令，源码目录需继续保留。

`prepare` 在源码安装和打包阶段编译 TypeScript，不改外部配置。`--ignore-scripts` 会跳过它；`--omit=dev` 不会安装 TypeScript，但不会自动跳过构建脚本。源码安装需要构建依赖，预构建 tgz 则应自带 `lib/`。

在 **DSH 桌面应用的插件管理界面**打开「添加插件」，输入包目录：

```text
D:\code\dsh-mcp-bridge
```

完成后启用插件。安装会由 DSH 自己登记 desktop Profile 的依赖和启用清单，不手工改写该 Profile 或复制到它的 `node_modules`。DSH CLI 会拒绝管理保留的 desktop Profile，应使用桌面界面。

### 从 npm 包安装到 DSH

在 DSH 插件管理界面选择「添加插件」，输入 `codex-dsh-dispatch` 并安装启用。安装到 DSH 的包不会自动成为系统全局命令。

### 从 DSH 应用商店（收录后可用）

商店条目装上的是插件本身，装完在插件管理界面启用即可。**商店安装不会把 `codex-dsh-dispatch` 命令注入 PATH**，要在任意目录用命令仍需单独做一次全局安装（见下）。

当前仓库尚未投稿，商店里还搜不到本插件；这一节描述的是发布之后的形态。

### 全局 CLI：npm 或 Release tgz

两条路等价，装的是同一份代码：

```cmd
rem 从 npm 安装
npm install -g codex-dsh-dispatch
```

```cmd
rem 从本项目的 Release tgz 安装
npm install -g https://github.com/KazeLiu/codex-dsh-dispatch/releases/latest/download/codex-dsh-dispatch.tgz
```

Release 资产名固定为 `codex-dsh-dispatch.tgz`，要锁定版本可使用 `releases/download/v0.1.0/codex-dsh-dispatch.tgz`。

预构建包自带 `lib/`，不需要用户自己编译。商店条目的 `tarball` 指向同一个 Release 资产。

## Codex 接入

用菜单里的「登记 Codex 的 MCP 连接」，等价的手工命令是：

```cmd
codex mcp add codex-dsh-dispatch -- "<node 绝对路径>" "<包目录绝对路径>\bin\codex-dsh-dispatch.mjs" mcp
codex mcp get codex-dsh-dispatch
```

本机实际路径示例：

```cmd
codex mcp add codex-dsh-dispatch -- "C:\nvm4w\nodejs\node.exe" "D:\code\dsh-mcp-bridge\bin\codex-dsh-dispatch.mjs" mcp
```

要点：

- 登记内容只有启动命令和参数，**不含任何认证值**，也不固定端口。
- 登记**不需要 DSH 在线**，DSH 起来后代理自己发现端口和令牌。
- 同名条目已存在时，向导会先读取并显示现有配置，然后停下；不会静默覆盖。要换指向，先移除再登记。
- 只操作名为 `codex-dsh-dispatch` 的这一条，不改写 `~/.codex/config.toml` 里其它 MCP 服务器。
- Windows 上 npm 安装的 `codex` 是 `.cmd` 包装脚本，向导会改用同目录的 `node_modules/@openai/codex/bin/codex.js` 以 Node 启动，参数仍以数组传递，不拼进 shell。

代理使用官方 MCP SDK 提供 stdio，再连接插件的本机 Streamable HTTP MCP。它只负责通信，不启动另一个 DSH，不复制模型执行循环。DSH 需保持运行；没有加载插件时会明确报连接错误。

若正在打开的 Codex 对话仍未出现四个工具，需要让客户端重新加载 MCP 连接；配置登记成功与当前对话工具清单已刷新是两件事。

## 不需要打开浏览器访问

插件在 DSH 进程内运行，直接调用原生会话服务，并拥有独立的 `127.0.0.1` HTTP 监听；没有修改或使用 DSH 内置网页路由的访问策略。

每次加载由系统分配端口，客户端从本机连接文件自动发现，避免手填端口。插件生成独立随机 Bearer 凭据，保存于用户 DSH 数据目录的 `codex-dsh-dispatch/access.json`；CLI 按正常认证流程读取它。不要把这个文件发给别人、提交到仓库或展示其内容。

模型供应商密钥、AA Connector 凭据和 DSH 渲染进程令牌都不用于本桥接。关闭或卸载插件会关闭它拥有的监听，不结束用户的 DSH 对话。

## 保存的数据和默认值范围

默认位置为 `%USERPROFILE%\.dsh\codex-dsh-dispatch\`，设置 `DSH_HOME` 时位于对应目录下：

| 文件 | 内容 |
| --- | --- |
| `access.json` | 本机插件连接地址和独立认证信息 |
| `settings.json` | 只供桥接新会话使用的默认模型、强度、权限 |
| `state.json` | 插件创建的会话与各请求的接收阶段、输入摘要、观察基线 |

设置优先级为本次明确指定、桥接默认值、DSH 默认值。权限没有源值和保存值时采用请求批准。用户在 DSH 中手动修改已有对话后，续聊读取当前值；不会每次套用默认值。

## 从旧名升级（dsh-mcp-bridge → codex-dsh-dispatch）

改名不保留旧命令别名、不迁移旧配置，旧登记与旧数据一律作废。顺序不能反：**先让新命令可用，才能用它去改登记**。

1. 在源码目录构建：

   ```cmd
   cd /d D:\code\dsh-mcp-bridge
   npm install
   ```

2. 解除旧的全局链接（两个旧名都要解，没装过的会报找不到，忽略即可）：

   ```cmd
   npm unlink -g dsh-mcp-bridge
   npm unlink -g codex-dsh-bridge
   ```

3. 链接新命令（发布后改用 `npm install -g codex-dsh-dispatch` 或本项目的 Release tgz）：

   ```cmd
   npm link --ignore-scripts
   ```

4. 在 DSH 插件管理界面卸载旧插件、添加新目录并启用（插件 id 已从 `dsh-mcp-bridge` 变为 `codex-dsh-dispatch`）。

5. 移除旧 MCP 登记，再用新命令重新登记：

   ```cmd
   rem 移除最早的旧名登记
   codex mcp remove dsh
   rem 移除上一版名字的登记
   codex mcp remove codex-dsh-bridge
   rem 若已用新名登记过，也一并移除以便重写
   codex mcp remove codex-dsh-dispatch
   rem 打开接入向导，选「登记 Codex 的 MCP 连接」
   codex-dsh-dispatch setup
   ```

6. 重启 Codex，让它重新加载 MCP 连接。

环境变量改名为 `CODEX_DSH_DISPATCH_URL` / `CODEX_DSH_DISPATCH_TOKEN`，旧的 `DSH_MCP_BRIDGE_*` 不再读取。旧数据目录 `%USERPROFILE%\.dsh\dsh-mcp-bridge\` 不再被读取，确认无需保留后自行删除。

## 卸载

顺序是**先用菜单清掉它写过的配置，再拆命令和插件**——命令没了就进不去菜单了。

1. 菜单里「移除 AGENTS.md 里的协作提示词」，全局和当前目录各查一次（只删托管区块）。
2. 移除 MCP 登记并解除命令：

   ```cmd
   rem 移除 Codex 里的 MCP 登记
   codex mcp remove codex-dsh-dispatch
   rem 解除 npm link 装的命令
   npm unlink --global codex-dsh-dispatch
   ```

   如果是从本项目 tgz 全局安装的，用 `npm uninstall --global codex-dsh-dispatch` 替代 `npm unlink`。
3. 通过 DSH 插件管理界面停用或卸载插件。停用不删除已创建的 DSH 会话或桥接数据，便于恢复；需要删除本地数据时，先确认要保留的默认设置和会话关联，再单独清理 `%USERPROFILE%\.dsh\codex-dsh-dispatch\`。

## 排查

- **找不到 `codex-dsh-dispatch` 命令**：插件安装不会注册全局命令。做一次 `npm link --ignore-scripts`（或发布后用 `npm install -g <tgz URL>`），或直接用 `node bin\codex-dsh-dispatch.mjs`。
- **npm 安装报 404**：确认包名是 `codex-dsh-dispatch`，并检查所用 registry 是否已同步；必要时使用 `--registry=https://registry.npmjs.org`。
- **找不到桥接连接信息**：确认 DSH 中插件已启用且 `lib/index.js` 已构建，检查 DSH 的该插件启动错误。
- **连接被拒绝或超时**：确认 DSH 仍在运行、插件未停用。重新加载插件后会重新发布端口；重新启动设置客户端或 MCP 连接。
- **出现 `Browser access is disabled`**：当前客户端连接到了旧的 DSH 网页端口。正常的自动发现不访问它；清除自己设置的 `CODEX_DSH_DISPATCH_URL`、`CODEX_DSH_DISPATCH_TOKEN` 覆盖后重试，不需要打开网页访问。
- **模型列表为空或某个供应商失败**：检查 DSH 自己的模型目录和供应商状态，不伪造模型或自动更换保存的模型。
- **`codex mcp add` 报错**：确认 `codex --version` 能直接运行。Windows 上若只有 `.cmd` 包装脚本且找不到 `node_modules/@openai/codex/bin/codex.js`，向导会明确报错而不是拼 shell 命令。
- **workspace-busy**：同目录已有其他本插件任务运行、排队或等待人工输入。先处理或取消该任务；不反复重新派单。
- **需要人工输入**：在 DSH 中处理当前审批或提问。当前问题回复入口仅支持原生 `userQuestions.answer`；完整的 Codex 端审批回复仍需进一步接入。

实际验收结果见仓库内的 `docs/ACCEPTANCE.md`（不随 npm 包发布），不要用早期离线冒烟结果代替真实宿主验证。
