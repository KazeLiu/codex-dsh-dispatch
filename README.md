# codex-dsh-dispatch

**在 Codex 里发指令，让 DeepSeek Harness（DSH）去实现。** Codex 负责规划、审查和纠错，DSH 用自己的模型、工具和执行循环把活干完；你在 Codex 的同一个对话里等结果、补充说明、纠偏、让它返工。

```text
Codex ── stdio MCP ── 本机代理 ── 回环 HTTP MCP ── DSH 插件
                                                   │
                                              DSH 原生会话服务
```

MCP 派单通道只监听插件自己的本机回环端口，**不需要开启「允许浏览器访问」**。设置页在 DSH 原生界面内通过宿主网页服务通信；MCP 协议走官方 TypeScript SDK。

## 安装

只需要装 DSH 插件：登记 Codex、写协作规则、设默认值都在 DSH 的**设置 → Codex 派单**里点，不需要全局命令、不需要改 PATH。

使用前需安装 Node.js（22.x ≥22.19，或 ≥24.9）和 Codex 官方 CLI。若按包名安装得到的是 `0.1.0`，那一版不含原生设置页；可按[源码安装说明](docs/INSTALL.md#从源码)构建当前版本。

宿主要求：DSH NEXT **2.0.23-next**（内置 Harness `0.2.2-rc.3`）或适配的后续版本。从 `2.0.20-next` 升级时，先更新 DSH，再更新本插件。

| | 是什么 | 怎么装 |
| --- | --- | --- |
| **DSH 插件** | 在 DSH 进程里提供 `/mcp/codex-dsh-dispatch` 服务，并带一页图形设置 | DSH 应用商店安装（或插件管理界面「添加插件」）后启用 |
| 全局 CLI（可选） | `codex-dsh-dispatch` 命令，给习惯终端的人用 | 需要时再 `npm install -g` |

**商店/插件安装不会把 `codex-dsh-dispatch` 命令注入 PATH**，也不会自动改 Codex 配置或 AGENTS.md。图形设置页同样不装全局命令——它直接用插件自己的安装路径登记。

### 1. DSH 插件

在 DSH 插件管理界面选择「添加插件」，输入包名 `codex-dsh-dispatch`，安装后启用。商店收录后也可以直接从商店安装；源码开发时填写已构建的本地目录。桌面版的 desktop Profile 由应用自己管理，不手工改写。

### 2. 在设置里接上 Codex

打开 DSH **设置 → Codex 派单**：

1. **Codex 接入** 一节显示 Codex 配置文件路径、MCP 入口、以及要用的 Node。点「连接到 Codex」，插件会调用 Codex 官方 CLI 写入一条名为 `codex-dsh-dispatch` 的 stdio MCP，指向本插件的 `bin/codex-dsh-dispatch.mjs`。写入前会重新读一次同名条目，已有就拒绝覆盖；条目被停用时也会明确提示。这一行是一击执行，不再弹二次确认。
2. **协作规则** 一节只写全局 `AGENTS.md`（`CODEX_HOME` 或 `~/.codex`），只动自己那一对托管标记之间的内容。项目级 `AGENTS.md` 仍由 CLI 向导的显式选择处理。
3. **默认模型 / 思考强度 / 默认权限 / 无项目默认工作区** 改完点「保存」。默认工作区从 DSH 已登记的工作区里选，保存的是工作区 ID，可以用「未设置」清空。

**只有修改 Node 路径需要二次确认。** 未指定时，输入框显示从 PATH 找到的 Node；清空手动路径并保存即可恢复自动查找。这个设置影响下一次 MCP 登记，不会改写已有登记。

桌面版 DSH 跑在 Electron 里，它自己的可执行文件不能当 Node 用。设置页会显示实际解析到的 Node 与版本；解析不出来时，在「Node 路径」里填一个 node 可执行文件的绝对路径再保存。**不需要**为了这一步装全局 CLI。

### 可选：全局 CLI

```cmd
npm install -g codex-dsh-dispatch
```

需要 Node.js 22.19 以上的 22.x，或 24.9 及以上；登记 MCP 还需要 Codex 官方 CLI。装完在任意目录都能敲 `codex-dsh-dispatch`。CLI 与图形设置页调的是同一组逻辑，两者改的是同一份配置。

也可以从本项目的 GitHub Release tgz 安装。CLI 和 DSH 插件需分别更新到相同版本。

从源码开发时改用：

```cmd
git clone https://github.com/KazeLiu/codex-dsh-dispatch.git
cd codex-dsh-dispatch
npm install
npm link --ignore-scripts
```

`npm install` 的 `prepare` 会编译到 `lib/`（含客户端 `lib/client.js`）；`npm link` 注册全局命令。已有源码目录只需重新安装、构建和链接，不必重新克隆。

## CMD 用法（可选）

```cmd
codex-dsh-dispatch
```

不带参数就是接入向导，**DSH 没启动也能打开**（只有读模型目录那一步需要 DSH 在线）：

1. **登记 Codex 的 MCP 连接** —— 调用 Codex 官方 CLI 写入一条名为 `codex-dsh-dispatch` 的 stdio MCP，指向当前安装位置的 `node` 和 `bin/codex-dsh-dispatch.mjs mcp`。写入前显示目标并要求确认；已有同名条目会先读取并显示，不会静默覆盖；条目被停用时也会明确提示。
2. **写入协作提示词到 AGENTS.md** —— 可选，写全局（`CODEX_HOME` 或 `~/.codex/AGENTS.md`）或当前目录的 `AGENTS.md`。只写自己那一对托管标记之间的内容，区块外的东西一律不动。
3. **设置默认模型、强度与权限** —— 需要 DSH 正在运行，从桥接服务读实时模型目录。
4. **查看当前状态** —— 只读，不需要 DSH 在线。

也可以直接用子命令：

```cmd
codex-dsh-dispatch setup
codex-dsh-dispatch status
codex-dsh-dispatch config
codex-dsh-dispatch models
```

`setup` 等同不带参数；`status` 只读查看登记、提示词与连接状态；`config` 直接进默认值设置；`models` 只列模型与支持的思考强度。

### 手工登记 MCP（等价）

```cmd
codex mcp add codex-dsh-dispatch -- "<node 绝对路径>" "<包目录绝对路径>\bin\codex-dsh-dispatch.mjs" mcp
codex mcp get codex-dsh-dispatch
```

登记内容只有启动命令和参数，**不含任何认证值**，也不固定端口——端口和令牌由插件运行时写进 DSH 数据目录，代理自己读。登记不需要 DSH 在线。

若当前 Codex 对话里还没出现四个工具，需要让客户端重新加载 MCP 连接：登记成功和当前对话的工具清单刷新是两件事。

## 设置：模型、强度、权限

```cmd
codex-dsh-dispatch config
```

↑↓ 选择，Enter 确认：

- **模型**：输入名称筛选，例如 `deepseek-v4.1-flash`。选「跟随 DSH 默认设置」表示不固定。
- **思考强度**：从该模型实际支持的列表里选，例如 `low`。强度与模型绑定，选「跟随 DSH 默认设置」时强度一并跟随。
- **默认权限**：请求批准 / 帮我批准 / 完全访问。调用方能给出当前 Codex 的三档权限时优先同步，取不到时用这里保存的值，初始为请求批准。「帮我批准」需要 DSH 原生自动审查能力，不可用时会禁用。

优先级：**本次明确指定 > 桥接默认值 > DSH 默认值**。保存后新建的桥接会话立即生效，已有会话不受影响；也不会改 DSH 的全局默认值。

## 四个工具

| 工具 | 用途 |
| --- | --- |
| `dsh_start` | 按 cwd 复用/注册工作区（或省略 cwd 用保存的默认工作区），创建专属 DSH 对话并提交任务 |
| `dsh_wait` | 按请求 ID 和游标等待结果或人工输入 |
| `dsh_send` | 在原对话中补充任务（`mode: 'queue'` / `'steer'`）或回答受支持的提问 |
| `dsh_cancel` | 显式请求取消，不把接收确认当成已取消 |

`dsh_send` 的 `mode` 决定补充文字怎么投递：

- **`queue`（缺省）**：排队，等当前回合结束后再执行。适合 DSH 已经交付后的返工，或下一个独立步骤。
- **`steer`**：插进当前正在执行的回合，由宿主在可接受的边界注入。适合在跑的过程中纠偏、补充方向或追加约束。

`steer` 不保证立刻打断正在执行的工具调用，受理也不代表已经生效——仍然要用 `dsh_wait` 观察实际进展。`reply`（回答提问）走宿主自己的提问回答通道，不能同时指定 `mode`。

同目录共享 DSH 工作区，不同 Codex 对话使用各自的 DSH 会话。本插件只串行协调自己的同目录任务，不锁用户或其他程序的文件操作。

`dsh_start` 的 `cwd` 可以省略：**只要有具体项目目录就一律传它的绝对路径**；确认这次没有对应项目时才可以不传，不传时用设置页里选定的「无项目默认工作区」。显式传了的必须是绝对路径——传错不会回退到默认值，而是直接报错。默认工作区被删掉时不会自动重建，也不替你改选，只提示回设置页重新选择或直接传 cwd。`dsh_send` / `dsh_wait` / `dsh_cancel` 不受影响。

默认模型、强度、权限和工作区只影响新建会话。升级后，在「全局 AGENTS.md」一行点「更新」以替换旧协作规则，再重载 Codex，让它读取新规则和 MCP 工具参数。

## 协作提示词是干什么的

在 DSH 设置的「全局 AGENTS.md」一行点「写入」，Codex 就会在之后读取的规则里看到这套分工：**简单和特别难的任务由 Codex 直接做；方向明确、范围可控的中等实现才优先派给 DSH。** Codex 审查实际改动，小问题直接修，达到验收条件就交付。

托管范围只有这一对标记之间：

```markdown
<!-- codex-dsh-dispatch begin -->
...
<!-- codex-dsh-dispatch end -->
```

区块外的内容（包括你自己写的同名小节）原样保留。标记不成对，或文件自上次读取后被改动时，本次不写入。同目录若存在非空 `AGENTS.override.md`，它的优先级更高，设置页会提醒。

## 工作流程

1. Codex 判断方向及是否值得派单。适合委派时，用 `dsh_start` 提交任务、工作目录（只有无项目时省略）和稳定的 `requestId`。
2. DSH 在自己的会话里实现。
3. Codex 用 `dsh_wait` 等结果，超时继续用同一个 `requestId` 等，不重复派单。
4. 发现方向偏了、约束漏了，用 `dsh_send` 的 `steer` 趁它还在跑直接纠偏；等它停下来才要改的，用 `queue`。
5. Codex 审查真实差异：确认 DSH 已停止写入后，小范围 bug 由 Codex 直接修；需要较大返工时用 `dsh_send` 回到原 DSH 会话，不新开会话重做。
6. Codex 对照需求、实际代码与已有验证证据交付；补充验证遵守用户本次授权。

## 从旧名升级

本项目原名 `dsh-mcp-bridge`（中间短暂用过 `codex-dsh-bridge`），现已统一为 `codex-dsh-dispatch`，**不提供旧命令别名、不迁移旧配置**。旧名字的登记和数据一律作废，按下面的顺序重做（先有可用的新命令，才能用它去改登记）：

1. 在源码目录构建：`npm install`（会执行 `prepare`）；依赖已安装时可单独 `npm run build`。
2. 解除旧的全局链接：`npm unlink -g dsh-mcp-bridge`（若还装过 `codex-dsh-bridge`，一并 `npm unlink -g codex-dsh-bridge`）。
3. 链接新命令：`npm link --ignore-scripts`。
4. 在 DSH 插件管理界面卸载旧插件、添加新目录并启用（插件 id 已变为 `codex-dsh-dispatch`）。
5. 移除旧 MCP 登记，再用新命令登记新的：

   ```cmd
   codex mcp remove dsh
   codex mcp remove codex-dsh-bridge
   codex mcp remove codex-dsh-dispatch
   codex-dsh-dispatch setup
   ```

6. 重启 Codex，让它重新加载 MCP 连接。

环境变量改名为 `CODEX_DSH_DISPATCH_URL` / `CODEX_DSH_DISPATCH_TOKEN`，旧名不再生效。旧数据目录 `%USERPROFILE%\.dsh\dsh-mcp-bridge\`、`%USERPROFILE%\.dsh\codex-dsh-bridge\` 不再被读取，确认无需保留后自行删除；新数据在 `%USERPROFILE%\.dsh\codex-dsh-dispatch\`。

## 卸载

先在 DSH 的「Codex 派单」设置页或 CMD 菜单中移除协作规则与 MCP 登记，再卸载插件；安装过全局 CLI 时再卸载命令。

1. 菜单里「移除 AGENTS.md 里的协作提示词」（全局和当前目录各查一次，只删托管区块）。
2. 移除 MCP 登记并解除命令：

   ```cmd
   rem 移除 Codex 里的 MCP 登记
   codex mcp remove codex-dsh-dispatch
   rem 解除全局安装的命令
   npm uninstall --global codex-dsh-dispatch
   ```

3. 在 DSH 插件管理界面停用或卸载插件。停用不删除已创建的 DSH 会话或桥接数据；需要清理时单独删除 `%USERPROFILE%\.dsh\codex-dsh-dispatch\`。

## 文档

随包发布，装完也能看：

- [安装、CMD 设置与 Codex 接入](docs/INSTALL.md)
- [协作指令与项目规则](docs/WORKFLOW.md)
- [发布与商店投稿](docs/PUBLISHING.md)

只在仓库里（不进 npm 包）：

- `docs/ACCEPTANCE.md` 本机验收记录
- `docs/DEVELOPMENT.md` 设计与实现说明
- `docs/ARCHITECTURE.md` 分层与依赖规则
